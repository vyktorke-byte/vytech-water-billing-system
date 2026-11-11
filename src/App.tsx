import React, { useCallback, useMemo, useState } from 'react';
import { MotionConfig } from 'motion/react';
import {
  AppView,
  BillingStoreState,
  ConnectionStatus,
  InvoiceStatus,
  MeterReading,
  PaymentMethod,
  PaymentRecord,
  PeriodFilterId,
  StatusNotice,
  SupplyZone,
  TariffCategory,
  TariffSchedule,
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
  formatTenthsM3,
  getCycleMeta,
  TODAY_LOCAL,
} from './lib/billingMath';
import {
  createEmptyFreshState,
  createInitialSeedState,
  DEFAULT_TARIFFS,
  loadBillingState,
  saveBillingState,
} from './data/seedData';
import { Button, ErrorBoundary, ModalDialog } from './components/ui';
import { OverviewView } from './components/OverviewView';
import { InvoicesView } from './components/InvoicesView';
import { MeterReadingsView } from './components/MeterReadingsView';
import { AccountsView } from './components/AccountsView';
import { TariffsView } from './components/TariffsView';
import { OverdueAccountsModal } from './components/OverdueAccountsModal';
import {
  Calculator,
  Download,
  FileText,
  Gauge,
  LayoutGrid,
  Menu,
  Plus,
  RotateCcw,
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
          alt="Vytech Water emblem"
          referrerPolicy="no-referrer"
          onError={() => setLogoFailed(true)}
          className="size-8 shrink-0 rounded-control object-contain"
        />
      ) : (
        <span
          aria-hidden="true"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-control bg-primary font-semibold text-primary-foreground"
        >
          V
        </span>
      )}
      <span className="whitespace-nowrap text-section font-semibold text-foreground">
        Vytech Water
      </span>
    </div>
  );
}

