import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  BillingStoreState,
  MeterReading,
  MpesaC2BTransaction,
  NotificationChannel,
  NotificationLog,
  NotificationStatus,
  OperatorProfile,
  PaybillSettings,
  PaymentRecord,
  StaffAccessEntry,
  TariffCategory,
  UserRole,
  WaterConnection,
  WaterInvoice,
} from '../types/billing';
import { DEFAULT_PAYBILL_SETTINGS, DEFAULT_TARIFFS } from '../data/seedData';
import { db, handleFirestoreError, OperationType } from './firebase';

export const BOOTSTRAP_SUPERADMIN_EMAIL = 'vyktorke@gmail.com';
export const SHARED_WORKSPACE_ID = 'gawanji-heights';

const MAX_PHOTO_CHARS = 195000;

export type WorkspaceScope =
  | { kind: 'workspace'; id: string }
  | { kind: 'user'; id: string };

export function getWorkspaceScope(uid: string, role: UserRole): WorkspaceScope {
  if (role === 'superadmin' || role === 'admin') {
    return { kind: 'workspace', id: SHARED_WORKSPACE_ID };
  }
  return { kind: 'user', id: uid };
}

function scopeRootSegments(scope: WorkspaceScope): [string, string] {
  return scope.kind === 'workspace'
    ? ['workspaces', scope.id]
    : ['users', scope.id];
}

function sanitizeLocalDate(d: { year: number; month: number; day: number }) {
  return {
    year: Math.round(d.year),
    month: Math.round(d.month),
    day: Math.round(d.day),
  };
}

function serializeConnection(uid: string, conn: WaterConnection) {
  return {
    id: conn.id,
    ownerId: uid,
    accountCode: conn.accountCode,
    customerName: conn.customerName,
    premiseAddress: conn.premiseAddress,
    category: conn.category,
    meterSerial: conn.meterSerial,
    status: conn.status,
    phone: conn.phone,
    email: conn.email,
    lastReadingTenthsM3: Math.max(0, Math.round(conn.lastReadingTenthsM3)),
    lastReadCycle: conn.lastReadCycle,
    updatedAt: serverTimestamp(),
  };
}

function serializeReading(uid: string, reading: MeterReading) {
  const prev = Math.max(0, Math.round(reading.previousTenthsM3));
  const curr = Math.max(prev, Math.round(reading.currentTenthsM3));
  const payload: Record<string, unknown> = {
    id: reading.id,
    ownerId: uid,
    connectionId: reading.connectionId,
    cycleId: reading.cycleId,
    readDate: sanitizeLocalDate(reading.readDate),
    previousTenthsM3: prev,
    currentTenthsM3: curr,
    consumptionTenthsM3: Math.max(0, Math.round(reading.consumptionTenthsM3)),
    readerInitials: reading.readerInitials || 'OP',
    isSpikeFlagged: Boolean(reading.isSpikeFlagged),
    updatedAt: serverTimestamp(),
  };
  if (reading.anomalyNote && reading.anomalyNote.trim()) {
    payload.anomalyNote = reading.anomalyNote.trim().slice(0, 300);
  }
  if (reading.photoUrl && reading.photoUrl.length <= MAX_PHOTO_CHARS) {
    payload.photoUrl = reading.photoUrl;
  }
  return payload;
}

function serializeInvoice(uid: string, inv: WaterInvoice) {
  return {
    id: inv.id,
    ownerId: uid,
    invoiceNumber: inv.invoiceNumber,
    connectionId: inv.connectionId,
    cycleId: inv.cycleId,
    readingId: inv.readingId,
    issueDate: sanitizeLocalDate(inv.issueDate),
    dueDate: sanitizeLocalDate(inv.dueDate),
    previousTenthsM3: Math.max(0, Math.round(inv.previousTenthsM3)),
    currentTenthsM3: Math.max(0, Math.round(inv.currentTenthsM3)),
    consumptionTenthsM3: Math.max(0, Math.round(inv.consumptionTenthsM3)),
    ratePerM3: inv.ratePerM3,
    volumetricKsh: inv.volumetricKsh,
    sewerageKsh: inv.sewerageKsh,
    arrearsBroughtForwardKsh: inv.arrearsBroughtForwardKsh,
    cycleChargesKsh: inv.cycleChargesKsh,
    totalPayableKsh: inv.totalPayableKsh,
    amountPaidKsh: Math.min(inv.totalPayableKsh, Math.max(0, inv.amountPaidKsh)),
    status: inv.status,
    updatedAt: serverTimestamp(),
  };
}

