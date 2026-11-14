import type {
  BillingStoreState,
  InvoiceStatus,
  MpesaC2BTransaction,
  NotificationLog,
  PaymentMethod,
  PaymentRecord,
  WaterConnection,
  WaterInvoice,
} from '../types/billing.ts';

export interface MpesaConfirmationInput {
  TransID: string;
  TransAmount: number | string;
  BillRefNumber: string;
  MSISDN: string;
  BusinessShortCode?: string;
  TransTime?: string;
  FirstName?: string;
  MiddleName?: string;
  LastName?: string;
  TransactionType?: string;
}

export interface MpesaReconcileResult {
  transaction: MpesaC2BTransaction;
  matchedConnection: WaterConnection | null;
  updatedInvoices: WaterInvoice[];
  createdPayments: PaymentRecord[];
  createdNotification: NotificationLog | null;
  alreadyProcessed: boolean;
}

function normalizeToken(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeKenyanPhoneDigits(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.startsWith('254') && digits.length >= 12) return digits.slice(3);
  if (digits.startsWith('0') && digits.length >= 10) return digits.slice(1);
  return digits.slice(-9);
}

export function parseSafaricomTransTime(transTime?: string): {
  date: { year: number; month: number; day: number };
  timeStr: string;
  isoTimestamp: string;
} {
  if (transTime && /^\d{14}$/.test(transTime.trim())) {
    const t = transTime.trim();
    const year = Number(t.slice(0, 4));
    const month = Number(t.slice(4, 6));
    const day = Number(t.slice(6, 8));
    const hh = t.slice(8, 10);
    const mm = t.slice(10, 12);
    const ss = t.slice(12, 14);
    if (year >= 2020 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return {
        date: { year, month, day },
        timeStr: `${hh}:${mm}`,
        isoTimestamp: `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${hh}:${mm}:${ss}`,
      };
    }
  }
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return {
    date: { year, month, day },
    timeStr: `${hh}:${mm}`,
    isoTimestamp: now.toISOString(),
  };
}

/**
 * Matches Safaricom BillRefNumber (e.g. "VW-1048", "Unit 101", "101", "MTR-84108")
 * or customer MSISDN against registered water connections.
 */
export function matchConnectionByBillRef(
  connections: WaterConnection[],
  billRefNumber: string,
  msisdn?: string
): WaterConnection | null {
  const raw = (billRefNumber || '').trim();
  const normRef = normalizeToken(raw);

  if (normRef) {
    // 1. Exact/normalized accountCode match (e.g. VW-1048 or VW1048)
    const byAccount = connections.find((c) => normalizeToken(c.accountCode) === normRef);
    if (byAccount) return byAccount;

    // 2. Exact/normalized meterSerial match (e.g. MTR-84108)
    const byMeter = connections.find((c) => normalizeToken(c.meterSerial) === normRef);
    if (byMeter) return byMeter;

    // 3. Unit / Suite number inside premiseAddress (e.g. "Gawanji Heights, Unit 101" -> "101" or "UNIT101")
    const byUnit = connections.find((c) => {
      const unitMatch = c.premiseAddress.match(/(?:unit|suite|apt|house|hs|no\.?)\s*([a-zA-Z0-9-]+)/i);
      if (unitMatch) {
        const unitToken = normalizeToken(unitMatch[1]);
        if (unitToken === normRef || `UNIT${unitToken}` === normRef || `SUITE${unitToken}` === normRef) {
          return true;
        }
      }
      return normalizeToken(c.premiseAddress) === normRef;
    });
    if (byUnit) return byUnit;

    // 4. Suffix match on numeric account portion (e.g. "1048" -> "VW-1048")
    if (/^\d{3,6}$/.test(normRef)) {
      const bySuffix = connections.find((c) => normalizeToken(c.accountCode).endsWith(normRef));
      if (bySuffix) return bySuffix;
    }
  }

  // 5. Fallback by normalized Kenyan MSISDN
  if (msisdn) {
    const refPhone = normalizeKenyanPhoneDigits(msisdn);
    if (refPhone.length >= 9) {
      const byPhone = connections.find(
        (c) => normalizeKenyanPhoneDigits(c.phone) === refPhone
      );
      if (byPhone) return byPhone;
    }
  }

  return null;
}

function computeNextInvoiceStatus(
  totalPayableKsh: number,
  amountPaidKsh: number,
  dueDate: { year: number; month: number; day: number },
  arrearsBroughtForwardKsh: number
): InvoiceStatus {
  if (amountPaidKsh >= totalPayableKsh) {
    return 'Paid' as InvoiceStatus;
  }
  const now = new Date();
  const dueVal = dueDate.year * 10000 + dueDate.month * 100 + dueDate.day;
  const todayVal = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  if (todayVal > dueVal || arrearsBroughtForwardKsh > amountPaidKsh) {
    return 'Overdue' as InvoiceStatus;
  }
  return 'Pending' as InvoiceStatus;
}

