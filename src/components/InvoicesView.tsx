import React, { useMemo, useState } from 'react';
import {
  BillingCycleId,
  BillingStoreState,
  InvoiceStatus,
  PaymentMethod,
  PaymentRecord,
  SupplyZone,
} from '../types/billing';
import {
  CYCLES,
  formatCents,
  formatLocalDate,
  formatTenthsM3,
  parseUsdInputToCents,
} from '../lib/billingMath';
import { Button, Field, ModalDialog, SelectField, Surface } from './ui';
import { ArrowLeft, Check, Mail, MessageSquare, Printer, Receipt, Search } from 'lucide-react';
import { PaymentReceiptModal } from './PaymentReceiptModal';
import { InvoiceShareModal } from './InvoiceShareModal';

interface InvoicesViewProps {
  state: BillingStoreState;
  statusFilter: InvoiceStatus | 'ALL';
  onStatusFilterChange: (s: InvoiceStatus | 'ALL') => void;
  zoneFilter: SupplyZone | 'ALL';
  onZoneFilterChange: (z: SupplyZone | 'ALL') => void;
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
}

export function InvoicesView({
  state,
  statusFilter,
  onStatusFilterChange,
  zoneFilter,
  onZoneFilterChange,
  selectedInvoiceId,
  onSelectInvoice,
  onRecordPayment,
  onBulkMarkPaid,
  onOpenOverdueUtility,
}: InvoicesViewProps) {
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

  const connMap = useMemo(
    () => new Map(state.connections.map((c) => [c.id, c])),
    [state.connections]
  );

  // Scope invoices before status filter so status counts reflect current cycle/zone/search
  const scopedInvoices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return state.invoices
      .filter((inv) => {
        if (cycleFilter !== 'ALL' && inv.cycleId !== cycleFilter) return false;
        const conn = connMap.get(inv.connectionId);
        if (zoneFilter !== 'ALL' && conn?.zone !== zoneFilter) return false;
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
  }, [state.invoices, cycleFilter, zoneFilter, searchQuery, connMap]);

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

  return (
    <div className="space-y-5">
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

          <select
            aria-label="Filter by supply zone"
            value={zoneFilter}
            onChange={(e) => onZoneFilterChange(e.target.value as SupplyZone | 'ALL')}
            className="min-h-10 rounded-control border border-border/55 bg-surface px-3 text-label text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          >
            <option value="ALL">All supply zones</option>
            <option value={SupplyZone.OldBuilding}>{SupplyZone.OldBuilding}</option>
            <option value={SupplyZone.NewBuilding}>{SupplyZone.NewBuilding}</option>
            <option value={SupplyZone.HeavyConsumer}>{SupplyZone.HeavyConsumer}</option>
          </select>

          {onOpenOverdueUtility && counts.overdue > 0 ? (
            <Button tone="danger" size="sm" onClick={onOpenOverdueUtility}>
              Notify {counts.overdue} overdue
            </Button>
          ) : null}
        </div>
      </div>

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
                Reset status, cycle, or zone filters to view billed water statements.
              </p>
              <div className="mt-4">
                <Button
                  tone="quiet"
                  size="sm"
                  onClick={() => {
                    onStatusFilterChange('ALL');
                    onZoneFilterChange('ALL');
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
                          {isPaid ? (
                            <Button
                              tone="ghost"
                              size="sm"
                              onClick={() => {
                                onSelectInvoice(inv.id);
                                setMobileDetailOpen(true);
                              }}
                            >
                              Receipt
                            </Button>
                          ) : (
                            <Button
                              tone="quiet"
                              size="sm"
                              onClick={() => openPaymentModal(inv.id)}
                            >
                              Pay
                            </Button>
                          )}
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
                      {`${activeConnection.premiseAddress} · ${activeConnection.zone}`}
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
              <div className="flex flex-wrap items-center justify-between gap-2.5 px-5 py-4 no-print border-t border-border/35 bg-surface-muted/15">
                <div className="flex items-center gap-2">
                  {activeInvoice.status !== InvoiceStatus.Paid ? (
                    <Button
                      tone="primary"
                      onClick={() => openPaymentModal(activeInvoice.id)}
                    >
                      Record payment
                    </Button>
                  ) : (
                    <span className="text-caption font-semibold text-accent">
                      Paid in full · No balance remaining
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    tone="quiet"
                    size="sm"
                    onClick={() => setInvoiceShareModalOpen(true)}
                    title="Send invoice statement to client on WhatsApp, Email, or Print PDF"
                  >
                    <MessageSquare className="size-3.5 text-[#25D366]" />
                    <Mail className="size-3.5 text-primary" />
                    <span>WhatsApp / Email</span>
                  </Button>

                  <Button
                    tone="quiet"
                    size="sm"
                    onClick={() => setInvoiceShareModalOpen(true)}
                    title="Print or Save PDF invoice"
                  >
                    <Printer className="size-3.5" />
                    <span>Print PDF</span>
                  </Button>
                </div>
              </div>
            </Surface>
          ) : (
            <Surface className="p-6 text-center">
              <p className="text-body text-muted">Select an invoice from the ledger to inspect its statement.</p>
            </Surface>
          )}
        </div>
      </div>

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
      />

      {/* Client PDF Printable Invoice, WhatsApp & Email Modal */}
      <InvoiceShareModal
        open={invoiceShareModalOpen}
        onClose={() => setInvoiceShareModalOpen(false)}
        invoice={activeInvoice}
        connection={activeConnection}
        payments={activePayments}
      />
    </div>
  );
}


