import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { MotionConfig } from 'motion/react';
import {
  AppView,
  BillingStoreState,
  ConnectionStatus,
  InvoiceStatus,
  MeterReading,
  NotificationChannel,
  NotificationLog,
  NotificationStatus,
  OperatorProfile,
  PaybillSettings,
  PaymentMethod,
  PaymentRecord,
  PeriodFilterId,
  StatusNotice,
  TariffCategory,
  TariffSchedule,
  UserRole,
  WaterConnection,
  WaterInvoice,
} from './types/billing';
import {
  ACTIVE_CYCLE_ID,
  buildInvoicesCsv,
  calculateWaterBill,
  deriveInvoiceStatus,
  evaluateConsumptionSpike,
  formatCents,
  formatDispatchTimeNow,
  formatTenthsM3,
  getCycleMeta,
  TODAY_LOCAL,
} from './lib/billingMath';
import { downloadMonthlyMunicipalReportPdf } from './lib/monthlyReportPdf';
import {
  createEmptyFreshState,
  createInitialSeedState,
  DEFAULT_TARIFFS,
  loadBillingState,
  saveBillingState,
} from './data/seedData';
import {
  auth,
  resendVerificationEmail,
  signOutOperator,
} from './lib/firebase';
import {
  ensureOperatorProfile,
  getWorkspaceScope,
  loadBillingStateFromScope,
  subscribeBillingScope,
  syncBillingStateToScope,
  WorkspaceScope,
} from './lib/billingFirestore';
import {
  MpesaConfirmationInput,
  reconcileMpesaC2BIntoState,
} from './lib/mpesaReconcile';
import { Button, ErrorBoundary, ModalDialog } from './components/ui';
import { LOGIN_ROLE_INTENT_KEY, LoginScreen } from './components/LoginScreen';
import { OverviewView } from './components/OverviewView';
import { InvoicesView } from './components/InvoicesView';
import { MeterReadingsView } from './components/MeterReadingsView';
import { AccountsView } from './components/AccountsView';
import { TariffsView } from './components/TariffsView';
import { AdminRolesView } from './components/AdminRolesView';
import {
  OverdueAccountsModal,
  OverdueNotificationPayload,
} from './components/OverdueAccountsModal';
import {
  Calculator,
  Crown,
  Download,
  FileText,
  Gauge,
  LayoutGrid,
  LogOut,
  Mail,
  Menu,
  Plus,
  RotateCcw,
  Shield,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';

const BRAND_LOGO_PATH = '/assets/aistudio/vytech-icon_a1bffa57.svg';

function BrandMark() {
  const [logoFailed, setLogoFailed] = useState(false);

  return (
    <div className="flex items-center gap-2.5 min-w-0">
      {!logoFailed ? (
        <img
          src={BRAND_LOGO_PATH}
          alt="MajiTrack emblem"
          referrerPolicy="no-referrer"
          onError={() => setLogoFailed(true)}
          className="size-8 shrink-0 rounded-control object-contain"
        />
      ) : (
        <span
          aria-hidden="true"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-control bg-primary font-semibold text-primary-foreground"
        >
          M
        </span>
      )}
      <div className="flex flex-col min-w-0 leading-tight">
        <span className="whitespace-nowrap text-section font-bold tracking-tight text-foreground">
          MajiTrack
        </span>
        <span className="text-[11px] font-mono text-muted truncate">
          majitracksystembilling.net
        </span>
      </div>
    </div>
  );
}

function deriveOperatorInitials(user: User): string {
  const source = (user.displayName || user.email || 'OP').trim();
  const parts = source.split(/[\s.@_-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase() || 'OP';
}

function formatRoleLabel(role: UserRole): string {
  if (role === 'superadmin') return 'Super Admin';
  if (role === 'admin') return 'Admin';
  return 'Operator';
}

function WaterBillingWorkspace({ user }: { user: User }) {
  const [state, setState] = useState<BillingStoreState>(() => loadBillingState());
  const [profile, setProfile] = useState<OperatorProfile>(() => ({
    uid: user.uid,
    email: user.email || '',
    displayName: user.displayName || user.email || 'MajiTrack User',
    photoURL: user.photoURL || undefined,
    role:
      (user.email || '').trim().toLowerCase() === 'vyktorke@gmail.com'
        ? 'superadmin'
        : 'operator',
  }));
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(true);
  const [activeView, setActiveView] = useState<AppView>('overview');
  const [period, setPeriod] = useState<PeriodFilterId>('2026-11');

  // Shared cross-view selection & filter states
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<InvoiceStatus | 'ALL'>('ALL');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [selectedReadingConnectionId, setSelectedReadingConnectionId] = useState<string | null>(null);
  const [addAccountModalOpen, setAddAccountModalOpen] = useState(false);
  const [overdueModalOpen, setOverdueModalOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Inline feedback & Undo state
  const [statusNotice, setStatusNotice] = useState<StatusNotice | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);

  const lastSyncedRef = useRef<BillingStoreState | null>(null);
  const activeScopeRef = useRef<WorkspaceScope>(getWorkspaceScope(user.uid, profile.role));
  const operatorInitials = useMemo(() => deriveOperatorInitials(user), [user]);
  const operatorName = profile.displayName || user.email || 'MajiTrack Operator';
  const roleLabel = formatRoleLabel(profile.role);
  const isAdminOrSuperAdmin = profile.role === 'superadmin' || profile.role === 'admin';

  // Hydrate operator/admin profile & attach real-time Firestore listener on sign-in
  useEffect(() => {
    let cancelled = false;
    let unsubscribeScope: (() => void) | null = null;

    async function hydrateFromFirestore() {
      setIsWorkspaceLoading(true);
      try {
        const resolvedProfile = await ensureOperatorProfile(user);
        if (cancelled) return;
        setProfile(resolvedProfile);

        const scope = getWorkspaceScope(user.uid, resolvedProfile.role);
        activeScopeRef.current = scope;

        let remote = await loadBillingStateFromScope(scope);
        if (cancelled) return;

        // If Admin/Super Admin shared workspace is still empty, migrate any prior user-scoped workspace or localStorage state
        if (!remote && scope.kind === 'workspace') {
          const personalRemote = await loadBillingStateFromScope({ kind: 'user', id: user.uid });
          if (personalRemote) {
            await syncBillingStateToScope(scope, user.uid, null, personalRemote);
            remote = personalRemote;
          }
        }

        if (remote) {
          lastSyncedRef.current = remote;
          setState(remote);
          saveBillingState(remote);
          setStorageWarning(null);
        } else {
          const local = loadBillingState();
          const hasLocalRecords =
            local.connections.length > 0 ||
            local.readings.length > 0 ||
            local.invoices.length > 0;
          if (hasLocalRecords) {
            await syncBillingStateToScope(scope, user.uid, null, local);
          }
          if (!cancelled) {
            lastSyncedRef.current = local;
            setState(local);
            setStorageWarning(null);
          }
        }

        // Attach live Firestore onSnapshot listener so Admin-SDK writes or multi-operator changes reflect instantly
        if (!cancelled) {
          unsubscribeScope = subscribeBillingScope(
            scope,
            (liveRemote) => {
              if (cancelled) return;
              lastSyncedRef.current = liveRemote;
              setState(liveRemote);
              saveBillingState(liveRemote);
              setStorageWarning(null);
            },
            () => {
              // Keep running smoothly if listener drops briefly
            }
          );
        }

        // Surface clear role-verification feedback based on selected login portal
        try {
          const intended = window.sessionStorage.getItem(LOGIN_ROLE_INTENT_KEY) as UserRole | null;
          window.sessionStorage.removeItem(LOGIN_ROLE_INTENT_KEY);
          if (intended && !cancelled) {
            if (
              (intended === 'superadmin' && resolvedProfile.role !== 'superadmin') ||
              (intended === 'admin' &&
                resolvedProfile.role !== 'admin' &&
                resolvedProfile.role !== 'superadmin')
            ) {
              setStatusNotice({
                id: `role-notice-${Date.now()}`,
                message: `Signed in as ${formatRoleLabel(resolvedProfile.role)} (${resolvedProfile.email}). Super Admin (vyktorke@gmail.com) can grant Admin/Super Admin access under Admin & Roles.`,
              });
            } else {
              setStatusNotice({
                id: `role-ok-${Date.now()}`,
                message: `Signed in as ${formatRoleLabel(resolvedProfile.role)} · ${resolvedProfile.email}`,
              });
            }
          }
        } catch {
          // Ignore sessionStorage read failure
        }
      } catch {
        if (!cancelled) {
          setStorageWarning(
            'Could not reach cloud Firestore sync; operating on cached browser storage.'
          );
        }
      } finally {
        if (!cancelled) {
          setIsWorkspaceLoading(false);
        }
      }
    }

    void hydrateFromFirestore();
    return () => {
      cancelled = true;
      unsubscribeScope?.();
    };
  }, [user]);

  const persistToCloud = useCallback(
    (nextState: BillingStoreState) => {
      const prevSynced = lastSyncedRef.current;
      const scope = activeScopeRef.current;
      lastSyncedRef.current = nextState;
      void syncBillingStateToScope(scope, user.uid, prevSynced, nextState)
        .then(() => {
          setStorageWarning(null);
        })
        .catch(() => {
          setStorageWarning(
            'Changes saved locally, but cloud Firestore sync encountered an error.'
          );
        });
    },
    [user.uid]
  );

  const commitState = useCallback(
    (
      updater: (prev: BillingStoreState) => BillingStoreState,
      notice?: { message: string; allowUndo?: boolean }
    ) => {
      setState((prevSnapshot) => {
        const next = updater(prevSnapshot);
        const ok = saveBillingState(next);
        if (!ok) {
          setStorageWarning('Browser storage is unavailable; changes apply via cloud sync.');
        }
        persistToCloud(next);

        if (notice) {
          setStatusNotice({
            id: `notice-${Date.now()}`,
            message: notice.message,
            undoLabel: notice.allowUndo ? 'Undo' : undefined,
            onUndo: notice.allowUndo
              ? () => {
                  setState(prevSnapshot);
                  saveBillingState(prevSnapshot);
                  persistToCloud(prevSnapshot);
                  setStatusNotice({
                    id: `undo-${Date.now()}`,
                    message: 'Reverted previous change.',
                  });
                }
              : undefined,
          });
        }
        return next;
      });
    },
    [persistToCloud]
  );

  // Keep backend M-Pesa validation & confirmation cache synced with active tenant accounts & open bills
  useEffect(() => {
    if (isWorkspaceLoading) return;
    const timer = window.setTimeout(() => {
      void fetch('/api/mpesa/accounts-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connections: state.connections,
          invoices: state.invoices,
          payments: state.payments,
          notifications: state.notifications ?? [],
          mpesaTransactions: state.mpesaTransactions ?? [],
          paybill: state.paybill,
        }),
      }).catch(() => {
        // Ignore transient sync failures when offline
      });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [
    isWorkspaceLoading,
    state.connections,
    state.invoices,
    state.payments,
    state.notifications,
    state.mpesaTransactions,
    state.paybill,
  ]);

  // Apply incoming M-Pesa C2B callback payloads cleanly & idempotently into dashboard + Firestore
  const applyMpesaPayloads = useCallback(
    (payloads: MpesaConfirmationInput[], opts?: { notify?: boolean }) => {
      if (payloads.length === 0) return;

      const appliedTransIds: string[] = [];
      const bannerMessages: string[] = [];

      setState((prevSnapshot) => {
        let working = prevSnapshot;
        let changed = false;

        for (const payload of payloads) {
          const { nextState, result } = reconcileMpesaC2BIntoState(working, payload);
          if (!result.alreadyProcessed) {
            working = nextState;
            changed = true;
            appliedTransIds.push(result.transaction.transId);
            const amtLabel = formatCents(result.transaction.transAmount);
            const targetLabel = result.matchedConnection
              ? `${result.matchedConnection.customerName} (${result.matchedConnection.accountCode})`
              : `BillRef ${result.transaction.billRefNumber} (Unmatched)`;
            bannerMessages.push(
              `M-Pesa Paybill ${result.transaction.businessShortCode} confirmed: ${amtLabel} from ${targetLabel} · Ref ${result.transaction.transId}`
            );
          }
        }

        if (!changed) return prevSnapshot;

        saveBillingState(working);
        persistToCloud(working);
        return working;
      });

      if (opts?.notify && bannerMessages.length > 0) {
        setStatusNotice({
          id: `mpesa-live-${Date.now()}`,
          message: bannerMessages[0],
        });
      }

      for (const transId of appliedTransIds) {
        void fetch(`/api/mpesa/transactions/${encodeURIComponent(transId)}/reconcile`, {
          method: 'POST',
        }).catch(() => {
          // Ignore transient ACK errors
        });
      }
    },
    [persistToCloud]
  );

  // Real-time SSE listener (/api/mpesa/events) + 12s polling fallback for instant Paybill updates
  useEffect(() => {
    if (isWorkspaceLoading) return;
    let disposed = false;

    const pollPendingCallbacks = async () => {
      try {
        const res = await fetch('/api/mpesa/transactions');
        if (!res.ok || disposed) return;
        const data = (await res.json()) as {
          pendingPayloads?: MpesaConfirmationInput[];
        };
        if (Array.isArray(data.pendingPayloads) && data.pendingPayloads.length > 0) {
          applyMpesaPayloads(data.pendingPayloads, { notify: true });
        }
      } catch {
        // Ignore transient poll errors
      }
    };

    void pollPendingCallbacks();
    const pollInterval = window.setInterval(() => {
      void pollPendingCallbacks();
    }, 12000);

    let eventSource: EventSource | null = null;
    if (typeof EventSource !== 'undefined') {
      eventSource = new EventSource('/api/mpesa/events');
      eventSource.onmessage = (event) => {
        if (disposed) return;
        try {
          const parsed = JSON.parse(event.data) as {
            type?: string;
            syncedToFirestore?: boolean;
            payload?: MpesaConfirmationInput;
            transaction?: {
              transId: string;
              transAmount: number;
              businessShortCode: string;
              billRefNumber: string;
              accountCode?: string;
              customerName?: string;
            };
          };
          if (parsed.type === 'mpesa_confirmation' && parsed.payload) {
            if (!parsed.syncedToFirestore) {
              applyMpesaPayloads([parsed.payload], { notify: true });
            } else if (parsed.transaction) {
              setStatusNotice({
                id: `mpesa-sse-${Date.now()}`,
                message: `M-Pesa Paybill ${parsed.transaction.businessShortCode} confirmed: ${formatCents(
                  parsed.transaction.transAmount
                )} for ${parsed.transaction.accountCode ?? parsed.transaction.billRefNumber} · Ref ${
                  parsed.transaction.transId
                }`,
              });
            }
          }
        } catch {
          // Ignore malformed SSE heartbeats
        }
      };
    }

    return () => {
      disposed = true;
      window.clearInterval(pollInterval);
      eventSource?.close();
    };
  }, [isWorkspaceLoading, applyMpesaPayloads]);

  // Navigation counts for sidebar
  const navCounts = useMemo(() => {
    const novReadIds = new Set(
      state.readings.filter((r) => r.cycleId === ACTIVE_CYCLE_ID).map((r) => r.connectionId)
    );
    const unbilledMeters = state.connections.filter(
      (c) => c.status === ConnectionStatus.Active && !novReadIds.has(c.id)
    ).length;
    const overdueNov = state.invoices.filter(
      (i) => i.cycleId === ACTIVE_CYCLE_ID && i.status === InvoiceStatus.Overdue
    ).length;
    return {
      unbilledMeters,
      overdueNov,
      totalAccounts: state.connections.length,
    };
  }, [state.connections, state.readings, state.invoices]);

  // Handlers
  const handleRecordPayment = useCallback(
    ({
      invoiceId,
      amountCents,
      method,
      reference,
    }: {
      invoiceId: string;
      amountCents: number;
      method: PaymentMethod;
      reference: string;
    }) => {
      const targetInv = state.invoices.find((i) => i.id === invoiceId);
      if (!targetInv) return;

      commitState(
        (prev) => {
          const updatedInvoices = prev.invoices.map((inv) => {
            if (inv.id !== invoiceId) return inv;
            const nextPaid = Math.min(inv.totalPayableKsh, inv.amountPaidKsh + amountCents);
            const nextStatus = deriveInvoiceStatus(
              inv.totalPayableKsh,
              nextPaid,
              inv.dueDate,
              inv.arrearsBroughtForwardKsh
            );
            return {
              ...inv,
              amountPaidKsh: nextPaid,
              status: nextStatus,
            };
          });

          const newPayment: PaymentRecord = {
            id: `pay-${Date.now()}`,
            invoiceId,
            paidDate: TODAY_LOCAL,
            amountKsh: amountCents,
            method,
            reference,
            status: 'Completed',
            connectionId: targetInv.connectionId,
          };

          return {
            ...prev,
            invoices: updatedInvoices,
            payments: [newPayment, ...prev.payments],
          };
        },
        {
          message: `Posted ${formatCents(amountCents)} on ${targetInv.invoiceNumber} (${reference})`,
          allowUndo: true,
        }
      );
    },
    [state.invoices, commitState]
  );

  const handleLogNotification = useCallback(
    (entry: {
      connectionId: string;
      customerName: string;
      accountCode: string;
      invoiceId?: string;
      invoiceNumber?: string;
      channel: NotificationChannel;
      recipient: string;
      messageSummary: string;
      status?: NotificationStatus;
    }) => {
      const logItem: NotificationLog = {
        id: `ntf-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        connectionId: entry.connectionId,
        customerName: entry.customerName,
        accountCode: entry.accountCode,
        invoiceId: entry.invoiceId,
        invoiceNumber: entry.invoiceNumber,
        channel: entry.channel,
        recipient: entry.recipient,
        messageSummary: entry.messageSummary.slice(0, 500),
        status: entry.status ?? (entry.channel === 'WHATSAPP' ? 'Sent' : 'Delivered'),
        sentDate: TODAY_LOCAL,
        sentTime: formatDispatchTimeNow(),
        dispatchedBy: operatorInitials,
      };

      const channelLabel =
        entry.channel === 'WHATSAPP'
          ? 'WhatsApp'
          : entry.channel === 'SMS'
          ? 'SMS'
          : 'Email';

      commitState(
        (prev) => ({
          ...prev,
          notifications: [logItem, ...(prev.notifications ?? [])],
        }),
        {
          message: `Logged ${channelLabel} notification to ${entry.customerName} (${entry.recipient})`,
        }
      );
    },
    [commitState, operatorInitials]
  );

  const buildOverdueLogEntries = useCallback(
    (item: OverdueNotificationPayload, indexOffset: number): NotificationLog[] => {
      const conn = state.connections.find((c) => c.id === item.connectionId);
      const sentTime = formatDispatchTimeNow();
      const baseSummary = `Overdue payment reminder across ${item.invoiceCount} ${
        item.invoiceCount === 1 ? 'bill' : 'bills'
      } (${formatCents(item.balanceCents)} arrears).`;

      if (item.channel === 'BOTH') {
        return [
          {
            id: `ntf-${Date.now()}-${indexOffset}-em`,
            connectionId: item.connectionId,
            customerName: item.customerName,
            accountCode: item.accountCode,
            channel: 'EMAIL',
            recipient: conn?.email || item.contact,
            messageSummary: `Email arrears reminder: ${baseSummary}`,
            status: 'Delivered',
            sentDate: TODAY_LOCAL,
            sentTime,
            dispatchedBy: operatorInitials,
          },
          {
            id: `ntf-${Date.now()}-${indexOffset}-sms`,
            connectionId: item.connectionId,
            customerName: item.customerName,
            accountCode: item.accountCode,
            channel: 'SMS',
            recipient: conn?.phone || item.contact,
            messageSummary: `SMS arrears reminder: ${baseSummary}`,
            status: 'Delivered',
            sentDate: TODAY_LOCAL,
            sentTime,
            dispatchedBy: operatorInitials,
          },
        ];
      }

      const channel: NotificationChannel =
        item.channel === 'WHATSAPP'
          ? 'WHATSAPP'
          : item.channel === 'EMAIL'
          ? 'EMAIL'
          : 'SMS';

      return [
        {
          id: `ntf-${Date.now()}-${indexOffset}`,
          connectionId: item.connectionId,
          customerName: item.customerName,
          accountCode: item.accountCode,
          channel,
          recipient: item.contact,
          messageSummary: `${
            channel === 'WHATSAPP' ? 'WhatsApp-only' : channel
          } arrears notice: ${baseSummary}`,
          status: channel === 'WHATSAPP' ? 'Sent' : 'Delivered',
          sentDate: TODAY_LOCAL,
          sentTime,
          dispatchedBy: operatorInitials,
        },
      ];
    },
    [state.connections, operatorInitials]
  );

  const handleTriggerOverdueNotification = useCallback(
    (payload: OverdueNotificationPayload) => {
      const logs = buildOverdueLogEntries(payload, 1);
      const channelLabel =
        payload.channel === 'WHATSAPP'
          ? 'WhatsApp-only'
          : payload.channel === 'EMAIL'
          ? 'Email'
          : payload.channel === 'SMS'
          ? 'SMS'
          : 'Email & SMS';

      commitState(
        (prev) => ({
          ...prev,
          notifications: [...logs, ...(prev.notifications ?? [])],
        }),
        {
          message: `Dispatched ${channelLabel} payment reminder to ${payload.customerName} (${payload.contact}) for ${formatCents(
            payload.balanceCents
          )} across ${payload.invoiceCount} overdue ${
            payload.invoiceCount === 1 ? 'bill' : 'bills'
          }.`,
        }
      );
    },
    [buildOverdueLogEntries, commitState]
  );

  const handleBatchTriggerOverdueNotifications = useCallback(
    (notifications: OverdueNotificationPayload[]) => {
      const totalAmount = notifications.reduce((s, n) => s + n.balanceCents, 0);
      const allLogs = notifications.flatMap((n, idx) => buildOverdueLogEntries(n, idx + 1));

      commitState(
        (prev) => ({
          ...prev,
          notifications: [...allLogs, ...(prev.notifications ?? [])],
        }),
        {
          message: `Logged overdue reminders to ${notifications.length} customer ${
            notifications.length === 1 ? 'account' : 'accounts'
          } (${formatCents(totalAmount)} total arrears).`,
        }
      );
    },
    [buildOverdueLogEntries, commitState]
  );

  const handleBulkMarkPaid = useCallback(
    (invoiceIds: string[]) => {
      const idSet = new Set(invoiceIds);
      commitState(
        (prev) => {
          const addedPayments: PaymentRecord[] = prev.invoices
            .filter((inv) => idSet.has(inv.id) && inv.status !== InvoiceStatus.Paid)
            .map((inv, idx) => ({
              id: `pay-bulk-${Date.now()}-${idx}`,
              invoiceId: inv.id,
              paidDate: TODAY_LOCAL,
              amountKsh: Math.max(0, inv.totalPayableKsh - inv.amountPaidKsh),
              method: PaymentMethod.BankTransfer,
              reference: `BLK-${Math.floor(1000 + Math.random() * 9000)}`,
              status: 'Completed',
              connectionId: inv.connectionId,
            }));

          const updatedInvoices = prev.invoices.map((inv) => {
            if (!idSet.has(inv.id)) return inv;
            return {
              ...inv,
              amountPaidKsh: inv.totalPayableKsh,
              status: InvoiceStatus.Paid,
            };
          });

          return {
            ...prev,
            invoices: updatedInvoices,
            payments: [...addedPayments, ...prev.payments],
          };
        },
        {
          message: `Settled ${invoiceIds.length} ${
            invoiceIds.length === 1 ? 'invoice' : 'invoices'
          } in full`,
          allowUndo: true,
        }
      );
    },
    [commitState]
  );

  const handleSubmitReadingAndBill = useCallback(
    ({
      connectionId,
      currentTenthsM3,
      anomalyNote,
      photoUrl,
    }: {
      connectionId: string;
      currentTenthsM3: number;
      anomalyNote?: string;
      photoUrl?: string;
    }) => {
      const conn = state.connections.find((c) => c.id === connectionId);
      if (!conn) return;

      const consumptionTenths = Math.max(0, currentTenthsM3 - conn.lastReadingTenthsM3);
      const priorReadings = state.readings.filter(
        (r) => r.connectionId === connectionId && r.cycleId !== ACTIVE_CYCLE_ID
      );
      const spike = evaluateConsumptionSpike(consumptionTenths, priorReadings);
      const schedule = state.tariffs[conn.category] ?? {
        category: conn.category,
        ratePerM3: conn.category === 'Residents' ? 150 : 180,
        seweragePercent: 0,
      };
      const bill = calculateWaterBill(consumptionTenths, schedule);

      const priorInvoices = state.invoices
        .filter((i) => i.connectionId === connectionId && i.cycleId < ACTIVE_CYCLE_ID)
        .sort((a, b) => b.cycleId.localeCompare(a.cycleId));
      const latestPrior = priorInvoices[0];
      const arrearsKsh = latestPrior
        ? Math.max(0, latestPrior.totalPayableKsh - latestPrior.amountPaidKsh)
        : 0;

      const meta = getCycleMeta(ACTIVE_CYCLE_ID);
      const maxSeq = state.invoices.reduce((max, inv) => {
        const num = Number(inv.invoiceNumber.replace('INV-', ''));
        return Number.isFinite(num) && num > max ? num : max;
      }, 4180);
      const nextInvNumber = `INV-${maxSeq + 1}`;
      const readingId = `rd-${connectionId}-${ACTIVE_CYCLE_ID}`;
      const invoiceId = `inv-${connectionId}-${ACTIVE_CYCLE_ID}`;
      const totalPayableKsh = bill.cycleChargesKsh + arrearsKsh;

      const newReading: MeterReading = {
        id: readingId,
        connectionId,
        cycleId: ACTIVE_CYCLE_ID,
        readDate: TODAY_LOCAL,
        previousTenthsM3: conn.lastReadingTenthsM3,
        currentTenthsM3,
        consumptionTenthsM3: consumptionTenths,
        readerInitials: operatorInitials,
        anomalyNote,
        isSpikeFlagged: spike.isSpike,
        photoUrl,
      };

      const newInvoice: WaterInvoice = {
        id: invoiceId,
        invoiceNumber: nextInvNumber,
        connectionId,
        cycleId: ACTIVE_CYCLE_ID,
        readingId,
        issueDate: TODAY_LOCAL,
        dueDate: meta.dueDate,
        previousTenthsM3: conn.lastReadingTenthsM3,
        currentTenthsM3,
        consumptionTenthsM3: consumptionTenths,
        ratePerM3: bill.ratePerM3,
        volumetricKsh: bill.volumetricKsh,
        sewerageKsh: bill.sewerageKsh,
        arrearsBroughtForwardKsh: arrearsKsh,
        cycleChargesKsh: bill.cycleChargesKsh,
        totalPayableKsh,
        amountPaidKsh: 0,
        status: deriveInvoiceStatus(totalPayableKsh, 0, meta.dueDate, arrearsKsh),
      };

      commitState(
        (prev) => ({
          ...prev,
          connections: prev.connections.map((c) =>
            c.id === connectionId
              ? {
                  ...c,
                  lastReadingTenthsM3: currentTenthsM3,
                  lastReadCycle: ACTIVE_CYCLE_ID,
                }
              : c
          ),
          readings: [...prev.readings, newReading],
          invoices: [newInvoice, ...prev.invoices],
        }),
        {
          message: `Recorded ${formatTenthsM3(consumptionTenths)} for ${conn.customerName} · Issued ${nextInvNumber} (${formatCents(
            totalPayableKsh
          )})`,
          allowUndo: true,
        }
      );
    },
    [state.connections, state.readings, state.invoices, state.tariffs, operatorInitials, commitState]
  );

  const handleUpdateReadingPhoto = useCallback(
    (readingId: string, photoUrl: string | undefined) => {
      const target = state.readings.find((r) => r.id === readingId);
      if (!target) return;
      const conn = state.connections.find((c) => c.id === target.connectionId);

      commitState(
        (prev) => ({
          ...prev,
          readings: prev.readings.map((r) =>
            r.id === readingId
              ? {
                  ...r,
                  photoUrl,
                }
              : r
          ),
        }),
        {
          message: photoUrl
            ? `Saved meter dial photo proof for ${conn?.customerName ?? 'meter reading'} (${conn?.meterSerial ?? readingId})`
            : `Removed meter dial photo from ${conn?.customerName ?? 'meter reading'}`,
          allowUndo: true,
        }
      );
    },
    [state.readings, state.connections, commitState]
  );

  const handleAddConnection = useCallback(
    (
      draft: Omit<WaterConnection, 'id' | 'accountCode' | 'lastReadCycle'> & {
        accountCode?: string;
      }
    ) => {
      const nextNum = 1150 + state.connections.length * 7;
      const customCode = draft.accountCode?.trim().toUpperCase();
      const { accountCode: _ignored, ...rest } = draft;
      const newConn: WaterConnection = {
        ...rest,
        id: `conn-${Date.now()}`,
        accountCode: customCode || `VW-${nextNum}`,
        lastReadCycle: '2026-10',
      };

      commitState(
        (prev) => ({
          ...prev,
          connections: [newConn, ...prev.connections],
        }),
        {
          message: `Registered ${newConn.customerName} (${newConn.accountCode} · ${newConn.meterSerial})`,
          allowUndo: true,
        }
      );
    },
    [state.connections.length, commitState]
  );

  const handleUpdateConnection = useCallback(
    (
      id: string,
      patch: Partial<WaterConnection>
    ) => {
      const target = state.connections.find((c) => c.id === id);
      if (!target) return;

      commitState(
        (prev) => ({
          ...prev,
          connections: prev.connections.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        }),
        {
          message: `Updated ${patch.customerName ?? target.customerName} (${
            patch.status ? `Supply ${patch.status.toLowerCase()}` : 'Client account updated'
          })`,
          allowUndo: true,
        }
      );
    },
    [state.connections, commitState]
  );

  const handleDeleteConnection = useCallback(
    (connectionId: string) => {
      const target = state.connections.find((c) => c.id === connectionId);
      if (!target) return;

      commitState(
        (prev) => {
          // Permanently delete connection and cascade remove its associated invoices, readings, and payments
          const remainingConnections = prev.connections.filter((c) => c.id !== connectionId);
          const remainingReadings = prev.readings.filter((r) => r.connectionId !== connectionId);
          const deletedInvoiceIds = new Set(
            prev.invoices.filter((i) => i.connectionId !== connectionId ? false : true).map((i) => i.id)
          );
          const remainingInvoices = prev.invoices.filter((i) => i.connectionId !== connectionId);
          const remainingPayments = prev.payments.filter((p) => !deletedInvoiceIds.has(p.invoiceId));
          const remainingNotifications = (prev.notifications ?? []).filter(
            (n) => n.connectionId !== connectionId
          );

          return {
            ...prev,
            connections: remainingConnections,
            readings: remainingReadings,
            invoices: remainingInvoices,
            payments: remainingPayments,
            notifications: remainingNotifications,
          };
        },
        {
          message: `Permanently deleted client ${target.customerName} (${target.accountCode}) and associated records`,
          allowUndo: true,
        }
      );
    },
    [state.connections, commitState]
  );

  const handleClearAllData = useCallback(() => {
    commitState(() => createEmptyFreshState(), {
      message: 'Cleared all client records, meter readings, and invoices (fresh clean state)',
      allowUndo: true,
    });
    setMobileNavOpen(false);
  }, [commitState]);

  const handleUpdateTariff = useCallback(
    (category: TariffCategory, updated: TariffSchedule) => {
      commitState((prev) => ({
        ...prev,
        tariffs: {
          ...prev.tariffs,
          [category]: updated,
        },
      }));
    },
    [commitState]
  );

  const handleUpdatePaybill = useCallback(
    (nextPaybill: PaybillSettings) => {
      commitState(
        (prev) => ({
          ...prev,
          paybill: nextPaybill,
        }),
        {
          message: `Updated Paybill configuration to ${nextPaybill.primaryPaybill}${
            nextPaybill.alternatePaybill ? ` / ${nextPaybill.alternatePaybill}` : ''
          } (${nextPaybill.businessName})`,
          allowUndo: true,
        }
      );
    },
    [commitState]
  );

  const handleResetDefaultTariffs = useCallback(() => {
    commitState(
      (prev) => ({
        ...prev,
        tariffs: structuredClone(DEFAULT_TARIFFS),
      }),
      {
        message: 'Restored baseline rising-block tariff rates across all classes',
        allowUndo: true,
      }
    );
  }, [commitState]);

  const handleResetSeedData = useCallback(() => {
    const fresh = createInitialSeedState();
    commitState(() => fresh, {
      message: 'Restored initial November 2026 water utility ledger',
      allowUndo: true,
    });
    setMobileNavOpen(false);
  }, [commitState]);

  const handleExportCsv = useCallback(() => {
    const connMap = new Map(
      state.connections.map((c) => [
        c.id,
        {
          accountCode: c.accountCode,
          customerName: c.customerName,
          meterSerial: c.meterSerial,
        },
      ])
    );
    const csv = buildInvoicesCsv(state.invoices, connMap);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `vytech-water-ledger-${ACTIVE_CYCLE_ID}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setStatusNotice({
      id: `csv-${Date.now()}`,
      message: `Exported ${state.invoices.length} invoice records to vytech-water-ledger-${ACTIVE_CYCLE_ID}.csv`,
    });
  }, [state.connections, state.invoices]);

  const handleReportDownloadedNotice = useCallback((filename: string) => {
    setStatusNotice({
      id: `pdf-${Date.now()}`,
      message: `Downloaded official municipal PDF report: ${filename}`,
    });
  }, []);

  const handleDownloadActiveCyclePdf = useCallback(() => {
    const cycleId = period === '2026-10' ? '2026-10' : ACTIVE_CYCLE_ID;
    const filename = downloadMonthlyMunicipalReportPdf({ state, cycleId });
    handleReportDownloadedNotice(filename);
  }, [period, state, handleReportDownloadedNotice]);

  const navItems: {
    id: AppView;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    meta?: string;
    metaTone?: string;
  }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutGrid },
    {
      id: 'invoices',
      label: 'Invoices & ledger',
      icon: FileText,
      meta: navCounts.overdueNov > 0 ? `${navCounts.overdueNov} overdue` : undefined,
      metaTone: 'text-danger',
    },
    {
      id: 'readings',
      label: 'Meter readings',
      icon: Gauge,
      meta: navCounts.unbilledMeters > 0 ? `${navCounts.unbilledMeters} unbilled` : 'Complete',
      metaTone: navCounts.unbilledMeters > 0 ? 'text-warning' : 'text-accent',
    },
    {
      id: 'accounts',
      label: 'Accounts & meters',
      icon: Users,
      meta: `${navCounts.totalAccounts}`,
      metaTone: 'text-muted',
    },
    { id: 'tariffs', label: 'Tariffs & simulator', icon: Calculator },
    ...(isAdminOrSuperAdmin
      ? [
          {
            id: 'admin' as AppView,
            label: 'Admin & roles',
            icon: profile.role === 'superadmin' ? Crown : Shield,
            meta: roleLabel,
            metaTone: 'text-primary',
          },
        ]
      : []),
  ];

  // Dynamic Workspace Header Spec (Section 1 of 3_saas_dashboard.md)
  const headerMeta = useMemo(() => {
    switch (activeView) {
      case 'overview':
        return {
          title: 'Water billing & collection',
          subtitle: `November 2026 cycle · ${state.connections.length} metered premises`,
          primaryLabel: 'Enter meter reading',
          primaryIcon: Gauge,
          onPrimary: () => setActiveView('readings'),
        };
      case 'invoices':
        return {
          title: 'Invoices & payment ledger',
          subtitle: `Cycle statements and arrears reconciliation`,
          primaryLabel: 'Enter meter reading',
          primaryIcon: Gauge,
          onPrimary: () => setActiveView('readings'),
        };
      case 'readings':
        return {
          title: 'Meter reading dispatch',
          subtitle: `November 2026 register capture · ${navCounts.unbilledMeters} remaining`,
          primaryLabel: 'Open invoice ledger',
          primaryIcon: FileText,
          onPrimary: () => setActiveView('invoices'),
        };
      case 'accounts':
        return {
          title: 'Customer accounts & meters',
          subtitle: `${state.connections.length} active and suspended connections`,
          primaryLabel: 'New connection',
          primaryIcon: Plus,
          onPrimary: () => setAddAccountModalOpen(true),
        };
      case 'tariffs':
        return {
          title: 'Tariff schedule & simulator',
          subtitle: 'Rising-block volumetric rates and pipe fees',
          primaryLabel: 'Enter meter reading',
          primaryIcon: Gauge,
          onPrimary: () => setActiveView('readings'),
        };
      case 'admin':
        return {
          title: 'Admin & access control',
          subtitle: `${roleLabel} workspace · Manage Admin and Super Admin accounts`,
          primaryLabel: 'View overview',
          primaryIcon: LayoutGrid,
          onPrimary: () => setActiveView('overview'),
        };
    }
  }, [activeView, state.connections.length, navCounts.unbilledMeters, isAdminOrSuperAdmin, roleLabel, profile.role]);

  const PrimaryIcon = headerMeta.primaryIcon;

  return (
    <div className="flex min-h-dvh w-full flex-col bg-background text-foreground md:flex-row">
      {/* Desktop Sidebar Navigation */}
      <aside
        aria-label="Workspace navigation"
        className="no-print hidden md:sticky md:top-0 md:flex md:h-dvh md:w-64 md:shrink-0 md:flex-col md:justify-between md:border-r md:border-border/35 md:bg-surface"
      >
        <div className="min-h-0 overflow-y-auto divide-y divide-border/35">
          <div className="px-5 py-4">
            <BrandMark />
            <p className="mt-1 text-caption text-muted">
              Gawanji Heights Apartments
            </p>
          </div>

          <nav className="space-y-1 p-3" aria-label="Main views">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveView(item.id)}
                  className={`flex min-h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-control px-3 text-left text-label transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
                    active
                      ? 'bg-primary text-primary-foreground font-medium'
                      : 'text-foreground hover:bg-background'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2.5 whitespace-nowrap">
                    <Icon
                      className={`size-4 shrink-0 ${
                        active ? 'text-primary-foreground' : 'text-muted'
                      }`}
                    />
                    <span>{item.label}</span>
                  </span>
                  {item.meta ? (
                    <span
                      className={`shrink-0 whitespace-nowrap text-caption ${
                        active ? 'text-primary-foreground/85' : item.metaTone ?? 'text-muted'
                      }`}
                    >
                      {item.meta}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="border-t border-border/35 p-4 space-y-2">
          <div className="text-caption text-muted">
            Cycle cutoff · Nov 25, 2026
          </div>
          <button
            type="button"
            onClick={handleClearAllData}
            className="inline-flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-control px-2.5 text-caption font-medium text-danger transition-colors hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-primary"
            title="Permanently remove all client accounts, readings, and invoices"
          >
            <RotateCcw className="size-3.5" />
            Clear all data (fresh slate)
          </button>
          <button
            type="button"
            onClick={handleResetSeedData}
            className="inline-flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-control px-2.5 text-caption text-muted transition-colors hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
            title="Load sample demonstration accounts and historical records"
          >
            Load sample demo data
          </button>
          <div className="border-t border-border/35 pt-2.5 mt-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-caption font-semibold text-foreground">
                  {operatorName}
                </span>
                <span className="shrink-0 rounded-control bg-primary/12 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  {roleLabel}
                </span>
              </div>
              <div className="truncate text-[11px] text-muted">{user.email}</div>
            </div>
            <button
              type="button"
              onClick={() => void signOutOperator()}
              className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-control border border-border/45 bg-background text-muted transition-colors hover:text-danger focus-visible:outline-2 focus-visible:outline-primary"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="size-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Top Bar (only below md when sidebar is hidden) */}
      <div className="no-print flex items-center justify-between border-b border-border/35 bg-surface px-4 py-3 md:hidden">
        <BrandMark />
        <Button
          tone="quiet"
          size="sm"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open navigation menu"
        >
          <Menu className="size-4" />
          Menu
        </Button>
      </div>

      {/* Main Workspace Pane */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Scoped Workspace Header: Title left, 1 primary + 1 secondary action + operator right */}
        <header className="no-print border-b border-border/35 bg-surface px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-title text-foreground">{headerMeta.title}</h1>
              <p className="mt-0.5 text-caption text-muted">{headerMeta.subtitle}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <Button tone="quiet" onClick={handleExportCsv}>
                <Download className="size-4" />
                Export CSV
              </Button>

              <Button tone="primary" onClick={headerMeta.onPrimary}>
                <PrimaryIcon className="size-4" />
                {headerMeta.primaryLabel}
              </Button>

              <div
                aria-label={`${roleLabel} ${operatorInitials}, ${operatorName}`}
                title={`${operatorName} (${roleLabel} · ${user.email ?? ''})`}
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-control border border-border/45 bg-background px-2.5 text-caption font-semibold text-foreground"
              >
                {profile.role === 'superadmin' ? (
                  <Crown className="size-3.5 text-primary" />
                ) : profile.role === 'admin' ? (
                  <Shield className="size-3.5 text-accent" />
                ) : null}
                <span>{roleLabel}</span>
              </div>
            </div>
          </div>
        </header>

        {/* Inline Status / Undo Feedback Strip (never floating toast over phone content) */}
        {statusNotice ? (
          <div
            role="status"
            aria-live="polite"
            className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-border/35 bg-surface px-4 py-2.5 sm:px-6 lg:px-8"
          >
            <p className="min-w-0 text-label text-foreground">
              <span className="inline-block size-2 rounded-xs bg-accent mr-2 align-middle" />
              {statusNotice.message}
            </p>
            <div className="flex items-center gap-2">
              {statusNotice.onUndo ? (
                <Button tone="quiet" size="sm" onClick={statusNotice.onUndo}>
                  {statusNotice.undoLabel ?? 'Undo'}
                </Button>
              ) : null}
              <button
                type="button"
                onClick={() => setStatusNotice(null)}
                aria-label="Dismiss notification"
                className="inline-flex size-8 cursor-pointer items-center justify-center rounded-control text-muted hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        ) : null}

        {storageWarning ? (
          <div
            role="alert"
            className="no-print border-b border-warning/35 bg-surface px-4 py-2 text-caption text-warning sm:px-6 lg:px-8"
          >
            {storageWarning}
          </div>
        ) : null}

        {/* Active View Content */}
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {isWorkspaceLoading ? (
            <div className="mb-4 rounded-control border border-border/45 bg-surface px-4 py-2.5 text-caption text-muted">
              Syncing your MajiTrack cloud billing ledger…
            </div>
          ) : null}

          {activeView === 'overview' ? (
            <OverviewView
              state={state}
              period={period}
              onPeriodChange={setPeriod}
              onNavigateInvoices={(opts) => {
                if (opts?.status) setInvoiceStatusFilter(opts.status);
                if (opts?.invoiceId) setSelectedInvoiceId(opts.invoiceId);
                setActiveView('invoices');
              }}
              onNavigateReadings={(connId) => {
                if (connId) setSelectedReadingConnectionId(connId);
                setActiveView('readings');
              }}
              onOpenOverdueUtility={() => setOverdueModalOpen(true)}
              onDownloadMonthlyReport={handleDownloadActiveCyclePdf}
            />
          ) : null}

          {activeView === 'invoices' ? (
            <InvoicesView
              state={state}
              statusFilter={invoiceStatusFilter}
              onStatusFilterChange={setInvoiceStatusFilter}
              selectedInvoiceId={selectedInvoiceId}
              onSelectInvoice={setSelectedInvoiceId}
              onRecordPayment={handleRecordPayment}
              onBulkMarkPaid={handleBulkMarkPaid}
              onOpenOverdueUtility={() => setOverdueModalOpen(true)}
              onReportDownloaded={handleReportDownloadedNotice}
              onLogNotification={handleLogNotification}
              onUpdatePaybill={handleUpdatePaybill}
              onNotice={(msg) =>
                setStatusNotice({
                  id: `mpesa-notice-${Date.now()}`,
                  message: msg,
                })
              }
            />
          ) : null}

          {activeView === 'readings' ? (
            <MeterReadingsView
              state={state}
              selectedConnectionId={selectedReadingConnectionId}
              onSelectConnection={setSelectedReadingConnectionId}
              onSubmitReadingAndBill={handleSubmitReadingAndBill}
              onUpdateReadingPhoto={handleUpdateReadingPhoto}
              onOpenInvoice={(invoiceId) => {
                setSelectedInvoiceId(invoiceId);
                setInvoiceStatusFilter('ALL');
                setActiveView('invoices');
              }}
            />
          ) : null}

          {activeView === 'accounts' ? (
            <AccountsView
              state={state}
              addModalOpen={addAccountModalOpen}
              onAddModalOpenChange={setAddAccountModalOpen}
              onAddConnection={handleAddConnection}
              onUpdateConnection={handleUpdateConnection}
              onDeleteConnection={handleDeleteConnection}
              onOpenReadingsForConnection={(connId) => {
                setSelectedReadingConnectionId(connId);
                setActiveView('readings');
              }}
              onOpenInvoicesForConnection={(invId) => {
                setSelectedInvoiceId(invId);
                setInvoiceStatusFilter('ALL');
                setActiveView('invoices');
              }}
            />
          ) : null}

          {activeView === 'tariffs' ? (
            <TariffsView
              tariffs={state.tariffs}
              onUpdateTariff={handleUpdateTariff}
              onResetDefaultTariffs={handleResetDefaultTariffs}
            />
          ) : null}

          {activeView === 'admin' && isAdminOrSuperAdmin ? (
            <AdminRolesView
              profile={profile}
              onProfileUpdated={(displayName) =>
                setProfile((prev) => ({ ...prev, displayName }))
              }
              onNotice={(msg) =>
                setStatusNotice({
                  id: `admin-${Date.now()}`,
                  message: msg,
                })
              }
            />
          ) : null}
        </main>
      </div>

      {/* Mobile Navigation Drawer Dialog */}
      <ModalDialog
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        title="MajiTrack Water navigation"
        subtitle="Select a billing or metering workspace"
      >
        <div className="space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveView(item.id);
                  setMobileNavOpen(false);
                }}
                className={`flex min-h-11 w-full cursor-pointer items-center justify-between rounded-control px-3.5 text-left text-label ${
                  active
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-foreground hover:bg-background'
                }`}
              >
                <span className="flex items-center gap-2.5 whitespace-nowrap">
                  <Icon className="size-4 shrink-0" />
                  {item.label}
                </span>
                {item.meta ? (
                  <span
                    className={`text-caption ${
                      active ? 'text-primary-foreground/85' : item.metaTone ?? 'text-muted'
                    }`}
                  >
                    {item.meta}
                  </span>
                ) : null}
              </button>
            );
          })}

          <div className="border-t border-border/35 pt-3 mt-3 space-y-2">
            <Button
              tone="danger"
              size="sm"
              onClick={handleClearAllData}
              className="w-full"
            >
              <RotateCcw className="size-3.5" />
              Clear all data (fresh slate)
            </Button>
            <Button
              tone="quiet"
              size="sm"
              onClick={handleResetSeedData}
              className="w-full"
            >
              Load sample demo data
            </Button>
            <Button
              tone="quiet"
              size="sm"
              onClick={() => void signOutOperator()}
              className="w-full"
            >
              <LogOut className="size-3.5" />
              {`Sign out (${user.email ?? operatorInitials})`}
            </Button>
          </div>
        </div>
      </ModalDialog>

      {/* Overdue Accounts & Notifications Utility Modal */}
      <OverdueAccountsModal
        open={overdueModalOpen}
        onClose={() => setOverdueModalOpen(false)}
        connections={state.connections}
        invoices={state.invoices}
        paybill={state.paybill}
        onTriggerNotification={handleTriggerOverdueNotification}
        onBatchTriggerNotification={handleBatchTriggerOverdueNotifications}
        onOpenInvoice={(invId) => {
          setSelectedInvoiceId(invId);
          setInvoiceStatusFilter('ALL');
          setActiveView('invoices');
          setOverdueModalOpen(false);
        }}
      />
    </div>
  );
}

function EmailVerificationGate({
  user,
  onVerified,
}: {
  user: User;
  onVerified: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCheckVerification = async () => {
    setChecking(true);
    setError(null);
    setFeedback(null);
    try {
      await user.reload();
      if (auth.currentUser?.emailVerified) {
        await auth.currentUser.getIdToken(true);
        onVerified();
      } else {
        setError(
          'Your email is not verified yet. Open the verification link sent to your inbox (and spam folder), then click Continue again.'
        );
      }
    } catch {
      setError('Could not check verification status right now. Try again shortly.');
    } finally {
      setChecking(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setError(null);
    setFeedback(null);
    try {
      await resendVerificationEmail(user);
      setFeedback(`Verification link resent to ${user.email ?? 'your email'}.`);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not resend verification email. Wait a minute before trying again.'
      );
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-md rounded-card border border-border/45 bg-surface p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2.5 text-primary">
          <ShieldCheck className="size-5 shrink-0" />
          <h1 className="text-section font-bold text-foreground">
            Verify your email to continue
          </h1>
        </div>

        <p className="text-body text-muted">
          We sent a verification link to{' '}
          <span className="font-mono font-semibold text-foreground">{user.email}</span>.
          Verify your email address to activate database security access for your MajiTrack workspace.
        </p>

        {error ? (
          <div
            role="alert"
            className="rounded-control border border-danger/35 bg-danger/10 px-3.5 py-2.5 text-caption text-danger"
          >
            {error}
          </div>
        ) : null}

        {feedback ? (
          <div
            role="status"
            className="rounded-control border border-accent/35 bg-accent/10 px-3.5 py-2.5 text-caption text-accent"
          >
            {feedback}
          </div>
        ) : null}

        <div className="space-y-2.5 pt-1">
          <Button
            type="button"
            tone="primary"
            onClick={() => void handleCheckVerification()}
            disabled={checking}
            className="w-full justify-center"
          >
            {checking ? 'Checking verification…' : "I've verified my email — Continue"}
          </Button>

          <Button
            type="button"
            tone="quiet"
            onClick={() => void handleResend()}
            disabled={resending}
            className="w-full justify-center"
          >
            <Mail className="size-4" />
            {resending ? 'Sending link…' : 'Resend verification email'}
          </Button>

          <Button
            type="button"
            tone="ghost"
            onClick={() => void signOutOperator()}
            className="w-full justify-center"
          >
            <LogOut className="size-4" />
            Back to sign in
          </Button>
        </div>
      </div>
    </div>
  );
}

function AuthenticatedApp() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [, setVerificationTick] = useState(0);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  if (!authReady) {
    return (
      <div className="flex min-h-dvh w-full items-center justify-center bg-background px-4 text-foreground">
        <div className="rounded-card border border-border/45 bg-surface px-6 py-5 text-center shadow-sm">
          <div className="text-section font-semibold text-foreground">MajiTrack Water Billing</div>
          <p className="mt-1 text-caption text-muted">Verifying operator session…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  if (!user.emailVerified) {
    return (
      <EmailVerificationGate
        user={user}
        onVerified={() => setVerificationTick((t) => t + 1)}
      />
    );
  }

  return <WaterBillingWorkspace user={user} />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <AuthenticatedApp />
      </MotionConfig>
    </ErrorBoundary>
  );
}
