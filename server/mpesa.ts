import type { Response } from 'express';
import type {
  BillingStoreState,
  MpesaC2BTransaction,
  PaybillSettings,
  WaterConnection,
  WaterInvoice,
} from '../src/types/billing.ts';
import {
  matchConnectionByBillRef,
  reconcileMpesaC2BIntoState,
  type MpesaConfirmationInput,
} from '../src/lib/mpesaReconcile.ts';
import {
  isFirestoreAdminReady,
  loadWorkspaceLedgerFromAdmin,
  persistMpesaC2BToFirestoreAdmin,
} from './firestoreBridge.ts';

export interface MpesaRuntimeConfig {
  environment: 'sandbox' | 'production';
  baseUrl: string;
  defaultShortCode: string;
  supportedShortCodes: string[];
  hasCredentials: boolean;
  responseType: 'Completed' | 'Cancelled';
  validationPath: string;
  confirmationPath: string;
  strictValidation: boolean;
}

export interface MpesaAccessTokenResult {
  access_token: string;
  expires_in: number;
  expiresAt: string;
  environment: 'sandbox' | 'production';
  shortCode: string;
  cached: boolean;
}

export interface MpesaWebhookEvent {
  type: 'mpesa_confirmation' | 'mpesa_urls_registered';
  timestamp: string;
  syncedToFirestore?: boolean;
  payload: MpesaConfirmationInput;
  transaction?: MpesaC2BTransaction;
  registrationResult?: unknown;
}

interface TokenCacheEntry {
  token: string;
  expiresAtMs: number;
}

const tokenCache = new Map<string, TokenCacheEntry>();
const sseClients = new Set<Response>();
const processedTransactions: MpesaC2BTransaction[] = [];
const pendingEvents: MpesaWebhookEvent[] = [];

// Live server-side workspace ledger cache populated from Firestore Admin and/or authenticated frontend sync
let cachedWorkspaceState: BillingStoreState = {
  version: 1,
  connections: [],
  readings: [],
  invoices: [],
  payments: [],
  tariffs: {
    Residents: { category: 'Residents' as BillingStoreState['tariffs']['Residents']['category'], ratePerM3: 150, seweragePercent: 0 },
    'Heavy Clients': { category: 'Heavy Clients' as BillingStoreState['tariffs']['Heavy Clients']['category'], ratePerM3: 180, seweragePercent: 0 },
  },
  notifications: [],
  mpesaTransactions: [],
};

let lastRegisteredInfo: {
  registeredAt: string;
  shortCodes: string[];
  validationUrl: string;
  confirmationUrl: string;
  response: unknown;
} | null = null;

export function getMpesaConfig(): MpesaRuntimeConfig {
  const envRaw = (process.env.MPESA_ENV || 'sandbox').trim().toLowerCase();
  const environment: 'sandbox' | 'production' =
    envRaw === 'production' || envRaw === 'live' ? 'production' : 'sandbox';
  const baseUrl =
    environment === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';

  const supportedRaw = (process.env.MPESA_SUPPORTED_SHORTCODES || '303030,247247')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const customPaybillPrimary = cachedWorkspaceState.paybill?.primaryPaybill?.trim();
  const customPaybillAlt = cachedWorkspaceState.paybill?.alternatePaybill?.trim();
  const defaultShortCode = (
    customPaybillPrimary ||
    process.env.MPESA_SHORTCODE ||
    supportedRaw[0] ||
    '303030'
  ).trim();
  const supportedShortCodes = Array.from(
    new Set(
      [defaultShortCode, customPaybillAlt, ...supportedRaw].filter(
        (v): v is string => Boolean(v && v.trim())
      )
    )
  );

  const hasCredentials = Boolean(
    process.env.MPESA_CONSUMER_KEY?.trim() && process.env.MPESA_CONSUMER_SECRET?.trim()
  );

  const responseType =
    (process.env.MPESA_RESPONSE_TYPE || 'Completed').trim() === 'Cancelled'
      ? 'Cancelled'
      : 'Completed';

  return {
    environment,
    baseUrl,
    defaultShortCode,
    supportedShortCodes,
    hasCredentials,
    responseType,
    validationPath: '/api/mpesa/validation',
    confirmationPath: '/api/mpesa/confirmation',
    strictValidation: process.env.MPESA_STRICT_VALIDATION === 'true',
  };
}

