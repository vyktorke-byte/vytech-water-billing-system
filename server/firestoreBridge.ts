import fs from 'node:fs';
import path from 'node:path';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import type {
  BillingStoreState,
  MeterReading,
  MpesaC2BTransaction,
  NotificationLog,
  PaymentRecord,
  TariffCategory,
  TariffSchedule,
  WaterConnection,
  WaterInvoice,
} from '../src/types/billing.ts';
import type { MpesaReconcileResult } from '../src/lib/mpesaReconcile.ts';

interface FirebaseAppletConfig {
  projectId: string;
  firestoreDatabaseId?: string;
}

const WORKSPACE_COLLECTION = 'workspaces';
const WORKSPACE_ID = 'gawanji-heights';

let cachedDb: Firestore | null = null;
let initAttempted = false;
let adminAvailable = false;

function readAppletConfig(): FirebaseAppletConfig | null {
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) return null;
    return JSON.parse(fs.readFileSync(configPath, 'utf8')) as FirebaseAppletConfig;
  } catch {
    return null;
  }
}

export function getAdminFirestore(): Firestore | null {
  if (initAttempted) return adminAvailable ? cachedDb : null;
  initAttempted = true;

  const config = readAppletConfig();
  if (!config?.projectId) {
    adminAvailable = false;
    return null;
  }

  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  const hasExplicitCreds =
    Boolean(serviceAccountRaw) || Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim());

  if (!hasExplicitCreds) {
    adminAvailable = false;
    return null;
  }

  try {
    let app: App;
    const existing = getApps();
    if (existing.length > 0) {
      app = existing[0];
    } else if (serviceAccountRaw) {
      const parsed = JSON.parse(serviceAccountRaw);
      app = initializeApp({
        credential: cert(parsed),
        projectId: config.projectId,
      });
    } else {
      app = initializeApp({
        projectId: config.projectId,
      });
    }

    cachedDb = config.firestoreDatabaseId
      ? getFirestore(app, config.firestoreDatabaseId)
      : getFirestore(app);
    adminAvailable = true;
    return cachedDb;
  } catch (err) {
    console.warn('[MajiTrack Backend] Firebase Admin initialization skipped:', (err as Error).message);
    adminAvailable = false;
    cachedDb = null;
    return null;
  }
}

export function isFirestoreAdminReady(): boolean {
  return Boolean(getAdminFirestore());
}

const DEFAULT_TARIFF_FALLBACK: Record<TariffCategory, TariffSchedule> = {
  Residents: {
    category: 'Residents' as TariffCategory,
    ratePerM3: 150,
    seweragePercent: 0,
  },
  'Heavy Clients': {
    category: 'Heavy Clients' as TariffCategory,
    ratePerM3: 180,
    seweragePercent: 0,
  },
};

