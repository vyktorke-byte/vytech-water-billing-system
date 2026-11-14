import React, { useMemo, useState } from 'react';
import {
  BillingCycleId,
  BillingStoreState,
  InvoiceStatus,
  NotificationChannel,
  NotificationStatus,
  PaybillSettings,
  PaymentMethod,
  PaymentRecord,
} from '../types/billing';
import {
  ACTIVE_CYCLE_ID,
  buildWhatsAppUrl,
  computeLifetimePaymentSummary,
  CYCLES,
  DEFAULT_PAYBILL_NUMBER,
  formatCents,
  formatLocalDate,
  formatTenthsM3,
  parseUsdInputToCents,
} from '../lib/billingMath';
import {
  buildInvoiceWhatsAppMessage,
  downloadCustomerInvoicePdf,
} from '../lib/invoicePdf';
import { downloadMonthlyMunicipalReportPdf } from '../lib/monthlyReportPdf';
import { Button, Field, ModalDialog, SelectField, Surface } from './ui';
import {
  ArrowLeft,
  Bell,
  Check,
  Download,
  FileText,
  Mail,
  MessageSquare,
  Printer,
  Receipt,
  Search,
  Smartphone,
} from 'lucide-react';
import { PaymentReceiptModal } from './PaymentReceiptModal';
import { InvoiceShareModal } from './InvoiceShareModal';
import { MonthlyCollectionReportModal } from './MonthlyCollectionReportModal';
import { NotificationLogView } from './NotificationLogView';
import { MpesaPaybillLogView } from './MpesaPaybillLogView';
import { PaybillModal } from './PaybillModal';

interface InvoicesViewProps {
  state: BillingStoreState;
  statusFilter: InvoiceStatus | 'ALL';
  onStatusFilterChange: (s: InvoiceStatus | 'ALL') => void;
  selectedInvoiceId: string | null;
  onSelectInvoice: (id: string | null) => void;
  onRecordPayment: (opts: {
    invoiceId: string;
    amountCents: number;
    method: PaymentMethod;
    reference: string;
  }) => void;
  onBulkMarkPaid: (invoiceIds: string[]) => void;
  onOpenOverdueUtility?: () => void;
  onReportDownloaded?: (filename: string) => void;
  onLogNotification: (entry: {
    connectionId: string;
    customerName: string;
    accountCode: string;
    invoiceId?: string;
    invoiceNumber?: string;
    channel: NotificationChannel;
    recipient: string;
    messageSummary: string;
    status?: NotificationStatus;
  }) => void;
  onNotice?: (message: string) => void;
  onUpdatePaybill: (next: PaybillSettings) => void;
}