function serializePayment(uid: string, pay: PaymentRecord) {
  const payload: Record<string, unknown> = {
    id: pay.id,
    ownerId: uid,
    invoiceId: pay.invoiceId,
    paidDate: sanitizeLocalDate(pay.paidDate),
    amountKsh: Math.max(1, pay.amountKsh),
    method: pay.method,
    reference: pay.reference,
    status: pay.status ?? 'Completed',
    updatedAt: serverTimestamp(),
  };
  if (pay.connectionId && pay.connectionId.trim()) payload.connectionId = pay.connectionId.trim();
  if (pay.accountCode && pay.accountCode.trim()) payload.accountCode = pay.accountCode.trim().slice(0, 40);
  if (pay.billRefNumber && pay.billRefNumber.trim()) payload.billRefNumber = pay.billRefNumber.trim().slice(0, 80);
  if (pay.msisdn && pay.msisdn.trim()) payload.msisdn = pay.msisdn.trim().slice(0, 40);
  if (pay.shortCode && pay.shortCode.trim()) payload.shortCode = pay.shortCode.trim().slice(0, 20);
  return payload;
}

function serializeTariffs(uid: string, tariffs: BillingStoreState['tariffs']) {
  const residents = tariffs[TariffCategory.Residential] ?? DEFAULT_TARIFFS[TariffCategory.Residential];
  const heavy = tariffs[TariffCategory.HeavyClients] ?? DEFAULT_TARIFFS[TariffCategory.HeavyClients];
  return {
    ownerId: uid,
    residentsRatePerM3: residents.ratePerM3,
    residentsSeweragePercent: residents.seweragePercent,
    heavyRatePerM3: heavy.ratePerM3,
    heavySeweragePercent: heavy.seweragePercent,
    updatedAt: serverTimestamp(),
  };
}

function serializePaybillSettings(uid: string, paybill?: PaybillSettings) {
  const effective = paybill ?? DEFAULT_PAYBILL_SETTINGS;
  const payload: Record<string, unknown> = {
    ownerId: uid,
    primaryPaybill: (effective.primaryPaybill || DEFAULT_PAYBILL_SETTINGS.primaryPaybill).trim().slice(0, 20),
    businessName: (effective.businessName || DEFAULT_PAYBILL_SETTINGS.businessName).trim().slice(0, 120),
    accountLabel: (effective.accountLabel || DEFAULT_PAYBILL_SETTINGS.accountLabel).trim().slice(0, 60),
    updatedAt: serverTimestamp(),
  };
  if (effective.alternatePaybill && effective.alternatePaybill.trim()) {
    payload.alternatePaybill = effective.alternatePaybill.trim().slice(0, 20);
  }
  return payload;
}

function serializeNotification(uid: string, notif: NotificationLog) {
  const payload: Record<string, unknown> = {
    id: notif.id,
    ownerId: uid,
    connectionId: notif.connectionId,
    customerName: (notif.customerName || 'Customer').slice(0, 120),
    accountCode: (notif.accountCode || 'N/A').slice(0, 40),
    channel: notif.channel,
    recipient: (notif.recipient || 'N/A').slice(0, 254),
    messageSummary: (notif.messageSummary || 'Notification dispatched').slice(0, 500),
    status: notif.status,
    sentDate: sanitizeLocalDate(notif.sentDate),
    sentTime: (notif.sentTime || '09:00').slice(0, 20),
    dispatchedBy: (notif.dispatchedBy || 'Operator').slice(0, 120),
    updatedAt: serverTimestamp(),
  };
  if (notif.invoiceId && notif.invoiceId.trim()) {
    payload.invoiceId = notif.invoiceId.trim();
  }
  if (notif.invoiceNumber && notif.invoiceNumber.trim()) {
    payload.invoiceNumber = notif.invoiceNumber.trim().slice(0, 40);
  }
  return payload;
}