export async function loadWorkspaceLedgerFromAdmin(): Promise<BillingStoreState | null> {
  const db = getAdminFirestore();
  if (!db) return null;

  try {
    const baseRef = db.collection(WORKSPACE_COLLECTION).doc(WORKSPACE_ID);
    const [connSnap, readSnap, invSnap, paySnap, notifSnap, mpesaSnap, tariffSnap] =
      await Promise.all([
        baseRef.collection('connections').get(),
        baseRef.collection('readings').get(),
        baseRef.collection('invoices').get(),
        baseRef.collection('payments').get(),
        baseRef.collection('notifications').get(),
        baseRef.collection('mpesaTransactions').get(),
        baseRef.collection('settings').doc('tariffs').get(),
      ]);

    const hasAnyDocs =
      !connSnap.empty ||
      !invSnap.empty ||
      !paySnap.empty ||
      !mpesaSnap.empty ||
      tariffSnap.exists;

    if (!hasAnyDocs) return null;

    const connections: WaterConnection[] = connSnap.docs.map((d) => {
      const data = d.data();
      return {
        id: String(data.id ?? d.id),
        accountCode: String(data.accountCode ?? ''),
        customerName: String(data.customerName ?? ''),
        premiseAddress: String(data.premiseAddress ?? ''),
        category: data.category as TariffCategory,
        meterSerial: String(data.meterSerial ?? ''),
        status: data.status,
        phone: String(data.phone ?? ''),
        email: String(data.email ?? ''),
        lastReadingTenthsM3: Number(data.lastReadingTenthsM3 ?? 0),
        lastReadCycle: data.lastReadCycle,
      };
    });

    const readings: MeterReading[] = readSnap.docs.map((d) => {
      const data = d.data();
      return {
        id: String(data.id ?? d.id),
        connectionId: String(data.connectionId ?? ''),
        cycleId: data.cycleId,
        readDate: data.readDate,
        previousTenthsM3: Number(data.previousTenthsM3 ?? 0),
        currentTenthsM3: Number(data.currentTenthsM3 ?? 0),
        consumptionTenthsM3: Number(data.consumptionTenthsM3 ?? 0),
        readerInitials: String(data.readerInitials ?? 'OP'),
        anomalyNote: typeof data.anomalyNote === 'string' ? data.anomalyNote : undefined,
        isSpikeFlagged: Boolean(data.isSpikeFlagged),
        photoUrl: typeof data.photoUrl === 'string' ? data.photoUrl : undefined,
      };
    });

    const invoices: WaterInvoice[] = invSnap.docs.map((d) => {
      const data = d.data();
      return {
        id: String(data.id ?? d.id),
        invoiceNumber: String(data.invoiceNumber ?? ''),
        connectionId: String(data.connectionId ?? ''),
        cycleId: data.cycleId,
        readingId: String(data.readingId ?? ''),
        issueDate: data.issueDate,
        dueDate: data.dueDate,
        previousTenthsM3: Number(data.previousTenthsM3 ?? 0),
        currentTenthsM3: Number(data.currentTenthsM3 ?? 0),
        consumptionTenthsM3: Number(data.consumptionTenthsM3 ?? 0),
        ratePerM3: Number(data.ratePerM3 ?? 0),
        volumetricKsh: Number(data.volumetricKsh ?? 0),
        sewerageKsh: Number(data.sewerageKsh ?? 0),
        arrearsBroughtForwardKsh: Number(data.arrearsBroughtForwardKsh ?? 0),
        cycleChargesKsh: Number(data.cycleChargesKsh ?? 0),
        totalPayableKsh: Number(data.totalPayableKsh ?? 0),
        amountPaidKsh: Number(data.amountPaidKsh ?? 0),
        status: data.status,
      };
    });

    const payments: PaymentRecord[] = paySnap.docs.map((d) => {
      const data = d.data();
      return {
        id: String(data.id ?? d.id),
        invoiceId: String(data.invoiceId ?? ''),
        paidDate: data.paidDate,
        amountKsh: Number(data.amountKsh ?? 0),
        method: data.method,
        reference: String(data.reference ?? ''),
        status: (data.status as PaymentRecord['status']) ?? 'Completed',
        connectionId: typeof data.connectionId === 'string' ? data.connectionId : undefined,
        accountCode: typeof data.accountCode === 'string' ? data.accountCode : undefined,
        billRefNumber: typeof data.billRefNumber === 'string' ? data.billRefNumber : undefined,
        msisdn: typeof data.msisdn === 'string' ? data.msisdn : undefined,
        shortCode: typeof data.shortCode === 'string' ? data.shortCode : undefined,
      };
    });

    const notifications: NotificationLog[] = notifSnap.docs.map((d) => {
      const data = d.data();
      return {
        id: String(data.id ?? d.id),
        connectionId: String(data.connectionId ?? ''),
        customerName: String(data.customerName ?? ''),
        accountCode: String(data.accountCode ?? ''),
        invoiceId: typeof data.invoiceId === 'string' ? data.invoiceId : undefined,
        invoiceNumber: typeof data.invoiceNumber === 'string' ? data.invoiceNumber : undefined,
        channel: data.channel,
        recipient: String(data.recipient ?? ''),
        messageSummary: String(data.messageSummary ?? ''),
        status: data.status,
        sentDate: data.sentDate,
        sentTime: String(data.sentTime ?? '09:00'),
        dispatchedBy: String(data.dispatchedBy ?? 'Operator'),
      };
    });

    const mpesaTransactions: MpesaC2BTransaction[] = mpesaSnap.docs.map((d) => {
      const data = d.data();
      return {
        id: String(data.id ?? d.id),
        transId: String(data.transId ?? ''),
        transTime: String(data.transTime ?? ''),
        transAmount: Number(data.transAmount ?? 0),
        businessShortCode: String(data.businessShortCode ?? '303030'),
        billRefNumber: String(data.billRefNumber ?? ''),
        msisdn: String(data.msisdn ?? ''),
        customerName: String(data.customerName ?? ''),
        connectionId: typeof data.connectionId === 'string' ? data.connectionId : undefined,
        accountCode: typeof data.accountCode === 'string' ? data.accountCode : undefined,
        matchedInvoiceIds: Array.isArray(data.matchedInvoiceIds)
          ? data.matchedInvoiceIds.map(String)
          : [],
        appliedAmountKsh: Number(data.appliedAmountKsh ?? 0),
        unallocatedKsh: Number(data.unallocatedKsh ?? 0),
        status: data.status,
        receivedAt: String(data.receivedAt ?? ''),
        reconciled: Boolean(data.reconciled ?? true),
      };
    });

    const tariffs = structuredClone(DEFAULT_TARIFF_FALLBACK);
    if (tariffSnap.exists) {
      const t = tariffSnap.data() ?? {};
      tariffs['Residents' as TariffCategory] = {
        category: 'Residents' as TariffCategory,
        ratePerM3: Number(t.residentsRatePerM3 ?? 150),
        seweragePercent: Number(t.residentsSeweragePercent ?? 0),
      };
      tariffs['Heavy Clients' as TariffCategory] = {
        category: 'Heavy Clients' as TariffCategory,
        ratePerM3: Number(t.heavyRatePerM3 ?? 180),
        seweragePercent: Number(t.heavySeweragePercent ?? 0),
      };
    }

    return {
      version: 1,
      connections,
      readings,
      invoices,
      payments,
      tariffs,
      notifications,
      mpesaTransactions,
    };
  } catch (err) {
    console.warn('[MajiTrack Backend] Failed reading workspace from Firestore Admin:', (err as Error).message);
    return null;
  }
}