export function resolvePublicAppUrl(requestOrigin?: string): string {
  const envUrl = process.env.APP_URL?.trim();
  if (envUrl && envUrl !== 'MY_APP_URL') {
    return envUrl.replace(/\/+$/, '');
  }
  if (requestOrigin) {
    return requestOrigin.replace(/\/+$/, '');
  }
  const port = process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

export function resolveC2BCallbackUrls(requestOrigin?: string): {
  validationUrl: string;
  confirmationUrl: string;
} {
  const appBase = resolvePublicAppUrl(requestOrigin);
  const validationUrl =
    process.env.MPESA_VALIDATION_URL?.trim() || `${appBase}/api/mpesa/validation`;
  const confirmationUrl =
    process.env.MPESA_CONFIRMATION_URL?.trim() || `${appBase}/api/mpesa/confirmation`;
  return { validationUrl, confirmationUrl };
}

/**
 * 1. Safaricom Daraja OAuth 2.0 Access Token Generator
 * Uses server-side MPESA_CONSUMER_KEY + MPESA_CONSUMER_SECRET for Paybill 303030 / 247247.
 */
export async function fetchDarajaAccessToken(
  shortCodeOverride?: string
): Promise<MpesaAccessTokenResult> {
  const cfg = getMpesaConfig();
  const shortCode = (shortCodeOverride || cfg.defaultShortCode).trim();
  const consumerKey = process.env.MPESA_CONSUMER_KEY?.trim();
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET?.trim();

  if (!consumerKey || !consumerSecret) {
    const err = new Error(
      'Safaricom Daraja credentials are not configured. Set MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET in server environment secrets.'
    ) as Error & { statusCode?: number };
    err.statusCode = 503;
    throw err;
  }

  const cacheKey = `${cfg.environment}:${shortCode}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAtMs > Date.now() + 60_000) {
    return {
      access_token: cached.token,
      expires_in: Math.max(1, Math.floor((cached.expiresAtMs - Date.now()) / 1000)),
      expiresAt: new Date(cached.expiresAtMs).toISOString(),
      environment: cfg.environment,
      shortCode,
      cached: true,
    };
  }

  const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const oauthUrl = `${cfg.baseUrl}/oauth/v1/generate?grant_type=client_credentials`;

  const response = await fetch(oauthUrl, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${credentials}`,
      Accept: 'application/json',
    },
  });

  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    parsed = { raw: text };
  }

  if (!response.ok || !parsed.access_token) {
    const message =
      String(parsed.errorMessage || parsed.error_description || parsed.raw || response.statusText);
    const err = new Error(`Daraja OAuth authentication failed (${response.status}): ${message}`) as Error & {
      statusCode?: number;
      details?: unknown;
    };
    err.statusCode = response.status >= 400 && response.status < 500 ? 502 : response.status;
    err.details = parsed;
    throw err;
  }

  const accessToken = String(parsed.access_token);
  const expiresInSec = Number(parsed.expires_in ?? 3599) || 3599;
  const expiresAtMs = Date.now() + expiresInSec * 1000;

  tokenCache.set(cacheKey, { token: accessToken, expiresAtMs });

  return {
    access_token: accessToken,
    expires_in: expiresInSec,
    expiresAt: new Date(expiresAtMs).toISOString(),
    environment: cfg.environment,
    shortCode,
    cached: false,
  };
}

/**
 * 2. Registers C2B Validation and Confirmation URLs with Safaricom Daraja API
 * Supports registering Paybill 303030, 247247, or both.
 */
