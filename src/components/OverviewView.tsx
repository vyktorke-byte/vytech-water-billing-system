import React, { useMemo, useState } from 'react';
import {
  BillingCycleId,
  BillingStoreState,
  ConnectionStatus,
  InvoiceStatus,
  PeriodFilterId,
} from '../types/billing';
import {
  ACTIVE_CYCLE_ID,
  CYCLES,
  evaluateConsumptionSpike,
  formatCents,
  formatLocalDate,
  formatTenthsM3,
  getCyclesForPeriod,
  TODAY_LOCAL,
} from '../lib/billingMath';
import { Button, Surface } from './ui';
import { CycleChartDatum, CycleTrendChart } from './BillingCharts';
import { LifetimePaymentLedger } from './LifetimePaymentLedger';
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  Gauge,
  TrendingUp,
} from 'lucide-react';

interface OverviewViewProps {
  state: BillingStoreState;
  period: PeriodFilterId;
  onPeriodChange: (p: PeriodFilterId) => void;
  onNavigateInvoices: (opts?: { status?: InvoiceStatus | 'ALL'; invoiceId?: string }) => void;
  onNavigateReadings: (connectionId?: string) => void;
  onOpenOverdueUtility?: () => void;
  onDownloadMonthlyReport?: () => void;
}

const PERIOD_OPTIONS: { id: PeriodFilterId; label: string }[] = [
  { id: '2026-11', label: 'Nov 2026' },
  { id: '2026-10', label: 'Oct 2026' },
  { id: 'Q3-2026', label: 'Q3 2026' },
  { id: '6M', label: '6 months' },
];