export function InvoicesView({
  state,
  statusFilter,
  onStatusFilterChange,
  selectedInvoiceId,
  onSelectInvoice,
  onRecordPayment,
  onBulkMarkPaid,
  onOpenOverdueUtility,
  onReportDownloaded,
  onLogNotification,
  onNotice,
  onUpdatePaybill,
}: InvoicesViewProps) {
  const [subView, setSubView] = useState<'statements' | 'mpesa' | 'notifications'>('statements');
  const [paybillModalOpen, setPaybillModalOpen] = useState(false);
  const [cycleFilter, setCycleFilter] = useState<BillingCycleId | 'ALL'>('2026-11');
  const [searchQuery, setSearchQuery] = useState('');
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  // Payment modal state
  const [paymentModalInvoiceId, setPaymentModalInvoiceId] = useState<string | null>(null);
  const [paymentAmountInput, setPaymentAmountInput] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.Mpesa);
  const [paymentRefInput, setPaymentRefInput] = useState('');
  const [paymentError, setPaymentError] = useState('');

  // Printable payment receipt modal state
  const [selectedPaymentForReceipt, setSelectedPaymentForReceipt] = useState<PaymentRecord | null>(null);

  // PDF Print & WhatsApp / Email dispatch modal state
  const [invoiceShareModalOpen, setInvoiceShareModalOpen] = useState(false);

  // Monthly Collection Report modal state
  const [monthlyReportModalOpen, setMonthlyReportModalOpen] = useState(false);

  // Brief inline confirmation after downloading an invoice PDF for WhatsApp
  const [detailPdfNotice, setDetailPdfNotice] = useState<string>('');

  const connMap = useMemo(
    () => new Map(state.connections.map((c) => [c.id, c])),
    [state.connections]
  );

  const lifetimeSummary = useMemo(() => computeLifetimePaymentSummary(state), [state]);

  // Scope invoices before status filter so status counts reflect current cycle/search
  const scopedInvoices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return state.invoices
      .filter((inv) => {
        if (cycleFilter !== 'ALL' && inv.cycleId !== cycleFilter) return false;
        const conn = connMap.get(inv.connectionId);
        if (q) {
          const hay = `${inv.invoiceNumber} ${conn?.customerName ?? ''} ${conn?.accountCode ?? ''} ${conn?.meterSerial ?? ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.cycleId !== b.cycleId) return b.cycleId.localeCompare(a.cycleId);
        return b.invoiceNumber.localeCompare(a.invoiceNumber);
      });
  }, [state.invoices, cycleFilter, searchQuery, connMap]);

  const counts = useMemo(() => {
    let paid = 0;
    let pending = 0;
    let overdue = 0;
    for (const inv of scopedInvoices) {
      if (inv.status === InvoiceStatus.Paid) paid += 1;
      else if (inv.status === InvoiceStatus.Pending) pending += 1;
      else if (inv.status === InvoiceStatus.Overdue) overdue += 1;
    }
    return {
      all: scopedInvoices.length,
      paid,
      pending,
      overdue,
    };
  }, [scopedInvoices]);

  const filteredInvoices = useMemo(() => {
    if (statusFilter === 'ALL') return scopedInvoices;
    return scopedInvoices.filter((inv) => inv.status === statusFilter);
  }, [scopedInvoices, statusFilter]);

  const activeInvoice = useMemo(() => {
    if (selectedInvoiceId) {
      const exact = state.invoices.find((i) => i.id === selectedInvoiceId);
      if (exact) return exact;
    }
    return filteredInvoices[0] ?? null;
  }, [selectedInvoiceId, state.invoices, filteredInvoices]);

  const activeConnection = activeInvoice ? connMap.get(activeInvoice.connectionId) ?? null : null;

  const activePayments = useMemo(() => {
    if (!activeInvoice) return [];
    return state.payments.filter((p) => p.invoiceId === activeInvoice.id);
  }, [state.payments, activeInvoice]);

  const openPaymentModal = (invoiceId: string) => {
    const inv = state.invoices.find((i) => i.id === invoiceId);
    if (!inv) return;
    const balanceKsh = Math.max(0, inv.totalPayableKsh - inv.amountPaidKsh);
    setPaymentModalInvoiceId(inv.id);
    setPaymentAmountInput(balanceKsh.toFixed(0));
    setPaymentMethod(PaymentMethod.Mpesa);
    setPaymentRefInput(`MP-${Math.floor(1000 + Math.random() * 9000)}`);
    setPaymentError('');
  };

  const handlePaymentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentModalInvoiceId) return;
    const inv = state.invoices.find((i) => i.id === paymentModalInvoiceId);
    if (!inv) return;
    const remainingKsh = Math.max(0, inv.totalPayableKsh - inv.amountPaidKsh);
    const amount = parseUsdInputToCents(paymentAmountInput);
    if (amount === null || amount <= 0) {
      setPaymentError('Enter a valid payment amount greater than KSh 0.');
      return;
    }
    if (amount > remainingKsh) {
      setPaymentError(`Amount exceeds the remaining balance of ${formatCents(remainingKsh)}.`);
      return;
    }
    onRecordPayment({
      invoiceId: inv.id,
      amountCents: amount,
      method: paymentMethod,
      reference: paymentRefInput.trim() || 'MP-RECEIPT',
    });
    setPaymentModalInvoiceId(null);
  };

  const toggleCheck = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const payableCheckedIds = useMemo(() => {
    return filteredInvoices
      .filter((inv) => checkedIds.has(inv.id) && inv.status !== InvoiceStatus.Paid)
      .map((inv) => inv.id);
  }, [filteredInvoices, checkedIds]);

  const handleBulkSettle = () => {
    if (payableCheckedIds.length === 0) return;
    onBulkMarkPaid(payableCheckedIds);
    setCheckedIds(new Set());
  };

  const statusTone = (s: InvoiceStatus) => {
    if (s === InvoiceStatus.Paid) return 'text-accent font-medium';
    if (s === InvoiceStatus.Overdue) return 'text-danger font-medium';
    return 'text-warning font-medium';
  };

  const statusTabs: { id: InvoiceStatus | 'ALL'; label: string; count: number }[] = [
    { id: 'ALL', label: 'All', count: counts.all },
    { id: InvoiceStatus.Overdue, label: 'Overdue', count: counts.overdue },
    { id: InvoiceStatus.Pending, label: 'Pending', count: counts.pending },
    { id: InvoiceStatus.Paid, label: 'Paid', count: counts.paid },
  ];

  const paymentTargetInvoice = paymentModalInvoiceId
    ? state.invoices.find((i) => i.id === paymentModalInvoiceId) ?? null
    : null;
  const paymentTargetConn = paymentTargetInvoice
    ? connMap.get(paymentTargetInvoice.connectionId) ?? null
    : null;

  const notificationCount = (state.notifications ?? []).length;
  const mpesaCount = (state.mpesaTransactions ?? []).length;

  return (
    <div className="space-y-5">
      {/* Section Switcher: Invoice Statements vs M-Pesa C2B Paybill vs Historical Notification Log */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/35 pb-3">
        <div
          role="tablist"
          aria-label="Invoices and ledger views"
          className="inline-flex flex-wrap rounded-control border border-border/50 bg-surface p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={subView === 'statements'}
            onClick={() => setSubView('statements')}
            className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-control px-3.5 text-label font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
              subView === 'statements'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-muted hover:text-foreground'
            }`}
          >
            <FileText className="size-4" />
            <span>{`Invoice statements · ${state.invoices.length}`}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subView === 'mpesa'}
            onClick={() => setSubView('mpesa')}
            className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-control px-3.5 text-label font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
              subView === 'mpesa'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-muted hover:text-foreground'
            }`}
          >
            <Smartphone className="size-4" />
            <span>{`M-Pesa Paybill · ${mpesaCount}`}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subView === 'notifications'}
            onClick={() => setSubView('notifications')}
            className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-control px-3.5 text-label font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
              subView === 'notifications'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-muted hover:text-foreground'
            }`}
          >
            <Bell className="size-4" />
            <span>{`Notification log · ${notificationCount}`}</span>
          </button>
        </div>

        <p className="text-caption text-muted">
          {subView === 'notifications'
            ? 'Historical SMS, Email & WhatsApp dispatch log · Send notifications via WhatsApp only'
            : subView === 'mpesa'
            ? `Safaricom C2B Paybill ${state.paybill?.primaryPaybill || DEFAULT_PAYBILL_NUMBER}${
                state.paybill?.alternatePaybill ? ` / ${state.paybill.alternatePaybill}` : ''
              } webhooks & instant auto-reconciliation`
            : 'Monthly billing statements, payments & municipal revenue audit'}
        </p>
      </div>

      {subView === 'notifications' ? (
        <NotificationLogView
          state={state}
          onLogNotification={onLogNotification}
          onOpenInvoice={(invId) => {
            onSelectInvoice(invId);
            onStatusFilterChange('ALL');
            setCycleFilter('ALL');
            setSubView('statements');
            setMobileDetailOpen(true);
          }}
        />
      ) : subView === 'mpesa' ? (
        <MpesaPaybillLogView
          state={state}
          onNotice={onNotice}
          onUpdatePaybill={onUpdatePaybill}
          onOpenInvoice={(invId) => {
            onSelectInvoice(invId);
            onStatusFilterChange('ALL');
            setCycleFilter('ALL');
            setSubView('statements');
            setMobileDetailOpen(true);
          }}
        />
      ) : (
        <>
      {/* Filter Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Filter invoices by payment status"
          className="flex flex-wrap items-center gap-1.5"
        >
          {statusTabs.map((tab) => {
            const active = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onStatusFilterChange(tab.id)}
                className={`min-h-9 cursor-pointer whitespace-nowrap rounded-control border px-3 text-caption font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border/45 bg-surface text-foreground hover:bg-background'
                }`}
              >
                {`${tab.label} · ${tab.count}`}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-52 flex-1 sm:flex-initial">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              aria-label="Search invoices by customer, account, or invoice number"
              placeholder="Search customer or INV-..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="min-h-10 w-full rounded-control border border-border/55 bg-surface pr-3 pl-9 text-label text-foreground placeholder:text-muted/75 focus-visible:outline-2 focus-visible:outline-primary"
            />
          </div>

          <select
            aria-label="Filter by billing cycle"
            value={cycleFilter}
            onChange={(e) => setCycleFilter(e.target.value as BillingCycleId | 'ALL')}
            className="min-h-10 rounded-control border border-border/55 bg-surface px-3 text-label text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          >
            <option value="ALL">All 6 cycles</option>
            {[...CYCLES].reverse().map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>

          <Button
            tone="quiet"
            size="sm"
            onClick={() => setMonthlyReportModalOpen(true)}
            title="Preview monthly municipal revenue & arrears audit report"
          >
            <FileText className="size-4" />
            <span>Preview Audit</span>
          </Button>

          <Button
            tone="primary"
            size="sm"
            onClick={() => {
              const targetCycle = cycleFilter === 'ALL' ? ACTIVE_CYCLE_ID : cycleFilter;
              const filename = downloadMonthlyMunicipalReportPdf({
                state,
                cycleId: targetCycle,
              });
              onReportDownloaded?.(filename);
            }}
            title="Download official municipal PDF report aggregating billed vs. collected revenue for the active cycle"
          >
            <Download className="size-4" />
            <span>Download Monthly Report</span>
          </Button>

          {onOpenOverdueUtility && counts.overdue > 0 ? (
            <Button tone="danger" size="sm" onClick={onOpenOverdueUtility}>
              Notify {counts.overdue} overdue
            </Button>
          ) : null}
        </div>
      </div>

      {/* Lifetime Payment Summary Bar */}
      <Surface className="px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3 text-caption">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
            <span>
              <span className="text-muted">Paid accounts (settled): </span>
              <strong className="text-accent tabular-nums">
                {`${lifetimeSummary.accountsPaidInFullCount} of ${lifetimeSummary.totalAccounts}`}
              </strong>
              <span className="text-muted">{` (${lifetimeSummary.totalPaidInvoicesLifetime} bills paid lifetime)`}</span>
            </span>
            <span>
              <span className="text-muted">Not paid lifetime: </span>
              <strong
                className={`tabular-nums ${
                  lifetimeSummary.accountsNotPaidCount > 0 ? 'text-danger' : 'text-foreground'
                }`}
              >
                {`${lifetimeSummary.accountsNotPaidCount} accounts`}
              </strong>
              <span className="text-muted">{` (${lifetimeSummary.totalUnpaidInvoicesLifetime} unpaid bills · ${formatCents(
                lifetimeSummary.totalLifetimeOutstandingKsh
              )})`}</span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setCycleFilter('ALL');
                onStatusFilterChange(InvoiceStatus.Paid);
              }}
              className="cursor-pointer font-medium text-primary hover:underline"
            >
              Show all paid lifetime
            </button>
            <span className="text-muted">·</span>
            <button
              type="button"
              onClick={() => {
                setCycleFilter('ALL');
                onStatusFilterChange(InvoiceStatus.Overdue);
              }}
              className="cursor-pointer font-medium text-danger hover:underline"
            >
              Show overdue lifetime
            </button>
          </div>
        </div>
      </Surface>

      {/* Master-Detail Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Invoice Table List */}
        <Surface
          className={`divide-y divide-border/35 lg:col-span-7 ${
            mobileDetailOpen && activeInvoice ? 'hidden lg:block' : 'block'
          }`}
        >
          {payableCheckedIds.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 bg-background/70 px-4 py-2.5">
              <span className="text-label text-foreground">
                {`${payableCheckedIds.length} unpaid ${
                  payableCheckedIds.length === 1 ? 'invoice' : 'invoices'
                } selected`}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" tone="accent" onClick={handleBulkSettle}>
                  <Check className="size-3.5" />
                  Mark selected paid
                </Button>
                <Button size="sm" tone="ghost" onClick={() => setCheckedIds(new Set())}>
                  Clear
                </Button>
              </div>
            </div>
          ) : null}

          {filteredInvoices.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-section text-foreground">No invoices match these filters</p>
              <p className="mt-1 text-caption text-muted">
                Reset status, cycle, or search filters to view billed water statements.
              </p>
              <div className="mt-4">
                <Button
                  tone="quiet"
                  size="sm"
                  onClick={() => {
                    onStatusFilterChange('ALL');
                    setCycleFilter('ALL');
                    setSearchQuery('');
                  }}
                >
                  Show all invoices
                </Button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-border/35 text-caption font-semibold uppercase tracking-wider text-muted">
                    <th className="w-10 px-3 py-3">
                      <span className="sr-only">Select</span>
                    </th>
                    <th className="px-3 py-3">Invoice & account</th>
                    <th className="px-3 py-3 text-right">Volume (m³)</th>
                    <th className="px-3 py-3 text-right">Payable (KSh)</th>
                    <th className="px-3 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30 text-body">
                  {filteredInvoices.map((inv) => {
                    const conn = connMap.get(inv.connectionId);
                    const isSelected = activeInvoice?.id === inv.id;
                    const balanceKsh = Math.max(0, inv.totalPayableKsh - inv.amountPaidKsh);
                    const isPaid = inv.status === InvoiceStatus.Paid;

                    return (
                      <tr
                        key={inv.id}
                        onClick={() => {
                          onSelectInvoice(inv.id);
                          setMobileDetailOpen(true);
                        }}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-primary/6' : 'hover:bg-background/60'
                        }`}
                      >
                        <td
                          className="px-3 py-3.5 align-top"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            aria-label={`Select invoice ${inv.invoiceNumber}`}
                            checked={checkedIds.has(inv.id)}
                            disabled={isPaid}
                            onChange={() => toggleCheck(inv.id)}
                            className="mt-1 size-4 cursor-pointer rounded-xs accent-primary disabled:opacity-35"
                          />
                        </td>
                        <td className="px-3 py-3.5">
                          <div className="font-medium text-foreground">
                            {conn?.customerName ?? inv.connectionId}
                          </div>
                          <div className="mt-0.5 text-caption text-muted">
                            <span className="font-mono text-foreground/85">{inv.invoiceNumber}</span>
                            {` · ${inv.cycleId} · `}
                            <span className={statusTone(inv.status)}>{inv.status}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3.5 text-right tabular-nums text-foreground">
                          {formatTenthsM3(inv.consumptionTenthsM3)}
                        </td>
                        <td className="px-3 py-3.5 text-right tabular-nums">
                          <div className="font-medium text-foreground">
                            {formatCents(isPaid ? inv.totalPayableKsh : balanceKsh)}
                          </div>
                          <div className="text-caption text-muted">
                            {isPaid ? 'Settled' : `Due ${formatLocalDate(inv.dueDate, false)}`}
                          </div>
                        </td>
                        <td
                          className="px-3 py-3.5 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              tone="quiet"
                              size="sm"
                              onClick={() => {
                                onSelectInvoice(inv.id);
                                setInvoiceShareModalOpen(true);
                              }}
                              title="WhatsApp, Email, PDF & Printable Invoice"
                            >
                              <MessageSquare className="size-3.5 text-[#25D366]" />
                              <span className="hidden xl:inline">Bill / Share</span>
                            </Button>

                            {isPaid ? (
                              <Button
                                tone="ghost"
                                size="sm"
                                onClick={() => {
                                  onSelectInvoice(inv.id);
                                  const payment = state.payments.find((p) => p.invoiceId === inv.id);
                                  if (payment) {
                                    setSelectedPaymentForReceipt(payment);
                                  } else {
                                    setMobileDetailOpen(true);
                                  }
                                }}
                                title="Official Verifiable Payment Receipt"
                              >
                                <Receipt className="size-3.5 text-accent" />
                                <span>Receipt</span>
                              </Button>
                            ) : (
                              <Button
                                tone="primary"
                                size="sm"
                                onClick={() => openPaymentModal(inv.id)}
                                title="Record payment toward invoice"
                              >
                                Pay
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
          )}
        </Surface>

        {/* Statement Detail Pane */}
        <div
          className={`lg:col-span-5 lg:sticky lg:top-6 lg:self-start ${
            mobileDetailOpen && activeInvoice ? 'block' : 'hidden lg:block'
          }`}
        >
          {activeInvoice && activeConnection ? (
            <Surface className="divide-y divide-border/35">
              {/* Mobile back bar */}
              <div className="flex items-center justify-between px-5 py-3 lg:hidden no-print">
                <Button
                  tone="ghost"
                  size="sm"
                  onClick={() => setMobileDetailOpen(false)}
                >
                  <ArrowLeft className="size-4" />
                  Back to invoices
                </Button>
              </div>

              {/* Statement Header */}
              <div className="space-y-2 px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-caption text-muted">
                      {`${activeInvoice.invoiceNumber} · Account ${activeConnection.accountCode}`}
                    </div>
                    <h2 className="mt-0.5 text-section text-foreground">
                      {activeConnection.customerName}
                    </h2>
                    <p className="text-caption text-muted">
                      {activeConnection.premiseAddress}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className={`text-label ${statusTone(activeInvoice.status)}`}>
                      {activeInvoice.status}
                    </span>
                    <div className="text-caption text-muted">
                      {`Due ${formatLocalDate(activeInvoice.dueDate)}`}
                    </div>
                  </div>
                </div>

                <div className="pt-1 text-caption text-muted">
                  <span>{activeConnection.category}</span>
                  {' · '}
                  <span className="font-mono">{activeConnection.meterSerial}</span>
                  {` · Issued ${formatLocalDate(activeInvoice.issueDate)}`}
                </div>
              </div>

              {/* Meter Index Continuity */}
              <div className="grid grid-cols-3 divide-x divide-border/35 px-5 py-3.5 text-left">
                <div className="pr-3">
                  <div className="text-caption text-muted">Prev index</div>
                  <div className="mt-0.5 text-label tabular-nums text-foreground">
                    {formatTenthsM3(activeInvoice.previousTenthsM3)}
                  </div>
                </div>
                <div className="px-3">
                  <div className="text-caption text-muted">Curr index</div>
                  <div className="mt-0.5 text-label tabular-nums text-foreground">
                    {formatTenthsM3(activeInvoice.currentTenthsM3)}
                  </div>
                </div>
                <div className="pl-3">
                  <div className="text-caption text-muted">Billed volume</div>
                  <div className="mt-0.5 text-label font-semibold tabular-nums text-foreground">
                    {formatTenthsM3(activeInvoice.consumptionTenthsM3)}
                  </div>
                </div>
              </div>

              {/* Tariff Rate Calculation */}
              <div className="space-y-2.5 px-5 py-4 text-label">
                <h3 className="text-caption font-semibold text-muted">
                  Water charge calculation
                </h3>

                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 text-caption text-muted">
                      {`${activeConnection.category} rate (${formatTenthsM3(
                        activeInvoice.consumptionTenthsM3
                      )} × KSh ${activeInvoice.ratePerM3}/m³)`}
                    </span>
                    <span className="shrink-0 tabular-nums text-foreground">
                      {formatCents(activeInvoice.volumetricKsh)}
                    </span>
                  </div>

                  {activeInvoice.sewerageKsh > 0 && (
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-caption text-muted">Sewerage surcharge</span>
                      <span className="tabular-nums text-foreground">
                        {formatCents(activeInvoice.sewerageKsh)}
                      </span>
                    </div>
                  )}
                </div>

                <div className="border-t border-border/35 pt-2.5 space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-muted">Cycle total</span>
                    <span className="font-medium tabular-nums text-foreground">
                      {formatCents(activeInvoice.cycleChargesKsh)}
                    </span>
                  </div>

                  {activeInvoice.arrearsBroughtForwardKsh > 0 ? (
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-warning">Prior unpaid arrears</span>
                      <span className="tabular-nums text-warning">
                        {formatCents(activeInvoice.arrearsBroughtForwardKsh)}
                      </span>
                    </div>
                  ) : null}

                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-muted">Payments credited</span>
                    <span className="tabular-nums text-accent">
                      {`−${formatCents(activeInvoice.amountPaidKsh)}`}
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between gap-3 border-t border-border/35 pt-2">
                    <span className="font-semibold text-foreground">Balance due</span>
                    <span className="text-section font-semibold tabular-nums text-foreground">
                      {formatCents(
                        Math.max(0, activeInvoice.totalPayableKsh - activeInvoice.amountPaidKsh)
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {/* Payment History */}
              {activePayments.length > 0 ? (
                <div className="space-y-2 px-5 py-3.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-caption font-semibold text-muted">Posted receipts</h3>
                    <span className="text-caption text-muted">{activePayments.length} recorded</span>
                  </div>
                  <div className="space-y-1.5">
                    {activePayments.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-3 rounded-control border border-border/30 bg-surface-muted/20 px-3 py-2 text-caption transition-colors hover:bg-surface-muted/40"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-foreground">
                            <span className="font-mono">{p.reference}</span>
                            <span className="text-muted font-normal"> · {p.method}</span>
                          </div>
                          <div className="text-[11px] text-muted">
                            Paid on {formatLocalDate(p.paidDate)}
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5">
                          <span className="font-semibold tabular-nums text-accent font-mono text-label">
                            {formatCents(p.amountKsh)}
                          </span>
                          <button
                            type="button"
                            onClick={() => setSelectedPaymentForReceipt(p)}
                            title="Generate and print official payment receipt"
                            className="inline-flex cursor-pointer items-center gap-1 rounded-control border border-border/45 bg-surface px-2 py-1 text-caption font-medium text-foreground transition-colors hover:bg-background hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                          >
                            <Receipt className="size-3.5 text-accent" />
                            <span>Receipt</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Statement Actions */}
              <div className="space-y-2.5 px-5 py-4 no-print border-t border-border/35 bg-surface-muted/15">
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {activeInvoice.status !== InvoiceStatus.Paid ? (
                      <>
                        <Button
                          tone="primary"
                          onClick={() => openPaymentModal(activeInvoice.id)}
                        >
                          Record payment
                        </Button>
                        <Button
                          tone="quiet"
                          size="sm"
                          onClick={() => setPaybillModalOpen(true)}
                          title={`View or edit Lipa na M-Pesa Paybill ${
                            state.paybill?.primaryPaybill || DEFAULT_PAYBILL_NUMBER
                          } instructions`}
                        >
                          <Smartphone className="size-3.5 text-[#25D366]" />
                          <span>M-Pesa Paybill</span>
                        </Button>
                      </>
                    ) : (
                      <span className="text-caption font-semibold text-accent">
                        Paid in full · No balance remaining
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={buildWhatsAppUrl(
                        activeConnection.phone,
                        buildInvoiceWhatsAppMessage({
                          invoice: activeInvoice,
                          connection: activeConnection,
                          paybill: state.paybill,
                        })
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => {
                        onLogNotification({
                          connectionId: activeConnection.id,
                          customerName: activeConnection.customerName,
                          accountCode: activeConnection.accountCode,
                          invoiceId: activeInvoice.id,
                          invoiceNumber: activeInvoice.invoiceNumber,
                          channel: 'WHATSAPP',
                          recipient: activeConnection.phone,
                          messageSummary: `WhatsApp-only statement ${
                            activeInvoice.invoiceNumber
                          } (${activeInvoice.cycleId}) · Balance ${formatCents(
                            Math.max(0, activeInvoice.totalPayableKsh - activeInvoice.amountPaidKsh)
                          )}`,
                          status: 'Sent',
                        });
                      }}
                      className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-control bg-[#25D366] px-3 text-caption font-semibold text-white shadow-xs transition-colors hover:brightness-105"
                      title="Send this water statement via WhatsApp only"
                    >
                      <MessageSquare className="size-3.5 fill-current" />
                      <span>WhatsApp only</span>
                    </a>

                    <Button
                      tone="quiet"
                      size="sm"
                      onClick={() => {
                        const reading =
                          state.readings.find((r) => r.id === activeInvoice.readingId) ?? null;
                        const filename = downloadCustomerInvoicePdf({
                          invoice: activeInvoice,
                          connection: activeConnection,
                          payments: activePayments,
                          reading,
                          paybill: state.paybill,
                        });
                        setDetailPdfNotice(`Downloaded PDF: ${filename}`);
                      }}
                      title="Download invoice as PDF file"
                    >
                      <Download className="size-3.5 text-primary" />
                      <span>PDF</span>
                    </Button>

                    <Button
                      tone="quiet"
                      size="sm"
                      onClick={() => setInvoiceShareModalOpen(true)}
                      title="Send invoice statement via WhatsApp PDF, Email, or Print"
                    >
                      <Mail className="size-3.5 text-primary" />
                      <span>Share</span>
                    </Button>

                    <Button
                      tone="quiet"
                      size="sm"
                      onClick={() => setInvoiceShareModalOpen(true)}
                      title="Print or inspect full invoice document"
                    >
                      <Printer className="size-3.5" />
                      <span>Print</span>
                    </Button>
                  </div>
                </div>

                {detailPdfNotice ? (
                  <div className="flex items-center justify-between gap-2 rounded-control border border-accent/35 bg-accent/10 px-3 py-1.5 text-caption text-accent">
                    <span>{detailPdfNotice}</span>
                    <button
                      type="button"
                      onClick={() => setDetailPdfNotice('')}
                      className="cursor-pointer font-semibold hover:underline"
                    >
                      Dismiss
                    </button>
                  </div>
                ) : null}
              </div>
            </Surface>
          ) : (
            <Surface className="p-6 text-center">
              <p className="text-body text-muted">Select an invoice from the ledger to inspect its statement.</p>
            </Surface>
          )}
        </div>
      </div>
        </>
      )}

      {/* Record Payment Modal */}
      <ModalDialog
        open={Boolean(paymentTargetInvoice)}
        onClose={() => setPaymentModalInvoiceId(null)}
        title="Post customer payment"
        subtitle={
          paymentTargetInvoice && paymentTargetConn
            ? `${paymentTargetInvoice.invoiceNumber} · ${paymentTargetConn.customerName}`
            : undefined
        }
      >
        {paymentTargetInvoice ? (
          <form onSubmit={handlePaymentSubmit} className="space-y-4">
            <div className="flex items-baseline justify-between border-b border-border/35 pb-3 text-label">
              <span className="text-muted">Remaining invoice balance</span>
              <span className="text-section font-semibold tabular-nums text-foreground">
                {formatCents(
                  Math.max(
                    0,
                    paymentTargetInvoice.totalPayableKsh - paymentTargetInvoice.amountPaidKsh
                  )
                )}
              </span>
            </div>

            <Field
              label="Payment amount (KSh)"
              type="number"
              step="1"
              min="1"
              max={(paymentTargetInvoice.totalPayableKsh - paymentTargetInvoice.amountPaidKsh).toFixed(0)}
              value={paymentAmountInput}
              onChange={(e) => {
                setPaymentAmountInput(e.target.value);
                setPaymentError('');
              }}
              error={paymentError}
              hint="Supports full settlement or partial installment toward arrears."
              autoFocus
              required
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SelectField
                label="Payment channel"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              >
                {Object.values(PaymentMethod).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </SelectField>

              <Field
                label="Receipt / M-Pesa reference"
                type="text"
                placeholder="e.g. QKH789XYZ"
                value={paymentRefInput}
                onChange={(e) => setPaymentRefInput(e.target.value)}
                required
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
              <Button tone="quiet" onClick={() => setPaymentModalInvoiceId(null)}>
                Cancel
              </Button>
              <Button type="submit" tone="primary">
                Post receipt
              </Button>
            </div>
          </form>
        ) : null}
      </ModalDialog>

      {/* Printable Payment Receipt Modal */}
      <PaymentReceiptModal
        open={Boolean(selectedPaymentForReceipt)}
        onClose={() => setSelectedPaymentForReceipt(null)}
        payment={selectedPaymentForReceipt}
        invoice={
          selectedPaymentForReceipt
            ? state.invoices.find((i) => i.id === selectedPaymentForReceipt.invoiceId) ?? null
            : null
        }
        connection={
          selectedPaymentForReceipt
            ? (() => {
                const inv = state.invoices.find((i) => i.id === selectedPaymentForReceipt.invoiceId);
                return inv ? connMap.get(inv.connectionId) ?? null : null;
              })()
            : null
        }
        onNotificationLogged={(entry) =>
          onLogNotification({
            ...entry,
            status: 'Sent',
          })
        }
      />

      {/* Client PDF Printable Invoice, WhatsApp & Email Modal */}
      <InvoiceShareModal
        open={invoiceShareModalOpen}
        onClose={() => setInvoiceShareModalOpen(false)}
        invoice={activeInvoice}
        connection={activeConnection}
        payments={activePayments}
        paybill={state.paybill}
        reading={
          activeInvoice
            ? state.readings.find((r) => r.id === activeInvoice.readingId) ?? null
            : null
        }
        onNotificationLogged={(entry) =>
          onLogNotification({
            ...entry,
            status: 'Sent',
          })
        }
      />

      {/* Monthly Collection and Arrears Audit Report Modal */}
      <MonthlyCollectionReportModal
        open={monthlyReportModalOpen}
        onClose={() => setMonthlyReportModalOpen(false)}
        state={state}
        cycleId={cycleFilter === 'ALL' ? ACTIVE_CYCLE_ID : cycleFilter}
        onReportDownloaded={onReportDownloaded}
      />

      {/* Lipa na M-Pesa Paybill Modal */}
      <PaybillModal
        open={paybillModalOpen}
        onClose={() => setPaybillModalOpen(false)}
        invoice={activeInvoice}
        connection={activeConnection}
        paybill={state.paybill}
        onUpdatePaybill={onUpdatePaybill}
        onRecordPayment={onRecordPayment}
      />
    </div>
  );
}