export async function registerC2BUrls(opts?: {
  shortCode?: string;
  registerAllSupported?: boolean;
  requestOrigin?: string;
  responseType?: 'Completed' | 'Cancelled';
}): Promise<{
  shortCodes: string[];
  validationUrl: string;
  confirmationUrl: string;
  environment: 'sandbox' | 'production';
  results: Array<{ shortCode: string; ok: boolean; response: unknown }>;
}> {
  const cfg = getMpesaConfig();
  const { validationUrl, confirmationUrl } = resolveC2BCallbackUrls(opts?.requestOrigin);
  const responseType = opts?.responseType ?? cfg.responseType;

  const targetShortCodes = opts?.registerAllSupported
    ? cfg.supportedShortCodes
    : [opts?.shortCode?.trim() || cfg.defaultShortCode];

  const results: Array<{ shortCode: string; ok: boolean; response: unknown }> = [];

  for (const shortCode of targetShortCodes) {
    const tokenRes = await fetchDarajaAccessToken(shortCode);
    const registerUrl = `${cfg.baseUrl}/mpesa/c2b/v1/registerurl`;
    const body = {
      ShortCode: shortCode,
      ResponseType: responseType,
      ConfirmationURL: confirmationUrl,
      ValidationURL: validationUrl,
    };

    const res = await fetch(registerUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenRes.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const raw = await res.text();
    let json: unknown = raw;
    try {
      json = raw ? JSON.parse(raw) : {};
    } catch {
      json = { raw };
    }

    results.push({
      shortCode,
      ok: res.ok,
      response: json,
    });
  }

  lastRegisteredInfo = {
    registeredAt: new Date().toISOString(),
    shortCodes: targetShortCodes,
    validationUrl,
    confirmationUrl,
    response: results,
  };

  emitMpesaEvent({
    type: 'mpesa_urls_registered',
    timestamp: lastRegisteredInfo.registeredAt,
    payload: {
      TransID: 'URL-REG',
      TransAmount: 0,
      BillRefNumber: targetShortCodes.join(','),
      MSISDN: '',
    },
    registrationResult: lastRegisteredInfo,
  });

  return {
    shortCodes: targetShortCodes,
    validationUrl,
    confirmationUrl,
    environment: cfg.environment,
    results,
  };
}

/**
 * Syncs authenticated workspace customer accounts and open invoices into backend cache
 * so C2B validation and confirmation work cleanly even before Admin SDK secrets are configured.
 */
export function syncWorkspaceCache(input: {
  connections?: WaterConnection[];
  invoices?: WaterInvoice[];
  payments?: BillingStoreState['payments'];
  notifications?: BillingStoreState['notifications'];
  mpesaTransactions?: MpesaC2BTransaction[];
  paybill?: PaybillSettings;
}) {
  if (input.paybill && input.paybill.primaryPaybill?.trim()) {
    cachedWorkspaceState.paybill = {
      primaryPaybill: input.paybill.primaryPaybill.trim(),
      alternatePaybill: input.paybill.alternatePaybill?.trim() || undefined,
      businessName: input.paybill.businessName?.trim() || 'MajiTrack Water Billing',
      accountLabel: input.paybill.accountLabel?.trim() || 'Account Number',
    };
  }
  if (Array.isArray(input.connections)) {
    cachedWorkspaceState.connections = input.connections;
  }
  if (Array.isArray(input.invoices)) {
    cachedWorkspaceState.invoices = input.invoices;
  }
  if (Array.isArray(input.payments)) {
    // Preserve any backend-confirmed M-Pesa payments not yet acknowledged by client
    const existingIds = new Set(input.payments.map((p) => p.id));
    const backendOnly = cachedWorkspaceState.payments.filter(
      (p) => p.id.startsWith('pay-mpesa-') && !existingIds.has(p.id)
    );
    cachedWorkspaceState.payments = [...backendOnly, ...input.payments];
  }
  if (Array.isArray(input.notifications)) {
    const existingIds = new Set(input.notifications.map((n) => n.id));
    const backendOnly = cachedWorkspaceState.notifications.filter(
      (n) => n.id.startsWith('ntf-mpesa-') && !existingIds.has(n.id)
    );
    cachedWorkspaceState.notifications = [...backendOnly, ...input.notifications];
  }
  if (Array.isArray(input.mpesaTransactions)) {
    const byId = new Map<string, MpesaC2BTransaction>();
    for (const tx of processedTransactions) {
      byId.set(tx.transId.toUpperCase(), tx);
    }
    for (const tx of input.mpesaTransactions) {
      if (!byId.has(tx.transId.toUpperCase())) {
        byId.set(tx.transId.toUpperCase(), tx);
      }
    }
    cachedWorkspaceState.mpesaTransactions = Array.from(byId.values());
  }
}

async function getActiveLedgerState(): Promise<BillingStoreState> {
  const adminLedger = await loadWorkspaceLedgerFromAdmin();
  if (adminLedger && adminLedger.connections.length > 0) {
    cachedWorkspaceState = adminLedger;
    return adminLedger;
  }
  return cachedWorkspaceState;
}

/**
 * Safaricom C2B Validation Endpoint Logic
 */
export async function handleValidationCallback(body: Record<string, unknown>): Promise<{
  ResultCode: number | string;
  ResultDesc: string;
  matchedAccount?: string | null;
}> {
  const cfg = getMpesaConfig();
  const amount = Number(body.TransAmount ?? 0);
  const billRefNumber = String(body.BillRefNumber ?? '').trim();
  const msisdn = String(body.MSISDN ?? '').trim();

  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      ResultCode: 'C2B00013',
      ResultDesc: 'Rejected: Invalid Amount',
    };
  }

  const ledger = await getActiveLedgerState();
  const matched =
    ledger.connections.length > 0
      ? matchConnectionByBillRef(ledger.connections, billRefNumber, msisdn)
      : null;

  if (cfg.strictValidation && ledger.connections.length > 0 && !matched) {
    return {
      ResultCode: 'C2B00012',
      ResultDesc: `Rejected: Account ${billRefNumber || 'N/A'} not found`,
      matchedAccount: null,
    };
  }

  return {
    ResultCode: 0,
    ResultDesc: 'Accepted',
    matchedAccount: matched?.accountCode ?? null,
  };
}

