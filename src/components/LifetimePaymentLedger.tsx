import React, { useMemo, useState } from 'react';
import { BillingStoreState, InvoiceStatus } from '../types/billing';
import {
  computeLifetimePaymentSummary,
  formatCents,
  formatLocalDate,
  LifetimeAccountPaymentRow,
} from '../lib/billingMath';
import { Button, Surface } from './ui';
import { CheckCircle2, Search, Users, XCircle } from 'lucide-react';

interface LifetimePaymentLedgerProps {
  state: BillingStoreState;
  onNavigateInvoices: (opts?: { status?: InvoiceStatus | 'ALL'; invoiceId?: string }) => void;
}

type LifetimeFilter = 'ALL' | 'PAID_IN_FULL' | 'HAS_PAID' | 'NOT_PAID';

export function LifetimePaymentLedger({
  state,
  onNavigateInvoices,
}: LifetimePaymentLedgerProps) {
  const [filter, setFilter] = useState<LifetimeFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const summary = useMemo(() => computeLifetimePaymentSummary(state), [state]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return summary.rows.filter((row) => {
      if (filter === 'PAID_IN_FULL' && row.standing !== 'PAID_IN_FULL') return false;
      if (filter === 'HAS_PAID' && row.lifetimePaidKsh <= 0) return false;
      if (
        filter === 'NOT_PAID' &&
        row.standing !== 'HAS_UNPAID' &&
        row.standing !== 'NEVER_PAID'
      ) {
        return false;
      }
      if (q) {
        const hay = `${row.connection.customerName} ${row.connection.accountCode} ${row.connection.premiseAddress} ${row.connection.meterSerial}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [summary.rows, filter, searchQuery]);

  const filterTabs: { id: LifetimeFilter; label: string; count: number }[] = [
    { id: 'ALL', label: 'All clients', count: summary.totalAccounts },
    { id: 'HAS_PAID', label: 'Who has paid', count: summary.accountsWithAnyPaymentCount },
    { id: 'PAID_IN_FULL', label: 'Paid in full', count: summary.accountsPaidInFullCount },
    { id: 'NOT_PAID', label: 'Not paid / unpaid', count: summary.accountsNotPaidCount },
  ];

  const renderStandingLabel = (row: LifetimeAccountPaymentRow) => {
    switch (row.standing) {
      case 'PAID_IN_FULL':
        return (
          <span className="inline-flex items-center gap-1 rounded-control bg-accent/12 px-2 py-0.5 text-caption font-semibold text-accent">
            <CheckCircle2 className="size-3" />
            Paid in full
          </span>
        );
      case 'NEVER_PAID':
        return (
          <span className="inline-flex items-center gap-1 rounded-control bg-danger/12 px-2 py-0.5 text-caption font-semibold text-danger">
            <XCircle className="size-3" />
            Never paid (0 receipts)
          </span>
        );
      case 'HAS_UNPAID':
        return (
          <span className="inline-flex items-center gap-1 rounded-control bg-warning/15 px-2 py-0.5 text-caption font-semibold text-warning">
            {`${row.unpaidBillsCount} unpaid ${row.unpaidBillsCount === 1 ? 'bill' : 'bills'}`}
          </span>
        );
      case 'NO_BILLS':
        return (
          <span className="inline-flex items-center rounded-control border border-border/45 px-2 py-0.5 text-caption text-muted">
            No bills yet
          </span>
        );
    }
  };

  return (
    <Surface className="overflow-hidden border-border/45">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/35 bg-surface px-5 py-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-control bg-primary/12 text-primary">
            <Users className="size-4" />
          </span>
          <div>
            <h2 className="text-section text-foreground">
              Lifetime Payment Status · Who Has Paid &amp; Unpaid Accounts
            </h2>
            <p className="text-caption text-muted">
              Cumulative payment tracker across all billing cycles ({summary.totalPaidInvoicesLifetime} paid bills ·{' '}
              {summary.totalUnpaidInvoicesLifetime} unpaid bills lifetime)
            </p>
          </div>
        </div>

        <div className="relative min-w-52 flex-1 sm:flex-initial">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            aria-label="Search lifetime payment ledger"
            placeholder="Search client or account..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="min-h-9 w-full rounded-control border border-border/55 bg-background pr-3 pl-9 text-label text-foreground placeholder:text-muted/75 focus-visible:outline-2 focus-visible:outline-primary"
          />
        </div>
      </div>

      {/* 4-column Lifetime KPI Strip */}
      <div className="grid grid-cols-1 divide-y divide-border/35 border-b border-border/35 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-y-0">
        <button
          type="button"
          onClick={() => setFilter('PAID_IN_FULL')}
          className="cursor-pointer p-4 text-left transition-colors hover:bg-background/60 focus-visible:outline-2 focus-visible:outline-primary"
        >
          <div className="text-caption font-medium text-muted">Accounts paid in full</div>
          <div className="mt-1 text-title font-semibold tabular-nums text-accent">
            {`${summary.accountsPaidInFullCount} of ${summary.totalAccounts}`}
          </div>
          <div className="mt-0.5 text-caption text-muted">
            {`${summary.accountsWithAnyPaymentCount} clients have made payments · ${summary.totalPaidInvoicesLifetime} bills paid`}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setFilter('NOT_PAID')}
          className="cursor-pointer p-4 text-left transition-colors hover:bg-background/60 focus-visible:outline-2 focus-visible:outline-primary"
        >
          <div className="text-caption font-medium text-muted">Accounts not paid (lifetime)</div>
          <div
            className={`mt-1 text-title font-semibold tabular-nums ${
              summary.accountsNotPaidCount > 0 ? 'text-danger' : 'text-foreground'
            }`}
          >
            {`${summary.accountsNotPaidCount} ${
              summary.accountsNotPaidCount === 1 ? 'account' : 'accounts'
            }`}
          </div>
          <div className="mt-0.5 text-caption text-muted">
            {`${summary.totalUnpaidInvoicesLifetime} unpaid ${
              summary.totalUnpaidInvoicesLifetime === 1 ? 'bill' : 'bills'
            } lifetime · ${summary.accountsNeverPaidCount} never paid`}
          </div>
        </button>

        <div className="p-4 text-left">
          <div className="text-caption font-medium text-muted">Lifetime cash collected</div>
          <div className="mt-1 text-title font-semibold tabular-nums text-foreground">
            {formatCents(summary.totalLifetimeCollectedKsh)}
          </div>
          <div className="mt-0.5 text-caption text-muted">
            {`Out of ${formatCents(summary.totalLifetimeBilledKsh)} billed all-time`}
          </div>
        </div>

        <div className="p-4 text-left">
          <div className="text-caption font-medium text-muted">Total unpaid balance</div>
          <div
            className={`mt-1 text-title font-semibold tabular-nums ${
              summary.totalLifetimeOutstandingKsh > 0 ? 'text-danger' : 'text-accent'
            }`}
          >
            {formatCents(summary.totalLifetimeOutstandingKsh)}
          </div>
          <div className="mt-0.5 text-caption text-muted">
            {summary.totalLifetimeOutstandingKsh > 0
              ? `Owed across ${summary.accountsNotPaidCount} accounts`
              : 'All billed accounts settled'}
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/35 bg-surface px-5 py-3">
        <div
          role="group"
          aria-label="Filter clients by lifetime payment status"
          className="flex flex-wrap items-center gap-1.5"
        >
          {filterTabs.map((tab) => {
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`min-h-8 cursor-pointer whitespace-nowrap rounded-control border px-3 text-caption font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border/45 bg-background text-foreground hover:bg-surface'
                }`}
              >
                {`${tab.label} · ${tab.count}`}
              </button>
            );
          })}
        </div>

        <Button
          tone="quiet"
          size="sm"
          onClick={() => onNavigateInvoices({ status: InvoiceStatus.Paid })}
        >
          View all receipts
        </Button>
      </div>

      {/* Table */}
      {filteredRows.length === 0 ? (
        <div className="px-6 py-10 text-center text-caption text-muted">
          <p className="text-label font-medium text-foreground">
            {summary.totalAccounts === 0
              ? 'No client accounts registered yet'
              : 'No client accounts match this filter'}
          </p>
          <p className="mt-1">
            {summary.totalAccounts === 0
              ? 'Add accounts or load sample demo data to view lifetime payment and unpaid counts.'
              : 'Try switching to All clients or clearing your search query.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border/30 bg-surface-muted/20 text-caption font-semibold uppercase tracking-wider text-muted">
                <th className="px-4 py-2.5">Client &amp; Account</th>
                <th className="px-4 py-2.5">Lifetime Standing</th>
                <th className="px-4 py-2.5 text-right">Bills (Paid / Unpaid)</th>
                <th className="px-4 py-2.5 text-right">Lifetime Paid</th>
                <th className="px-4 py-2.5 text-right">Unpaid Balance</th>
                <th className="px-4 py-2.5">Latest Payment</th>
                <th className="px-4 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/25 text-body">
              {filteredRows.map((row) => (
                <tr key={row.connection.id} className="transition-colors hover:bg-background/60">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{row.connection.customerName}</div>
                    <div className="mt-0.5 text-caption text-muted">
                      <span className="font-mono text-foreground/85">
                        {row.connection.accountCode}
                      </span>
                      {` · ${row.connection.premiseAddress}`}
                    </div>
                  </td>

                  <td className="px-4 py-3">{renderStandingLabel(row)}</td>

                  <td className="px-4 py-3 text-right tabular-nums text-caption">
                    <span className="font-semibold text-accent">{row.paidBillsCount} paid</span>
                    <span className="text-muted">{' / '}</span>
                    <span
                      className={
                        row.unpaidBillsCount > 0 ? 'font-semibold text-danger' : 'text-muted'
                      }
                    >
                      {row.unpaidBillsCount} unpaid
                    </span>
                  </td>

                  <td className="px-4 py-3 text-right tabular-nums">
                    <div className="font-medium text-foreground">
                      {formatCents(row.lifetimePaidKsh)}
                    </div>
                    <div className="text-caption text-muted">
                      {`${row.paymentCount} ${row.paymentCount === 1 ? 'receipt' : 'receipts'}`}
                    </div>
                  </td>

                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    <span
                      className={`font-semibold ${
                        row.currentBalanceKsh > 0 ? 'text-danger' : 'text-accent'
                      }`}
                    >
                      {formatCents(row.currentBalanceKsh)}
                    </span>
                  </td>

                  <td className="px-4 py-3 text-caption text-muted">
                    {row.latestPayment ? (
                      <div>
                        <div className="font-medium text-foreground">
                          {formatLocalDate(row.latestPayment.paidDate)}
                        </div>
                        <div className="text-[11px] font-mono">
                          {`${row.latestPayment.method} · ${row.latestPayment.reference}`}
                        </div>
                      </div>
                    ) : (
                      <span className="text-danger">No payments recorded</span>
                    )}
                  </td>

                  <td className="px-4 py-3 text-right">
                    {row.latestInvoice ? (
                      <Button
                        tone={row.currentBalanceKsh > 0 ? 'primary' : 'quiet'}
                        size="sm"
                        onClick={() =>
                          onNavigateInvoices({ invoiceId: row.latestInvoice!.id })
                        }
                      >
                        {row.currentBalanceKsh > 0 ? 'Collect bill' : 'View ledger'}
                      </Button>
                    ) : (
                      <span className="text-caption text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Surface>
  );
}