/**
 * Reconciles a confirmed M-Pesa C2B Paybill webhook callback into BillingStoreState:
 * - Matches tenant by BillRefNumber (or MSISDN fallback)
 * - Allocates TransAmount across unpaid invoices (oldest cycle first)
 * - Creates PaymentRecord(s) with status 'Completed' & M-Pesa metadata
 * - Logs customer payment confirmation receipt in Notifications
 * - Records full MpesaC2BTransaction audit log entry (idempotent by TransID)
 */
export function reconcileMpesaC2BIntoState(
  prevState: BillingStoreState,
  payload: MpesaConfirmationInput
): { nextState: BillingStoreState; result: MpesaReconcileResult } {
  const transId = String(payload.TransID || '').trim().toUpperCase();
  const transAmount = Math.max(0, Math.round(Number(payload.TransAmount) || 0));
  const billRefNumber = String(payload.BillRefNumber || '').trim();
  const msisdn = String(payload.MSISDN || '').trim();
  const shortCode = String(payload.BusinessShortCode || '303030').trim();
  const parsedTime = parseSafaricomTransTime(payload.TransTime);

  const existingTx = (prevState.mpesaTransactions ?? []).find(
    (t) => t.transId.toUpperCase() === transId
  );
  const existingPay = prevState.payments.find(
    (p) => p.reference.toUpperCase() === transId
  );

  if (existingTx || existingPay) {
    const matchedConnection = existingTx?.connectionId
      ? prevState.connections.find((c) => c.id === existingTx.connectionId) ?? null
      : matchConnectionByBillRef(prevState.connections, billRefNumber, msisdn);
    const fallbackTx: MpesaC2BTransaction = existingTx ?? {
      id: `c2b-${transId}`,
      transId,
      transTime: parsedTime.isoTimestamp,
      transAmount,
      businessShortCode: shortCode,
      billRefNumber,
      msisdn,
      customerName: matchedConnection?.customerName ?? 'Water Customer',
      connectionId: matchedConnection?.id,
      accountCode: matchedConnection?.accountCode,
      matchedInvoiceIds: existingPay ? [existingPay.invoiceId] : [],
      appliedAmountKsh: existingPay?.amountKsh ?? transAmount,
      unallocatedKsh: 0,
      status: 'Completed',
      receivedAt: parsedTime.isoTimestamp,
      reconciled: true,
    };
    return {
      nextState: prevState,
      result: {
        transaction: fallbackTx,
        matchedConnection,
        updatedInvoices: [],
        createdPayments: [],
        createdNotification: null,
        alreadyProcessed: true,
      },
    };
  }

  const matchedConnection = matchConnectionByBillRef(
    prevState.connections,
    billRefNumber,
    msisdn
  );

  const payerFullName = [payload.FirstName, payload.MiddleName, payload.LastName]
    .filter(Boolean)
    .join(' ')
    .trim();

  if (!matchedConnection) {
    const unmatchedTx: MpesaC2BTransaction = {
      id: `c2b-${transId}`,
      transId,
      transTime: parsedTime.isoTimestamp,
      transAmount,
      businessShortCode: shortCode,
      billRefNumber: billRefNumber || 'UNKNOWN',
      msisdn,
      customerName: payerFullName || 'Unmatched Paybill Payer',
      matchedInvoiceIds: [],
      appliedAmountKsh: 0,
      unallocatedKsh: transAmount,
      status: 'Unmatched',
      receivedAt: parsedTime.isoTimestamp,
      reconciled: true,
    };
    return {
      nextState: {
        ...prevState,
        mpesaTransactions: [unmatchedTx, ...(prevState.mpesaTransactions ?? [])],
      },
      result: {
        transaction: unmatchedTx,
        matchedConnection: null,
        updatedInvoices: [],
        createdPayments: [],
        createdNotification: null,
        alreadyProcessed: false,
      },
    };
  }

  // Find tenant invoices, sorted oldest cycle first for FIFO settlement
  const connInvoices = prevState.invoices
    .filter((i) => i.connectionId === matchedConnection.id)
    .sort((a, b) => a.cycleId.localeCompare(b.cycleId));

  const openInvoices = connInvoices.filter((i) => i.amountPaidKsh < i.totalPayableKsh);

  let remainingToApply = transAmount;
  const updatedInvoiceMap = new Map<string, WaterInvoice>();
  const createdPayments: PaymentRecord[] = [];
  const matchedInvoiceIds: string[] = [];

  for (const inv of openInvoices) {
    if (remainingToApply <= 0) break;
    const balance = Math.max(0, inv.totalPayableKsh - inv.amountPaidKsh);
    if (balance <= 0) continue;

    const applied = Math.min(balance, remainingToApply);
    remainingToApply -= applied;

    const nextPaid = inv.amountPaidKsh + applied;
    const updatedInv: WaterInvoice = {
      ...inv,
      amountPaidKsh: nextPaid,
      status: computeNextInvoiceStatus(
        inv.totalPayableKsh,
        nextPaid,
        inv.dueDate,
        inv.arrearsBroughtForwardKsh
      ),
    };
    updatedInvoiceMap.set(inv.id, updatedInv);
    matchedInvoiceIds.push(inv.id);

    createdPayments.push({
      id:
        createdPayments.length === 0
          ? `pay-mpesa-${transId}`
          : `pay-mpesa-${transId}-${createdPayments.length + 1}`,
      invoiceId: inv.id,
      paidDate: parsedTime.date,
      amountKsh: applied,
      method: 'M-Pesa Paybill' as PaymentMethod,
      reference: transId,
      status: 'Completed',
      connectionId: matchedConnection.id,
      accountCode: matchedConnection.accountCode,
      billRefNumber: billRefNumber || matchedConnection.accountCode,
      msisdn,
      shortCode,
    });
  }

  // If tenant had no open balance (advance payment) but has an invoice, attach completed receipt to latest invoice
  if (createdPayments.length === 0 && transAmount > 0 && connInvoices.length > 0) {
    const latestInv = connInvoices[connInvoices.length - 1];
    matchedInvoiceIds.push(latestInv.id);
    createdPayments.push({
      id: `pay-mpesa-${transId}`,
      invoiceId: latestInv.id,
      paidDate: parsedTime.date,
      amountKsh: transAmount,
      method: 'M-Pesa Paybill' as PaymentMethod,
      reference: transId,
      status: 'Completed',
      connectionId: matchedConnection.id,
      accountCode: matchedConnection.accountCode,
      billRefNumber: billRefNumber || matchedConnection.accountCode,
      msisdn,
      shortCode,
    });
  }

  const appliedAmountKsh = transAmount - remainingToApply;
  const primaryInvoice = updatedInvoiceMap.get(matchedInvoiceIds[0]) ?? connInvoices[connInvoices.length - 1];

  const createdNotification: NotificationLog = {
    id: `ntf-mpesa-${transId}`,
    connectionId: matchedConnection.id,
    customerName: matchedConnection.customerName,
    accountCode: matchedConnection.accountCode,
    invoiceId: primaryInvoice?.id,
    invoiceNumber: primaryInvoice?.invoiceNumber,
    channel: 'SMS',
    recipient: msisdn || matchedConnection.phone,
    messageSummary: `M-Pesa Paybill ${shortCode} receipt ${transId}: KSh ${transAmount.toLocaleString(
      'en-KE'
    )} credited to ${matchedConnection.accountCode} (${
      primaryInvoice ? primaryInvoice.invoiceNumber : 'Account Ledger'
    }). Status: Completed.`,
    status: 'Delivered',
    sentDate: parsedTime.date,
    sentTime: parsedTime.timeStr,
    dispatchedBy: 'M-Pesa C2B',
  };

  const c2bTransaction: MpesaC2BTransaction = {
    id: `c2b-${transId}`,
    transId,
    transTime: parsedTime.isoTimestamp,
    transAmount,
    businessShortCode: shortCode,
    billRefNumber: billRefNumber || matchedConnection.accountCode,
    msisdn,
    customerName: matchedConnection.customerName,
    connectionId: matchedConnection.id,
    accountCode: matchedConnection.accountCode,
    matchedInvoiceIds,
    appliedAmountKsh,
    unallocatedKsh: remainingToApply,
    status: 'Completed',
    receivedAt: parsedTime.isoTimestamp,
    reconciled: true,
  };

  const nextInvoices = prevState.invoices.map((inv) => updatedInvoiceMap.get(inv.id) ?? inv);

  return {
    nextState: {
      ...prevState,
      invoices: nextInvoices,
      payments: [...createdPayments, ...prevState.payments],
      notifications: [createdNotification, ...(prevState.notifications ?? [])],
      mpesaTransactions: [c2bTransaction, ...(prevState.mpesaTransactions ?? [])],
    },
    result: {
      transaction: c2bTransaction,
      matchedConnection,
      updatedInvoices: Array.from(updatedInvoiceMap.values()),
      createdPayments,
      createdNotification,
      alreadyProcessed: false,
    },
  };
}