/**
 * 3. Safaricom C2B Confirmation Webhook Logic
 * Parses TransAmount, BillRefNumber, TransID, MSISDN, matches tenant,
 * updates invoice balances, records payment with status 'Completed', logs receipt,
 * persists to Firestore if Admin SDK is ready, and pushes real-time SSE update to dashboards.
 */
export async function handleConfirmationCallback(
  rawBody: Record<string, unknown>
): Promise<{
  ResultCode: number;
  ResultDesc: string;
  TransID: string;
  status: 'Completed' | 'Unmatched' | 'Failed';
  matchedAccount: string | null;
  appliedAmountKsh: number;
  syncedToFirestore: boolean;
  transaction: MpesaC2BTransaction;
}> {
  const transId = String(rawBody.TransID ?? rawBody.transId ?? `MP-${Date.now()}`)
    .trim()
    .toUpperCase();
  const transAmount = Math.max(0, Math.round(Number(rawBody.TransAmount ?? rawBody.transAmount ?? 0)));
  const billRefNumber = String(rawBody.BillRefNumber ?? rawBody.billRefNumber ?? '').trim();
  const msisdn = String(rawBody.MSISDN ?? rawBody.msisdn ?? '').trim();
  const shortCode = String(
    rawBody.BusinessShortCode ?? rawBody.businessShortCode ?? getMpesaConfig().defaultShortCode
  ).trim();
  const transTime = rawBody.TransTime ? String(rawBody.TransTime) : undefined;

  const payload: MpesaConfirmationInput = {
    TransID: transId,
    TransAmount: transAmount,
    BillRefNumber: billRefNumber,
    MSISDN: msisdn,
    BusinessShortCode: shortCode,
    TransTime: transTime,
    FirstName: rawBody.FirstName ? String(rawBody.FirstName) : undefined,
    MiddleName: rawBody.MiddleName ? String(rawBody.MiddleName) : undefined,
    LastName: rawBody.LastName ? String(rawBody.LastName) : undefined,
    TransactionType: rawBody.TransactionType ? String(rawBody.TransactionType) : 'Pay Bill',
  };

  const ledger = await getActiveLedgerState();
  const { nextState, result } = reconcileMpesaC2BIntoState(ledger, payload);
  cachedWorkspaceState = nextState;

  let syncedToFirestore = false;
  if (!result.alreadyProcessed) {
    syncedToFirestore = await persistMpesaC2BToFirestoreAdmin(result);
    if (!syncedToFirestore) {
      result.transaction.reconciled = false;
    }

    const existingIdx = processedTransactions.findIndex(
      (t) => t.transId.toUpperCase() === result.transaction.transId.toUpperCase()
    );
    if (existingIdx >= 0) {
      processedTransactions[existingIdx] = result.transaction;
    } else {
      processedTransactions.unshift(result.transaction);
      if (processedTransactions.length > 100) processedTransactions.pop();
    }

    const event: MpesaWebhookEvent = {
      type: 'mpesa_confirmation',
      timestamp: new Date().toISOString(),
      syncedToFirestore,
      payload,
      transaction: result.transaction,
    };

    if (!syncedToFirestore) {
      pendingEvents.push(event);
      if (pendingEvents.length > 100) pendingEvents.shift();
    }

    emitMpesaEvent(event);
  }

  return {
    ResultCode: 0,
    ResultDesc: 'Confirmation received and processed successfully',
    TransID: result.transaction.transId,
    status: result.transaction.status,
    matchedAccount: result.transaction.accountCode ?? null,
    appliedAmountKsh: result.transaction.appliedAmountKsh,
    syncedToFirestore,
    transaction: result.transaction,
  };
}