function WaterBillingWorkspace() {
  const [state, setState] = useState<BillingStoreState>(() => loadBillingState());
  const [activeView, setActiveView] = useState<AppView>('overview');
  const [period, setPeriod] = useState<PeriodFilterId>('2026-11');

  // Shared cross-view selection & filter states
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<InvoiceStatus | 'ALL'>('ALL');
  const [invoiceZoneFilter, setInvoiceZoneFilter] = useState<SupplyZone | 'ALL'>('ALL');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [selectedReadingConnectionId, setSelectedReadingConnectionId] = useState<string | null>(null);
  const [addAccountModalOpen, setAddAccountModalOpen] = useState(false);
  const [overdueModalOpen, setOverdueModalOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Inline feedback & Undo state
  const [statusNotice, setStatusNotice] = useState<StatusNotice | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);

  const commitState = useCallback(
    (
      updater: (prev: BillingStoreState) => BillingStoreState,
      notice?: { message: string; allowUndo?: boolean }
    ) => {
      setState((prevSnapshot) => {
        const next = updater(prevSnapshot);
        const ok = saveBillingState(next);
        if (!ok) {
          setStorageWarning('Browser storage is unavailable; changes apply to this session only.');
        } else {
          setStorageWarning(null);
        }

        if (notice) {
          setStatusNotice({
            id: `notice-${Date.now()}`,
            message: notice.message,
            undoLabel: notice.allowUndo ? 'Undo' : undefined,
            onUndo: notice.allowUndo
              ? () => {
                  setState(prevSnapshot);
                  saveBillingState(prevSnapshot);
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
    []
  );

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

  const handleTriggerOverdueNotification = useCallback(
    ({
      customerName,
      channel,
      contact,
      balanceCents,
      invoiceCount,
    }: {
      connectionId: string;
      customerName: string;
      channel: 'EMAIL' | 'SMS' | 'BOTH';
      contact: string;
      balanceCents: number;
      invoiceCount: number;
    }) => {
      const channelLabel =
        channel === 'EMAIL' ? 'Email' : channel === 'SMS' ? 'SMS' : 'Email & SMS';
      setStatusNotice({
        id: `notify-${Date.now()}`,
        message: `Dispatched ${channelLabel} payment reminder to ${customerName} (${contact}) for ${formatCents(
          balanceCents
        )} across ${invoiceCount} overdue ${invoiceCount === 1 ? 'bill' : 'bills'}.`,
      });
    },
    []
  );

  const handleBatchTriggerOverdueNotifications = useCallback(
    (
      notifications: {
        connectionId: string;
        customerName: string;
        channel: 'EMAIL' | 'SMS' | 'BOTH';
        contact: string;
        balanceCents: number;
        invoiceCount: number;
      }[]
    ) => {
      const totalAmount = notifications.reduce((s, n) => s + n.balanceCents, 0);
      setStatusNotice({
        id: `batch-notify-${Date.now()}`,
        message: `Successfully dispatched overdue reminders to ${notifications.length} customer ${
          notifications.length === 1 ? 'account' : 'accounts'
        } (${formatCents(totalAmount)} total arrears).`,
      });
    },
    []
  );

  const handleBulkMarkPaid = useCallback(
    (invoiceIds: string[]) => {
      const idSet = new Set(invoiceIds);
      commitState(
        (prev) => {
          const addedPayments = prev.invoices
            .filter((inv) => idSet.has(inv.id) && inv.status !== InvoiceStatus.Paid)
            .map((inv, idx) => ({
              id: `pay-bulk-${Date.now()}-${idx}`,
              invoiceId: inv.id,
              paidDate: TODAY_LOCAL,
              amountKsh: Math.max(0, inv.totalPayableKsh - inv.amountPaidKsh),
              method: PaymentMethod.BankTransfer,
              reference: `BLK-${Math.floor(1000 + Math.random() * 9000)}`,
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
    }: {
      connectionId: string;
      currentTenthsM3: number;
      anomalyNote?: string;
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
        readerInitials: 'VK',
        anomalyNote,
        isSpikeFlagged: spike.isSpike,
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
    [state.connections, state.readings, state.invoices, state.tariffs, commitState]
  );

  const handleAddConnection = useCallback(
    (draft: Omit<WaterConnection, 'id' | 'accountCode' | 'lastReadCycle'>) => {
      const nextNum = 1150 + state.connections.length * 7;
      const newConn: WaterConnection = {
        ...draft,
        id: `conn-${Date.now()}`,
        accountCode: `VW-${nextNum}`,
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

  const handleBatchAddConnections = useCallback(
    (drafts: Omit<WaterConnection, 'id' | 'accountCode' | 'lastReadCycle'>[]) => {
      if (drafts.length === 0) return;
      commitState(
        (prev) => {
          let baseCode = 1150 + prev.connections.length * 7;
          const timestamp = Date.now();
          const newConns: WaterConnection[] = drafts.map((d, idx) => {
            baseCode += 5;
            return {
              ...d,
              id: `conn-${timestamp}-${idx}`,
              accountCode: `VW-${baseCode}`,
              lastReadCycle: '2026-10',
            };
          });
          return {
            ...prev,
            connections: [...newConns, ...prev.connections],
          };
        },
        {
          message: `Batch registered ${drafts.length} premise accounts in ${drafts[0].zone}`,
          allowUndo: true,
        }
      );
    },
    [commitState]
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

          return {
            ...prev,
            connections: remainingConnections,
            readings: remainingReadings,
            invoices: remainingInvoices,
            payments: remainingPayments,
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
          zone: c.zone,
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
    }
  }, [activeView, state.connections.length, navCounts.unbilledMeters]);

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
              Municipal & estate billing
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
                aria-label="Operator VK, Billing Clerk"
                title="Operator VK · Billing Clerk"
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-control border border-border/45 bg-background text-caption font-semibold text-foreground"
              >
                VK
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
          {activeView === 'overview' ? (
            <OverviewView
              state={state}
              period={period}
              onPeriodChange={setPeriod}
              onNavigateInvoices={(opts) => {
                if (opts?.status) setInvoiceStatusFilter(opts.status);
                if (opts?.zone) setInvoiceZoneFilter(opts.zone);
                if (opts?.invoiceId) setSelectedInvoiceId(opts.invoiceId);
                setActiveView('invoices');
              }}
              onNavigateReadings={(connId) => {
                if (connId) setSelectedReadingConnectionId(connId);
                setActiveView('readings');
              }}
              onOpenOverdueUtility={() => setOverdueModalOpen(true)}
            />
          ) : null}

          {activeView === 'invoices' ? (
            <InvoicesView
              state={state}
              statusFilter={invoiceStatusFilter}
              onStatusFilterChange={setInvoiceStatusFilter}
              zoneFilter={invoiceZoneFilter}
              onZoneFilterChange={setInvoiceZoneFilter}
              selectedInvoiceId={selectedInvoiceId}
              onSelectInvoice={setSelectedInvoiceId}
              onRecordPayment={handleRecordPayment}
              onBulkMarkPaid={handleBulkMarkPaid}
              onOpenOverdueUtility={() => setOverdueModalOpen(true)}
            />
          ) : null}

          {activeView === 'readings' ? (
            <MeterReadingsView
              state={state}
              selectedConnectionId={selectedReadingConnectionId}
              onSelectConnection={setSelectedReadingConnectionId}
              onSubmitReadingAndBill={handleSubmitReadingAndBill}
              onOpenInvoice={(invoiceId) => {
                setSelectedInvoiceId(invoiceId);
                setInvoiceStatusFilter('ALL');
                setInvoiceZoneFilter('ALL');
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
              onBatchAddConnections={handleBatchAddConnections}
              onUpdateConnection={handleUpdateConnection}
              onDeleteConnection={handleDeleteConnection}
              onOpenReadingsForConnection={(connId) => {
                setSelectedReadingConnectionId(connId);
                setActiveView('readings');
              }}
              onOpenInvoicesForConnection={(invId) => {
                setSelectedInvoiceId(invId);
                setInvoiceStatusFilter('ALL');
                setInvoiceZoneFilter('ALL');
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
        </main>
      </div>

      {/* Mobile Navigation Drawer Dialog */}
      <ModalDialog
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        title="Vytech Water navigation"
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
          </div>
        </div>
      </ModalDialog>

      {/* Overdue Accounts & Notifications Utility Modal */}
      <OverdueAccountsModal
        open={overdueModalOpen}
        onClose={() => setOverdueModalOpen(false)}
        connections={state.connections}
        invoices={state.invoices}
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

export default function App() {
  return (
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <WaterBillingWorkspace />
      </MotionConfig>
    </ErrorBoundary>
  );
}