function serializeMpesaTransaction(uid: string, tx: MpesaC2BTransaction) {
  const payload: Record<string, unknown> = {
    id: tx.id,
    ownerId: uid,
    transId: (tx.transId || tx.id).slice(0, 60),
    transTime: (tx.transTime || tx.receivedAt || new Date().toISOString()).slice(0, 60),
    transAmount: Math.max(0, Number(tx.transAmount) || 0),
    businessShortCode: (tx.businessShortCode || '303030').slice(0, 20),
    billRefNumber: (tx.billRefNumber || 'N/A').slice(0, 80),
    msisdn: (tx.msisdn || '').slice(0, 40),
    customerName: (tx.customerName || 'Paybill Payer').slice(0, 120),
    matchedInvoiceIds: (tx.matchedInvoiceIds ?? []).slice(0, 25),
    appliedAmountKsh: Math.max(0, Number(tx.appliedAmountKsh) || 0),
    unallocatedKsh: Math.max(0, Number(tx.unallocatedKsh) || 0),
    status: tx.status || 'Completed',
    receivedAt: (tx.receivedAt || new Date().toISOString()).slice(0, 60),
    reconciled: Boolean(tx.reconciled ?? true),
    updatedAt: serverTimestamp(),
  };
  if (tx.connectionId && tx.connectionId.trim()) payload.connectionId = tx.connectionId.trim();
  if (tx.accountCode && tx.accountCode.trim()) payload.accountCode = tx.accountCode.trim().slice(0, 40);
  return payload;
}

export async function resolveVerifiedUserRole(user: User): Promise<UserRole> {
  const emailLower = (user.email || '').trim().toLowerCase();
  if (!emailLower) return 'operator';
  if (emailLower === BOOTSTRAP_SUPERADMIN_EMAIL) {
    return 'superadmin';
  }
  const accessRef = doc(db, 'staffAccess', emailLower);
  try {
    const snap = await getDoc(accessRef);
    if (snap.exists()) {
      const r = snap.data().role;
      if (r === 'superadmin' || r === 'admin' || r === 'operator') {
        return r;
      }
    }
  } catch {
    // No staffAccess entry or permission denied -> default operator role
  }
  return 'operator';
}