export function addSseClient(res: Response) {
  sseClients.add(res);
  res.on('close', () => {
    sseClients.delete(res);
  });
}

export function emitMpesaEvent(event: MpesaWebhookEvent) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(data);
    } catch {
      sseClients.delete(client);
    }
  }
}

export function getMpesaTransactionsSnapshot(): {
  transactions: MpesaC2BTransaction[];
  pendingPayloads: MpesaConfirmationInput[];
} {
  return {
    transactions: [...processedTransactions],
    pendingPayloads: pendingEvents
      .filter((e) => !e.syncedToFirestore && e.transaction && !e.transaction.reconciled)
      .map((e) => e.payload),
  };
}

export function markTransactionReconciled(transId: string): boolean {
  const target = processedTransactions.find(
    (t) => t.transId.toUpperCase() === transId.trim().toUpperCase()
  );
  if (target) {
    target.reconciled = true;
    return true;
  }
  return false;
}

export function getMpesaStatusSnapshot(requestOrigin?: string) {
  const cfg = getMpesaConfig();
  const callbacks = resolveC2BCallbackUrls(requestOrigin);
  return {
    environment: cfg.environment,
    defaultShortCode: cfg.defaultShortCode,
    supportedShortCodes: cfg.supportedShortCodes,
    hasCredentials: cfg.hasCredentials,
    responseType: cfg.responseType,
    strictValidation: cfg.strictValidation,
    firestoreAdminReady: isFirestoreAdminReady(),
    validationUrl: callbacks.validationUrl,
    confirmationUrl: callbacks.confirmationUrl,
    lastRegisteredInfo,
    recentTransactionsCount: processedTransactions.length,
    cachedAccountsCount: cachedWorkspaceState.connections.length,
  };
}