export function OverviewView({
  state,
  period,
  onPeriodChange,
  onNavigateInvoices,
  onNavigateReadings,
  onOpenOverdueUtility,
  onDownloadMonthlyReport,
}: OverviewViewProps) {
  const [showAllQueue, setShowAllQueue] = useState(false);

  const periodSpec = useMemo(() => getCyclesForPeriod(period), [period]);

  const metrics = useMemo(() => {
    const activeCycleSet = new Set(periodSpec.current);
    const periodInvoices = state.invoices.filter((inv) => activeCycleSet.has(inv.cycleId));
    const periodReadings = state.readings.filter((r) => activeCycleSet.has(r.cycleId));

    const billedCents = periodInvoices.reduce((s, inv) => s + inv.cycleChargesKsh, 0);
    // Collected against cycle charges / invoices in this window:
    const collectedCents = periodInvoices.reduce((s, inv) => s + inv.amountPaidKsh, 0);
    // Outstanding unpaid balance on the latest invoice in the selected window per connection:
    const latestInvoiceByConn = new Map<string, (typeof periodInvoices)[number]>();
    for (const inv of periodInvoices) {
      const existing = latestInvoiceByConn.get(inv.connectionId);
      if (!existing || inv.cycleId > existing.cycleId) {
        latestInvoiceByConn.set(inv.connectionId, inv);
      }
    }
    const unpaidBalanceCents = Array.from(latestInvoiceByConn.values()).reduce(
      (s, inv) => s + Math.max(0, inv.totalPayableKsh - inv.amountPaidKsh),
      0
    );

    const deliveredTenthsM3 = periodReadings.reduce((s, r) => s + r.consumptionTenthsM3, 0);
    const collectionRatePct = billedCents > 0 ? (collectedCents / billedCents) * 100 : 0;

    let comparisonDeltaPts: number | null = null;
    if (periodSpec.comparison) {
      const compSet = new Set(periodSpec.comparison);
      const compInvoices = state.invoices.filter((inv) => compSet.has(inv.cycleId));
      const compBilled = compInvoices.reduce((s, inv) => s + inv.cycleChargesKsh, 0);
      const compCollected = compInvoices.reduce((s, inv) => s + inv.amountPaidKsh, 0);
      if (compBilled > 0) {
        const compRate = (compCollected / compBilled) * 100;
        comparisonDeltaPts = collectionRatePct - compRate;
      }
    }

    const overdueCount = periodInvoices.filter((i) => i.status === InvoiceStatus.Overdue).length;

    return {
      billedCents,
      collectedCents,
      unpaidBalanceCents,
      deliveredTenthsM3,
      collectionRatePct,
      comparisonDeltaPts,
      invoiceCount: periodInvoices.length,
      readingCount: periodReadings.length,
      overdueCount,
    };
  }, [state.invoices, state.readings, periodSpec]);

  const chartData: CycleChartDatum[] = useMemo(() => {
    const selectedSet = new Set(periodSpec.current);
    return CYCLES.map((cycle) => {
      const cycInvoices = state.invoices.filter((i) => i.cycleId === cycle.id);
      const cycReadings = state.readings.filter((r) => r.cycleId === cycle.id);
      return {
        cycleId: cycle.id,
        shortLabel: cycle.shortLabel,
        billedCents: cycInvoices.reduce((s, i) => s + i.cycleChargesKsh, 0),
        collectedCents: cycInvoices.reduce((s, i) => s + i.amountPaidKsh, 0),
        consumptionTenthsM3: cycReadings.reduce((s, r) => s + r.consumptionTenthsM3, 0),
        isSelected: selectedSet.has(cycle.id),
      };
    });
  }, [state.invoices, state.readings, periodSpec]);

  // Actionable work queue for current billing operations (unbilled Nov meters + spikes + overdue accounts)
  const attentionQueue = useMemo(() => {
    const items: {
      id: string;
      kind: 'unbilled' | 'spike' | 'overdue';
      title: string;
      meta: string;
      statusWord: string;
      statusToneClass: string;
      actionLabel: string;
      onAction: () => void;
    }[] = [];

    const novReadConnIds = new Set(
      state.readings.filter((r) => r.cycleId === ACTIVE_CYCLE_ID).map((r) => r.connectionId)
    );

    for (const conn of state.connections) {
      if (!novReadConnIds.has(conn.id) && conn.status === ConnectionStatus.Active) {
        items.push({
          id: `unbilled-${conn.id}`,
          kind: 'unbilled',
          title: conn.customerName,
          meta: `${conn.meterSerial} · ${conn.premiseAddress} · Prev ${formatTenthsM3(conn.lastReadingTenthsM3)}`,
          statusWord: 'Awaiting Nov reading',
          statusToneClass: 'text-warning',
          actionLabel: 'Enter reading',
          onAction: () => onNavigateReadings(conn.id),
        });
      }
    }

    const connMap = new Map(state.connections.map((c) => [c.id, c]));

    for (const r of state.readings) {
      if (r.cycleId === ACTIVE_CYCLE_ID && r.isSpikeFlagged) {
        const conn = connMap.get(r.connectionId);
        const inv = state.invoices.find(
          (i) => i.connectionId === r.connectionId && i.cycleId === ACTIVE_CYCLE_ID
        );
        if (conn) {
          items.push({
            id: `spike-${r.id}`,
            kind: 'spike',
            title: conn.customerName,
            meta: `${conn.meterSerial} · ${formatTenthsM3(r.consumptionTenthsM3)} in Nov`,
            statusWord: 'High-usage spike',
            statusToneClass: 'text-danger',
            actionLabel: inv ? 'Inspect bill' : 'Review meter',
            onAction: () =>
              inv
                ? onNavigateInvoices({ invoiceId: inv.id })
                : onNavigateReadings(conn.id),
          });
        }
      }
    }

    for (const inv of state.invoices) {
      if (inv.cycleId === ACTIVE_CYCLE_ID && inv.status === InvoiceStatus.Overdue) {
        const conn = connMap.get(inv.connectionId);
        const balance = Math.max(0, inv.totalPayableKsh - inv.amountPaidKsh);
        if (conn) {
          items.push({
            id: `overdue-${inv.id}`,
            kind: 'overdue',
            title: conn.customerName,
            meta: `${inv.invoiceNumber} · Balance ${formatCents(balance)}`,
            statusWord: 'Overdue arrears',
            statusToneClass: 'text-danger',
            actionLabel: 'Open bill',
            onAction: () => onNavigateInvoices({ invoiceId: inv.id }),
          });
        }
      }
    }

    return items;
  }, [state.connections, state.readings, state.invoices, onNavigateInvoices, onNavigateReadings]);

  // Dedicated High Consumption Spikes identified by evaluateConsumptionSpike for current cycle
  const highConsumptionAlerts = useMemo(() => {
    const connMap = new Map(state.connections.map((c) => [c.id, c]));
    const readingsByConn = new Map<string, typeof state.readings>();
    for (const r of state.readings) {
      const list = readingsByConn.get(r.connectionId) || [];
      list.push(r);
      readingsByConn.set(r.connectionId, list);
    }

    const currentReadings = state.readings.filter((r) => r.cycleId === ACTIVE_CYCLE_ID);
    const alerts: {
      readingId: string;
      connectionId: string;
      customerName: string;
      accountCode: string;
      meterSerial: string;
      premiseAddress: string;
      currentConsumptionTenths: number;
      trailingMeanTenths: number | null;
      ratio: number | null;
      anomalyNote?: string;
      invoiceId?: string;
      billedKsh?: number;
    }[] = [];

    for (const r of currentReadings) {
      const conn = connMap.get(r.connectionId);
      if (!conn) continue;

      const connPriorReadings = (readingsByConn.get(r.connectionId) || []).filter(
        (prior) => prior.cycleId < ACTIVE_CYCLE_ID
      );
      const evalResult = evaluateConsumptionSpike(r.consumptionTenthsM3, connPriorReadings);

      if (r.isSpikeFlagged || evalResult.isSpike) {
        const inv = state.invoices.find(
          (i) => i.connectionId === r.connectionId && i.cycleId === ACTIVE_CYCLE_ID
        );
        alerts.push({
          readingId: r.id,
          connectionId: conn.id,
          customerName: conn.customerName,
          accountCode: conn.accountCode,
          meterSerial: conn.meterSerial,
          premiseAddress: conn.premiseAddress,
          currentConsumptionTenths: r.consumptionTenthsM3,
          trailingMeanTenths: evalResult.trailingMeanTenthsM3,
          ratio: evalResult.ratio,
          anomalyNote: r.anomalyNote,
          invoiceId: inv?.id,
          billedKsh: inv?.cycleChargesKsh,
        });
      }
    }

    // Sort by highest ratio or consumption
    return alerts.sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
  }, [state.connections, state.readings, state.invoices]);

  // Upcoming Deadlines: unpaid invoices due within the next 5 days (proactive collections)
  const upcomingDeadlines = useMemo(() => {
    const connMap = new Map(state.connections.map((c) => [c.id, c]));
    const todayDate = new Date(TODAY_LOCAL.year, TODAY_LOCAL.month - 1, TODAY_LOCAL.day);
    todayDate.setHours(0, 0, 0, 0);

    const items: {
      invoiceId: string;
      invoiceNumber: string;
      connectionId: string;
      customerName: string;
      accountCode: string;
      phone: string;
      dueDate: { year: number; month: number; day: number };
      dueFormatted: string;
      daysRemaining: number;
      balanceKsh: number;
      totalPayableKsh: number;
      amountPaidKsh: number;
      status: InvoiceStatus;
    }[] = [];

    for (const inv of state.invoices) {
      const balanceKsh = Math.max(0, inv.totalPayableKsh - inv.amountPaidKsh);
      if (balanceKsh <= 0) continue; // Skip fully paid bills

      const invDueDate = new Date(inv.dueDate.year, inv.dueDate.month - 1, inv.dueDate.day);
      invDueDate.setHours(0, 0, 0, 0);

      // Compute day delta
      const diffTime = invDueDate.getTime() - todayDate.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      // Due within next 5 days (0 to 5 days, or includes bills due today/tomorrow)
      // We also include up to 5 days out for proactive notifications
      if (diffDays >= 0 && diffDays <= 5) {
        const conn = connMap.get(inv.connectionId);
        items.push({
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          connectionId: inv.connectionId,
          customerName: conn?.customerName || 'Water Consumer',
          accountCode: conn?.accountCode || 'N/A',
          phone: conn?.phone || '0712000000',
          dueDate: inv.dueDate,
          dueFormatted: formatLocalDate(inv.dueDate),
          daysRemaining: diffDays,
          balanceKsh,
          totalPayableKsh: inv.totalPayableKsh,
          amountPaidKsh: inv.amountPaidKsh,
          status: inv.status,
        });
      }
    }

    // Sort by most imminent deadline first
    return items.sort((a, b) => a.daysRemaining - b.daysRemaining);
  }, [state.connections, state.invoices]);

  const visibleQueue = showAllQueue ? attentionQueue : attentionQueue.slice(0, 5);

  const handleCycleClick = (cycleId: BillingCycleId) => {
    if (cycleId === '2026-11' || cycleId === '2026-10') {
      onPeriodChange(cycleId);
    } else if (cycleId === '2026-07' || cycleId === '2026-08' || cycleId === '2026-09') {
      onPeriodChange('Q3-2026');
    } else {
      onPeriodChange('6M');
    }
  };

  return (
    <div className="space-y-6">
      {/* Period filter bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-label text-muted">
          Showing figures for <span className="font-medium text-foreground">{periodSpec.periodLabel}</span> · Click any metric to open its ledger rows
        </p>

        <div className="flex flex-wrap items-center gap-2.5">
          <div
            role="group"
            aria-label="Billing period filter"
            className="inline-flex flex-wrap rounded-control border border-border/45 bg-surface p-0.5"
          >
            {PERIOD_OPTIONS.map((opt) => {
              const active = period === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onPeriodChange(opt.id)}
                  className={`min-h-9 cursor-pointer whitespace-nowrap rounded-control px-3.5 text-caption font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted hover:text-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {onDownloadMonthlyReport ? (
            <Button
              tone="quiet"
              size="sm"
              onClick={onDownloadMonthlyReport}
              title="Download official municipal PDF report aggregating billed vs. collected revenue for the active cycle"
            >
              <Download className="size-4" />
              <span>Download Monthly Report</span>
            </Button>
          ) : null}
        </div>
      </div>

      {/* Primary Answer Figure + 3 Secondary Figures in a single hairline-parted row */}
      <Surface>
        <div className="grid grid-cols-1 divide-y divide-border/40 sm:grid-cols-2 lg:grid-cols-12 lg:divide-x lg:divide-y-0">
          {/* Lead Figure */}
          <button
            type="button"
            onClick={() => onNavigateInvoices({ status: InvoiceStatus.Paid })}
            className="group flex min-w-0 cursor-pointer flex-col justify-between p-5 text-left transition-colors hover:bg-background/60 focus-visible:outline-2 focus-visible:outline-primary sm:col-span-2 lg:col-span-4"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-label text-foreground">Collected water revenue</span>
              <ArrowUpRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </div>
            <div className="mt-2 text-display tabular-nums text-foreground">
              {formatCents(metrics.collectedCents)}
            </div>
            <div className="mt-2 text-caption text-foreground">
              <span className="font-medium text-accent">
                {`${metrics.collectionRatePct.toFixed(1)}% of cycle billed`}
              </span>
              {metrics.comparisonDeltaPts !== null && periodSpec.comparisonLabel ? (
                <span className="text-muted">
                  {` · ${metrics.comparisonDeltaPts >= 0 ? '+' : ''}${metrics.comparisonDeltaPts.toFixed(1)} pts ${periodSpec.comparisonLabel}`}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-caption text-muted">
              {`Payments posted in KSh · ${periodSpec.periodLabel}`}
            </p>
          </button>

          {/* Secondary 1: Cycle Billed */}
          <button
            type="button"
            onClick={() => onNavigateInvoices({ status: 'ALL' })}
            className="group flex min-w-0 cursor-pointer flex-col justify-between p-5 text-left transition-colors hover:bg-background/60 focus-visible:outline-2 focus-visible:outline-primary lg:col-span-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-label text-foreground">Cycle charges billed</span>
              <ArrowUpRight className="size-4 shrink-0 text-muted opacity-70 group-hover:opacity-100" />
            </div>
            <div className="mt-3 text-title tabular-nums text-foreground">
              {formatCents(metrics.billedCents)}
            </div>
            <p className="mt-2 text-caption text-muted">
              {`${metrics.invoiceCount} invoices issued · KSh`}
            </p>
          </button>

          {/* Secondary 2: Unpaid & Arrears */}
          <button
            type="button"
            onClick={() => onNavigateInvoices({ status: InvoiceStatus.Overdue })}
            className="group flex min-w-0 cursor-pointer flex-col justify-between p-5 text-left transition-colors hover:bg-background/60 focus-visible:outline-2 focus-visible:outline-primary lg:col-span-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-label text-foreground">Open receivables & arrears</span>
              <ArrowUpRight className="size-4 shrink-0 text-muted opacity-70 group-hover:opacity-100" />
            </div>
            <div className="mt-3 text-title tabular-nums text-foreground">
              {formatCents(metrics.unpaidBalanceCents)}
            </div>
            <p className="mt-2 text-caption text-muted">
              <span className={metrics.overdueCount > 0 ? 'font-medium text-danger' : ''}>
                {`${metrics.overdueCount} overdue`}
              </span>
              {` · Unpaid total in KSh`}
            </p>
          </button>

          {/* Secondary 3: Metered Volume */}
          <button
            type="button"
            onClick={() => onNavigateReadings()}
            className="group flex min-w-0 cursor-pointer flex-col justify-between p-5 text-left transition-colors hover:bg-background/60 focus-visible:outline-2 focus-visible:outline-primary sm:col-span-2 lg:col-span-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-label text-foreground">Water delivered</span>
              <ArrowUpRight className="size-4 shrink-0 text-muted opacity-70 group-hover:opacity-100" />
            </div>
            <div className="mt-3 text-title tabular-nums text-foreground">
              {formatTenthsM3(metrics.deliveredTenthsM3)}
            </div>
            <p className="mt-2 text-caption text-muted">
              {`${metrics.readingCount} meter reads · m³`}
            </p>
          </button>
        </div>
      </Surface>

      {/* Lifetime Payment Status: Who Has Paid & How Many Not Paid */}
      <LifetimePaymentLedger state={state} onNavigateInvoices={onNavigateInvoices} />

      {/* High Consumption Alert Widget */}
      <Surface className="overflow-hidden border-border/45">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/35 bg-surface px-5 py-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className={`inline-flex size-7 shrink-0 items-center justify-center rounded-control ${
              highConsumptionAlerts.length > 0 ? 'bg-danger/15 text-danger' : 'bg-accent/15 text-accent'
            }`}>
              {highConsumptionAlerts.length > 0 ? (
                <AlertTriangle className="size-4" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-section text-foreground">High Consumption Alert</h2>
                {highConsumptionAlerts.length > 0 ? (
                  <span className="inline-flex items-center rounded-control border border-danger/45 bg-danger/10 px-2 py-0.5 text-caption font-semibold text-danger">
                    {highConsumptionAlerts.length} {highConsumptionAlerts.length === 1 ? 'meter flagged' : 'meters flagged'}
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-control border border-accent/45 bg-accent/10 px-2 py-0.5 text-caption font-medium text-accent">
                    Normal consumption pattern
                  </span>
                )}
              </div>
              <p className="text-caption text-muted">
                {highConsumptionAlerts.length > 0
                  ? 'Meters flagged by the spike evaluator exceeding 1.6× their 3-cycle baseline or sudden heavy volume in November 2026'
                  : 'No sudden spikes or abnormal surges detected in current cycle register readings'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              tone="quiet"
              size="sm"
              onClick={() => onNavigateReadings()}
            >
              <Gauge className="size-3.5 text-muted" />
              Meter readings
            </Button>
          </div>
        </div>

        {highConsumptionAlerts.length === 0 ? (
          <div className="px-5 py-6 text-center text-caption text-muted">
            <CheckCircle2 className="mx-auto size-7 text-accent/80 mb-1.5" />
            <p className="text-foreground font-medium">All active meters operating within normal consumption parameters</p>
            <p className="mt-0.5">The evaluator flags registers whenever monthly usage surges ≥ 1.6× above trailing mean.</p>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-border/30 text-caption font-semibold uppercase tracking-wider text-muted bg-surface-muted/20">
                    <th className="px-4 py-2.5">Premise & Meter</th>
                    <th className="px-4 py-2.5 text-right">Nov Usage</th>
                    <th className="px-4 py-2.5 text-right">Baseline Mean</th>
                    <th className="px-4 py-2.5 text-right">Surge Factor</th>
                    <th className="px-4 py-2.5">Anomaly & Diagnostics</th>
                    <th className="px-4 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/25 text-body">
                  {highConsumptionAlerts.map((alert) => {
                    const surgePercent = alert.ratio ? Math.round((alert.ratio - 1) * 100) : null;
                    return (
                      <tr
                        key={alert.readingId}
                        className="transition-colors hover:bg-background/60"
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{alert.customerName}</div>
                          <div className="mt-0.5 text-caption text-muted">
                            <span className="font-mono text-foreground/80">{alert.meterSerial}</span>
                            {` · ${alert.accountCode}`}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="font-mono font-semibold text-danger">
                            {formatTenthsM3(alert.currentConsumptionTenths)}
                          </div>
                          {alert.billedKsh ? (
                            <div className="text-caption text-muted">{formatCents(alert.billedKsh)}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-right text-caption text-muted font-mono">
                          {alert.trailingMeanTenths !== null ? formatTenthsM3(alert.trailingMeanTenths) : 'No prior baseline'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {alert.ratio ? (
                            <div className="inline-flex items-center gap-1 rounded-control bg-danger/10 px-2 py-0.5 text-caption font-semibold text-danger">
                              <TrendingUp className="size-3" />
                              <span>{alert.ratio.toFixed(1)}×</span>
                              {surgePercent !== null ? <span className="text-danger/80 text-[10px]">({surgePercent > 0 ? `+${surgePercent}%` : `${surgePercent}%`})</span> : null}
                            </div>
                          ) : (
                            <span className="text-caption text-warning">Spike threshold</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-caption text-foreground/90 max-w-xs">
                            {alert.anomalyNote ? (
                              <span className="text-warning-foreground font-medium">{alert.anomalyNote}</span>
                            ) : (
                              <span className="text-muted">Unusual sudden volume surge above historical consumption. Inspect for leaks or burst pipes.</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {alert.invoiceId ? (
                              <Button
                                tone="quiet"
                                size="sm"
                                onClick={() => onNavigateInvoices({ invoiceId: alert.invoiceId })}
                              >
                                View bill
                              </Button>
                            ) : (
                              <Button
                                tone="quiet"
                                size="sm"
                                onClick={() => onNavigateReadings(alert.connectionId)}
                              >
                                Inspect meter
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Surface>

      {/* Upcoming Deadlines (Due within next 5 days - Proactive Collections) */}
      <Surface className="overflow-hidden border-border/45">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/35 bg-surface px-5 py-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className={`inline-flex size-7 shrink-0 items-center justify-center rounded-control ${
              upcomingDeadlines.length > 0 ? 'bg-warning/15 text-warning' : 'bg-surface-muted text-muted'
            }`}>
              <CalendarClock className="size-4" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-section text-foreground">Upcoming Deadlines</h2>
                {upcomingDeadlines.length > 0 ? (
                  <span className="inline-flex items-center rounded-control border border-warning/45 bg-warning/10 px-2 py-0.5 text-caption font-semibold text-warning">
                    {upcomingDeadlines.length} {upcomingDeadlines.length === 1 ? 'invoice due soon' : 'invoices due soon'}
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-control border border-border/45 bg-surface-muted px-2 py-0.5 text-caption font-medium text-muted">
                    No deadlines in next 5 days
                  </span>
                )}
              </div>
              <p className="text-caption text-muted">
                Unpaid customer bills maturing within the next 5 days for early reminder dispatch and proactive collections
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onOpenOverdueUtility && upcomingDeadlines.length > 0 ? (
              <Button
                tone="quiet"
                size="sm"
                onClick={onOpenOverdueUtility}
                title="Send proactive reminder notices via SMS/Email"
              >
                <Bell className="size-3.5 text-warning" />
                Dispatch notices
              </Button>
            ) : null}
            <Button
              tone="quiet"
              size="sm"
              onClick={() => onNavigateInvoices({ status: InvoiceStatus.Pending })}
            >
              Open ledger
            </Button>
          </div>
        </div>

        {upcomingDeadlines.length === 0 ? (
          <div className="px-5 py-6 text-center text-caption text-muted">
            <Clock className="mx-auto size-7 text-muted/60 mb-1.5" />
            <p className="text-foreground font-medium">No customer accounts with invoices maturing in the next 5 days</p>
            <p className="mt-0.5">
              The cutoff for November 2026 bills is Nov 25. As due dates approach within 5 days, maturing accounts will populate here automatically.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-border/30 text-caption font-semibold uppercase tracking-wider text-muted bg-surface-muted/20">
                    <th className="px-4 py-2.5">Customer & Account</th>
                    <th className="px-4 py-2.5">Invoice</th>
                    <th className="px-4 py-2.5">Maturity Date</th>
                    <th className="px-4 py-2.5 text-center">Days Remaining</th>
                    <th className="px-4 py-2.5 text-right">Balance Due</th>
                    <th className="px-4 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/25 text-body">
                  {upcomingDeadlines.map((item) => {
                    const isDueToday = item.daysRemaining === 0;
                    const isDueTomorrow = item.daysRemaining === 1;

                    return (
                      <tr
                        key={item.invoiceId}
                        className="transition-colors hover:bg-background/60"
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{item.customerName}</div>
                          <div className="mt-0.5 text-caption text-muted">
                            <span className="font-mono text-foreground/80">{item.accountCode}</span>
                            {` · ${item.phone}`}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-caption font-medium text-foreground">
                            {item.invoiceNumber}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-caption text-foreground font-medium">
                          {item.dueFormatted}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-flex items-center gap-1 rounded-control px-2 py-0.5 text-caption font-semibold ${
                              isDueToday
                                ? 'bg-danger/15 text-danger border border-danger/40'
                                : isDueTomorrow
                                ? 'bg-warning/15 text-warning border border-warning/40'
                                : 'bg-surface-muted text-foreground border border-border/40'
                            }`}
                          >
                            <Clock className="size-3" />
                            {isDueToday
                              ? 'Due Today'
                              : isDueTomorrow
                              ? 'Due Tomorrow'
                              : `${item.daysRemaining} days left`}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-foreground">
                          {formatCents(item.balanceKsh)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              tone="quiet"
                              size="sm"
                              onClick={() => onNavigateInvoices({ invoiceId: item.invoiceId })}
                            >
                              Collect bill
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Surface>

      {/* Chart + Cycle Exception Queue */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <Surface className="p-5 xl:col-span-7">
          <CycleTrendChart data={chartData} onSelectCycle={handleCycleClick} />
        </Surface>

        <Surface className="divide-y divide-border/35 xl:col-span-5">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-section text-foreground">Cycle exceptions & unbilled meters</h2>
              <p className="text-caption text-muted">
                Active November 2026 dispatch queue · {attentionQueue.length} items requiring review
              </p>
            </div>
            {onOpenOverdueUtility ? (
              <Button tone="quiet" size="sm" onClick={onOpenOverdueUtility}>
                Overdue notice tool
              </Button>
            ) : null}
          </div>

          {visibleQueue.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-body text-foreground">All November 2026 meters read and reconciled</p>
              <p className="mt-1 text-caption text-muted">
                Open meter readings to record off-cycle checks or inspect historical logs.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/35">
              {visibleQueue.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-label text-foreground">{item.title}</div>
                    <div className="mt-0.5 text-caption text-muted">
                      <span className={`font-medium ${item.statusToneClass}`}>{item.statusWord}</span>
                      {` · ${item.meta}`}
                    </div>
                  </div>
                  <Button tone="quiet" size="sm" onClick={item.onAction}>
                    {item.actionLabel}
                  </Button>
                </div>
              ))}
            </div>
          )}

          {attentionQueue.length > 5 ? (
            <div className="px-5 py-3">
              <Button
                tone="ghost"
                size="sm"
                onClick={() => setShowAllQueue((v) => !v)}
                className="w-full"
              >
                {showAllQueue
                  ? 'Show top 5 items'
                  : `Show all ${attentionQueue.length} exception items`}
              </Button>
            </div>
          ) : null}
        </Surface>
      </div>

    </div>
  );
}