export async function persistMpesaC2BToFirestoreAdmin(
  reconcile: MpesaReconcileResult
): Promise<boolean> {
  const db = getAdminFirestore();
  if (!db) return false;

  try {
    const baseRef = db.collection(WORKSPACE_COLLECTION).doc(WORKSPACE_ID);
    const batch = db.batch();
    const ownerId = 'mpesa-c2b-webhook';

    for (const inv of reconcile.updatedInvoices) {
      const invRef = baseRef.collection('invoices').doc(inv.id);
      batch.set(invRef, {
        ...inv,
        ownerId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    for (const pay of reconcile.createdPayments) {
      const payRef = baseRef.collection('payments').doc(pay.id);
      const payPayload: Record<string, unknown> = {
        id: pay.id,
        ownerId,
        invoiceId: pay.invoiceId,
        paidDate: pay.paidDate,
        amountKsh: pay.amountKsh,
        method: pay.method,
        reference: pay.reference,
        status: pay.status ?? 'Completed',
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (pay.connectionId) payPayload.connectionId = pay.connectionId;
      if (pay.accountCode) payPayload.accountCode = pay.accountCode;
      if (pay.billRefNumber) payPayload.billRefNumber = pay.billRefNumber;
      if (pay.msisdn) payPayload.msisdn = pay.msisdn;
      if (pay.shortCode) payPayload.shortCode = pay.shortCode;
      batch.set(payRef, payPayload);
    }

    if (reconcile.createdNotification) {
      const n = reconcile.createdNotification;
      const nRef = baseRef.collection('notifications').doc(n.id);
      const notifPayload: Record<string, unknown> = {
        id: n.id,
        ownerId,
        connectionId: n.connectionId,
        customerName: n.customerName.slice(0, 120),
        accountCode: n.accountCode.slice(0, 40),
        channel: n.channel,
        recipient: n.recipient.slice(0, 254),
        messageSummary: n.messageSummary.slice(0, 500),
        status: n.status,
        sentDate: n.sentDate,
        sentTime: n.sentTime,
        dispatchedBy: n.dispatchedBy,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (n.invoiceId) notifPayload.invoiceId = n.invoiceId;
      if (n.invoiceNumber) notifPayload.invoiceNumber = n.invoiceNumber;
      batch.set(nRef, notifPayload);
    }

    const tx = reconcile.transaction;
    const txRef = baseRef.collection('mpesaTransactions').doc(tx.id);
    const txPayload: Record<string, unknown> = {
      id: tx.id,
      ownerId,
      transId: tx.transId.slice(0, 60),
      transTime: tx.transTime.slice(0, 60),
      transAmount: tx.transAmount,
      businessShortCode: tx.businessShortCode.slice(0, 20),
      billRefNumber: tx.billRefNumber.slice(0, 80),
      msisdn: tx.msisdn.slice(0, 40),
      customerName: tx.customerName.slice(0, 120),
      matchedInvoiceIds: tx.matchedInvoiceIds.slice(0, 25),
      appliedAmountKsh: tx.appliedAmountKsh,
      unallocatedKsh: tx.unallocatedKsh,
      status: tx.status,
      receivedAt: tx.receivedAt.slice(0, 60),
      reconciled: true,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (tx.connectionId) txPayload.connectionId = tx.connectionId;
    if (tx.accountCode) txPayload.accountCode = tx.accountCode;
    batch.set(txRef, txPayload);

    await batch.commit();
    return true;
  } catch (err) {
    console.warn('[MajiTrack Backend] Firestore Admin batch commit failed:', (err as Error).message);
    return false;
  }
}