export async function ensureOperatorProfile(user: User): Promise<OperatorProfile> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  const resolvedRole = await resolveVerifiedUserRole(user);

  try {
    const emailLower = (user.email || '').trim().toLowerCase();
    const displayName = (user.displayName || user.email || 'MajiTrack Operator').slice(0, 120);

    // Ensure bootstrapped superadmin has a visible staffAccess directory record
    if (emailLower === BOOTSTRAP_SUPERADMIN_EMAIL) {
      const saRef = doc(db, 'staffAccess', emailLower);
      const saSnap = await getDoc(saRef);
      if (!saSnap.exists()) {
        await setDoc(saRef, {
          email: emailLower,
          role: 'superadmin',
          displayName,
          assignedByEmail: emailLower,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    const snap = await getDoc(ref);
    const baseData: Record<string, unknown> = {
      uid: user.uid,
      email: (user.email || '').slice(0, 254),
      displayName,
      role: resolvedRole,
      updatedAt: serverTimestamp(),
    };
    if (user.photoURL && user.photoURL.length <= 512) {
      baseData.photoURL = user.photoURL;
    }

    if (!snap.exists()) {
      await setDoc(ref, {
        ...baseData,
        createdAt: serverTimestamp(),
      });
    } else {
      const existing = snap.data();
      await setDoc(
        ref,
        {
          ...baseData,
          role: resolvedRole,
          createdAt: existing.createdAt || serverTimestamp(),
        },
        { merge: true }
      );
    }

    return {
      uid: user.uid,
      email: (user.email || '').slice(0, 254),
      displayName,
      photoURL: user.photoURL || undefined,
      role: resolvedRole,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function loadBillingStateFromScope(
  scope: WorkspaceScope
): Promise<BillingStoreState | null> {
  const [rootCol, rootDocId] = scopeRootSegments(scope);
  const basePath = `${rootCol}/${rootDocId}`;
  try {
    const [connSnap, readSnap, invSnap, paySnap, notifSnap, mpesaSnap, tariffSnap, paybillSnap] =
      await Promise.all([
        getDocs(collection(db, rootCol, rootDocId, 'connections')),
        getDocs(collection(db, rootCol, rootDocId, 'readings')),
        getDocs(collection(db, rootCol, rootDocId, 'invoices')),
        getDocs(collection(db, rootCol, rootDocId, 'payments')),
        getDocs(collection(db, rootCol, rootDocId, 'notifications')),
        getDocs(collection(db, rootCol, rootDocId, 'mpesaTransactions')),
        getDoc(doc(db, rootCol, rootDocId, 'settings', 'tariffs')),
        getDoc(doc(db, rootCol, rootDocId, 'settings', 'paybill')),
      ]);

    const hasAnyDocs =
      !connSnap.empty ||
      !readSnap.empty ||
      !invSnap.empty ||
      !paySnap.empty ||
      !notifSnap.empty ||
      !mpesaSnap.empty ||
      tariffSnap.exists() ||
      paybillSnap.exists();

    if (!hasAnyDocs) {
      return null;
    }

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

    const tariffs = structuredClone(DEFAULT_TARIFFS);
    if (tariffSnap.exists()) {
      const t = tariffSnap.data();
      tariffs[TariffCategory.Residential] = {
        category: TariffCategory.Residential,
        ratePerM3: Number(t.residentsRatePerM3 ?? 150),
        seweragePercent: Number(t.residentsSeweragePercent ?? 0),
      };
      tariffs[TariffCategory.HeavyClients] = {
        category: TariffCategory.HeavyClients,
        ratePerM3: Number(t.heavyRatePerM3 ?? 180),
        seweragePercent: Number(t.heavySeweragePercent ?? 0),
      };
    }

    const notifications: NotificationLog[] = notifSnap.docs
      .map((d) => {
        const data = d.data();
        return {
          id: String(data.id ?? d.id),
          connectionId: String(data.connectionId ?? ''),
          customerName: String(data.customerName ?? ''),
          accountCode: String(data.accountCode ?? ''),
          invoiceId: typeof data.invoiceId === 'string' ? data.invoiceId : undefined,
          invoiceNumber: typeof data.invoiceNumber === 'string' ? data.invoiceNumber : undefined,
          channel: (data.channel as NotificationChannel) || 'SMS',
          recipient: String(data.recipient ?? ''),
          messageSummary: String(data.messageSummary ?? ''),
          status: (data.status as NotificationStatus) || 'Sent',
          sentDate: data.sentDate,
          sentTime: String(data.sentTime ?? '09:00'),
          dispatchedBy: String(data.dispatchedBy ?? 'Operator'),
        };
      })
      .sort((a, b) => {
        const scoreA = a.sentDate.year * 10000 + a.sentDate.month * 100 + a.sentDate.day;
        const scoreB = b.sentDate.year * 10000 + b.sentDate.month * 100 + b.sentDate.day;
        if (scoreA !== scoreB) return scoreB - scoreA;
        return b.sentTime.localeCompare(a.sentTime);
      });

    const mpesaTransactions: MpesaC2BTransaction[] = mpesaSnap.docs
      .map((d) => {
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
          status: (data.status as MpesaC2BTransaction['status']) || 'Completed',
          receivedAt: String(data.receivedAt ?? ''),
          reconciled: Boolean(data.reconciled ?? true),
        };
      })
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));

    const paybill: PaybillSettings = paybillSnap.exists()
      ? (() => {
          const p = paybillSnap.data();
          return {
            primaryPaybill: String(p.primaryPaybill ?? DEFAULT_PAYBILL_SETTINGS.primaryPaybill),
            alternatePaybill:
              typeof p.alternatePaybill === 'string' && p.alternatePaybill.trim()
                ? p.alternatePaybill.trim()
                : undefined,
            businessName: String(p.businessName ?? DEFAULT_PAYBILL_SETTINGS.businessName),
            accountLabel: String(p.accountLabel ?? DEFAULT_PAYBILL_SETTINGS.accountLabel),
          };
        })()
      : structuredClone(DEFAULT_PAYBILL_SETTINGS);

    return {
      version: 1,
      connections,
      readings,
      invoices,
      payments,
      tariffs,
      notifications,
      mpesaTransactions,
      paybill,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, basePath);
  }
}

type PendingOp =
  | { kind: 'set'; path: [string, string, string, string]; data: Record<string, unknown> }
  | { kind: 'delete'; path: [string, string, string, string] };

function collectDiffOps<T extends { id: string }>(
  scope: WorkspaceScope,
  uid: string,
  colName: string,
  prevItems: T[] | null,
  nextItems: T[],
  serializer: (uid: string, item: T) => Record<string, unknown>
): PendingOp[] {
  const [rootCol, rootDocId] = scopeRootSegments(scope);
  const ops: PendingOp[] = [];
  const prevMap = new Map((prevItems ?? []).map((item) => [item.id, item]));
  const nextMap = new Map(nextItems.map((item) => [item.id, item]));

  for (const item of nextItems) {
    const existing = prevMap.get(item.id);
    if (!existing || JSON.stringify(existing) !== JSON.stringify(item)) {
      ops.push({
        kind: 'set',
        path: [rootCol, rootDocId, colName, item.id],
        data: serializer(uid, item),
      });
    }
  }

  for (const oldItem of prevItems ?? []) {
    if (!nextMap.has(oldItem.id)) {
      ops.push({
        kind: 'delete',
        path: [rootCol, rootDocId, colName, oldItem.id],
      });
    }
  }

  return ops;
}

export async function syncBillingStateToScope(
  scope: WorkspaceScope,
  uid: string,
  prevState: BillingStoreState | null,
  nextState: BillingStoreState
): Promise<void> {
  const [rootCol, rootDocId] = scopeRootSegments(scope);
  const ops: PendingOp[] = [
    ...collectDiffOps(scope, uid, 'connections', prevState?.connections ?? null, nextState.connections, serializeConnection),
    ...collectDiffOps(scope, uid, 'readings', prevState?.readings ?? null, nextState.readings, serializeReading),
    ...collectDiffOps(scope, uid, 'invoices', prevState?.invoices ?? null, nextState.invoices, serializeInvoice),
    ...collectDiffOps(scope, uid, 'payments', prevState?.payments ?? null, nextState.payments, serializePayment),
    ...collectDiffOps(scope, uid, 'notifications', prevState?.notifications ?? null, nextState.notifications ?? [], serializeNotification),
    ...collectDiffOps(scope, uid, 'mpesaTransactions', prevState?.mpesaTransactions ?? null, nextState.mpesaTransactions ?? [], serializeMpesaTransaction),
  ];

  if (!prevState || JSON.stringify(prevState.tariffs) !== JSON.stringify(nextState.tariffs)) {
    ops.push({
      kind: 'set',
      path: [rootCol, rootDocId, 'settings', 'tariffs'],
      data: serializeTariffs(uid, nextState.tariffs),
    });
  }

  if (
    nextState.paybill &&
    (!prevState || JSON.stringify(prevState.paybill) !== JSON.stringify(nextState.paybill))
  ) {
    ops.push({
      kind: 'set',
      path: [rootCol, rootDocId, 'settings', 'paybill'],
      data: serializePaybillSettings(uid, nextState.paybill),
    });
  }

  if (ops.length === 0) return;

  const CHUNK_SIZE = 400;
  try {
    for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
      const chunk = ops.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const op of chunk) {
        const ref = doc(db, op.path[0], op.path[1], op.path[2], op.path[3]);
        if (op.kind === 'set') {
          batch.set(ref, op.data);
        } else {
          batch.delete(ref);
        }
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${rootCol}/${rootDocId}`);
  }
}

/**
 * Real-time Firestore listener subscription across all workspace billing collections.
 * Any backend C2B Paybill webhook write (or peer operator write) propagates instantaneously to the UI.
 */
export function subscribeBillingScope(
  scope: WorkspaceScope,
  onRemoteState: (state: BillingStoreState) => void,
  onError?: (err: unknown) => void
): () => void {
  const [rootCol, rootDocId] = scopeRootSegments(scope);
  const basePath = `${rootCol}/${rootDocId}`;

  const draft: {
    connections: WaterConnection[];
    readings: MeterReading[];
    invoices: WaterInvoice[];
    payments: PaymentRecord[];
    notifications: NotificationLog[];
    mpesaTransactions: MpesaC2BTransaction[];
    tariffs: BillingStoreState['tariffs'];
    paybill: PaybillSettings;
    ready: {
      connections: boolean;
      readings: boolean;
      invoices: boolean;
      payments: boolean;
      notifications: boolean;
      mpesa: boolean;
      tariffs: boolean;
      paybill: boolean;
    };
  } = {
    connections: [],
    readings: [],
    invoices: [],
    payments: [],
    notifications: [],
    mpesaTransactions: [],
    tariffs: structuredClone(DEFAULT_TARIFFS),
    paybill: structuredClone(DEFAULT_PAYBILL_SETTINGS),
    ready: {
      connections: false,
      readings: false,
      invoices: false,
      payments: false,
      notifications: false,
      mpesa: false,
      tariffs: false,
      paybill: false,
    },
  };

  let initialDelivered = false;

  const emitIfReady = () => {
    const r = draft.ready;
    if (
      !r.connections ||
      !r.readings ||
      !r.invoices ||
      !r.payments ||
      !r.notifications ||
      !r.mpesa ||
      !r.tariffs ||
      !r.paybill
    ) {
      return;
    }
    const hasAnyDocs =
      draft.connections.length > 0 ||
      draft.readings.length > 0 ||
      draft.invoices.length > 0 ||
      draft.payments.length > 0 ||
      draft.mpesaTransactions.length > 0;
    if (!hasAnyDocs && !initialDelivered) return;
    initialDelivered = true;

    onRemoteState({
      version: 1,
      connections: draft.connections,
      readings: draft.readings,
      invoices: draft.invoices,
      payments: draft.payments,
      tariffs: draft.tariffs,
      notifications: draft.notifications,
      mpesaTransactions: draft.mpesaTransactions,
      paybill: draft.paybill,
    });
  };

  const handleListenerError = (subPath: string) => (err: unknown) => {
    if (onError) {
      onError(err);
      return;
    }
    try {
      handleFirestoreError(err, OperationType.GET, `${basePath}/${subPath}`);
    } catch {
      // Handled safely
    }
  };

  const unsubConns = onSnapshot(
    collection(db, rootCol, rootDocId, 'connections'),
    (snap) => {
      draft.connections = snap.docs.map((d) => {
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
      draft.ready.connections = true;
      emitIfReady();
    },
    handleListenerError('connections')
  );

  const unsubReadings = onSnapshot(
    collection(db, rootCol, rootDocId, 'readings'),
    (snap) => {
      draft.readings = snap.docs.map((d) => {
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
      draft.ready.readings = true;
      emitIfReady();
    },
    handleListenerError('readings')
  );

  const unsubInvoices = onSnapshot(
    collection(db, rootCol, rootDocId, 'invoices'),
    (snap) => {
      draft.invoices = snap.docs.map((d) => {
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
      draft.ready.invoices = true;
      emitIfReady();
    },
    handleListenerError('invoices')
  );

  const unsubPayments = onSnapshot(
    collection(db, rootCol, rootDocId, 'payments'),
    (snap) => {
      draft.payments = snap.docs.map((d) => {
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
      draft.ready.payments = true;
      emitIfReady();
    },
    handleListenerError('payments')
  );

  const unsubNotifs = onSnapshot(
    collection(db, rootCol, rootDocId, 'notifications'),
    (snap) => {
      draft.notifications = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: String(data.id ?? d.id),
            connectionId: String(data.connectionId ?? ''),
            customerName: String(data.customerName ?? ''),
            accountCode: String(data.accountCode ?? ''),
            invoiceId: typeof data.invoiceId === 'string' ? data.invoiceId : undefined,
            invoiceNumber: typeof data.invoiceNumber === 'string' ? data.invoiceNumber : undefined,
            channel: (data.channel as NotificationChannel) || 'SMS',
            recipient: String(data.recipient ?? ''),
            messageSummary: String(data.messageSummary ?? ''),
            status: (data.status as NotificationStatus) || 'Sent',
            sentDate: data.sentDate,
            sentTime: String(data.sentTime ?? '09:00'),
            dispatchedBy: String(data.dispatchedBy ?? 'Operator'),
          };
        })
        .sort((a, b) => {
          const scoreA = a.sentDate.year * 10000 + a.sentDate.month * 100 + a.sentDate.day;
          const scoreB = b.sentDate.year * 10000 + b.sentDate.month * 100 + b.sentDate.day;
          if (scoreA !== scoreB) return scoreB - scoreA;
          return b.sentTime.localeCompare(a.sentTime);
        });
      draft.ready.notifications = true;
      emitIfReady();
    },
    handleListenerError('notifications')
  );

  const unsubMpesa = onSnapshot(
    collection(db, rootCol, rootDocId, 'mpesaTransactions'),
    (snap) => {
      draft.mpesaTransactions = snap.docs
        .map((d) => {
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
            status: (data.status as MpesaC2BTransaction['status']) || 'Completed',
            receivedAt: String(data.receivedAt ?? ''),
            reconciled: Boolean(data.reconciled ?? true),
          };
        })
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
      draft.ready.mpesa = true;
      emitIfReady();
    },
    handleListenerError('mpesaTransactions')
  );

  const unsubTariffs = onSnapshot(
    doc(db, rootCol, rootDocId, 'settings', 'tariffs'),
    (snap) => {
      const nextTariffs = structuredClone(DEFAULT_TARIFFS);
      if (snap.exists()) {
        const t = snap.data();
        nextTariffs[TariffCategory.Residential] = {
          category: TariffCategory.Residential,
          ratePerM3: Number(t.residentsRatePerM3 ?? 150),
          seweragePercent: Number(t.residentsSeweragePercent ?? 0),
        };
        nextTariffs[TariffCategory.HeavyClients] = {
          category: TariffCategory.HeavyClients,
          ratePerM3: Number(t.heavyRatePerM3 ?? 180),
          seweragePercent: Number(t.heavySeweragePercent ?? 0),
        };
      }
      draft.tariffs = nextTariffs;
      draft.ready.tariffs = true;
      emitIfReady();
    },
    handleListenerError('settings/tariffs')
  );

  const unsubPaybill = onSnapshot(
    doc(db, rootCol, rootDocId, 'settings', 'paybill'),
    (snap) => {
      if (snap.exists()) {
        const p = snap.data();
        draft.paybill = {
          primaryPaybill: String(p.primaryPaybill ?? DEFAULT_PAYBILL_SETTINGS.primaryPaybill),
          alternatePaybill:
            typeof p.alternatePaybill === 'string' && p.alternatePaybill.trim()
              ? p.alternatePaybill.trim()
              : undefined,
          businessName: String(p.businessName ?? DEFAULT_PAYBILL_SETTINGS.businessName),
          accountLabel: String(p.accountLabel ?? DEFAULT_PAYBILL_SETTINGS.accountLabel),
        };
      } else {
        draft.paybill = structuredClone(DEFAULT_PAYBILL_SETTINGS);
      }
      draft.ready.paybill = true;
      emitIfReady();
    },
    handleListenerError('settings/paybill')
  );

  return () => {
    unsubConns();
    unsubReadings();
    unsubInvoices();
    unsubPayments();
    unsubNotifs();
    unsubMpesa();
    unsubTariffs();
    unsubPaybill();
  };
}

export async function updateOperatorProfileDisplayName(
  uid: string,
  displayName: string
): Promise<void> {
  const cleanName = displayName.trim().slice(0, 120);
  if (!cleanName) return;
  const path = `users/${uid}`;
  try {
    await setDoc(
      doc(db, 'users', uid),
      {
        displayName: cleanName,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function listStaffAccessEntries(currentEmail: string): Promise<StaffAccessEntry[]> {
  const normalized = currentEmail.trim().toLowerCase();
  const path = 'staffAccess';
  try {
    const snap =
      normalized === BOOTSTRAP_SUPERADMIN_EMAIL
        ? await getDocs(collection(db, path))
        : await getDocs(query(collection(db, path), where('email', '==', normalized)));

    return snap.docs
      .map((d) => {
        const data = d.data();
        return {
          email: String(data.email ?? d.id),
          role: (data.role as UserRole) || 'operator',
          displayName: String(data.displayName ?? data.email ?? d.id),
          assignedByEmail: String(data.assignedByEmail ?? ''),
        };
      })
      .sort((a, b) => a.email.localeCompare(b.email));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function grantStaffAccessEntry(opts: {
  email: string;
  role: UserRole;
  displayName: string;
  assignedByEmail: string;
}): Promise<void> {
  const emailLower = opts.email.trim().toLowerCase();
  const path = `staffAccess/${emailLower}`;
  const ref = doc(db, 'staffAccess', emailLower);
  try {
    const snap = await getDoc(ref);
    await setDoc(ref, {
      email: emailLower,
      role: opts.role,
      displayName: (opts.displayName.trim() || emailLower).slice(0, 120),
      assignedByEmail: opts.assignedByEmail.trim().toLowerCase().slice(0, 254),
      createdAt: snap.exists() ? snap.data().createdAt || serverTimestamp() : serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function revokeStaffAccessEntry(email: string): Promise<void> {
  const emailLower = email.trim().toLowerCase();
  const path = `staffAccess/${emailLower}`;
  try {
    await deleteDoc(doc(db, 'staffAccess', emailLower));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
