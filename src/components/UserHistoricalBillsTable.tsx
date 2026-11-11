import React, { useMemo, useState } from 'react';
import {
  BillingStoreState,
  InvoiceStatus,
  PaymentMethod,
  PaymentRecord,
  WaterConnection,
  WaterInvoice,
} from '../types/billing';
import { formatCents, formatLocalDate, formatTenthsM3 } from '../lib/billingMath';
import { Button, SelectField, Surface } from './ui';
import { Search } from 'lucide-react';

export interface UserHistoricalBillsTableProps {
  /** The water connection / user account whose historical bills are displayed */
  connection: WaterConnection;
  /** Full list of invoices (will be filtered to this connection) */
  invoices: WaterInvoice[];
  /** Full list of payment receipts (to display date and payment method) */
  payments: PaymentRecord[];
  /** Optional callback when clicking on an invoice to view its detailed statement */
  onViewInvoice?: (invoiceId: string) => void;
  /** Optional callback to initiate a payment on an unpaid invoice */
  onPayInvoice?: (invoiceId: string) => void;
  className?: string;
}

export function UserHistoricalBillsTable({
  connection,
  invoices,
  payments,
  onViewInvoice,
  onPayInvoice,
  className = '',
}: UserHistoricalBillsTableProps) {
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Index payments by invoiceId
  const paymentsByInvoice = useMemo(() => {
    const map = new Map<string, PaymentRecord[]>();
    for (const p of payments) {
      const arr = map.get(p.invoiceId) || [];
      arr.push(p);
      map.set(p.invoiceId, arr);
    }
    return map;
  }, [payments]);

  // Filter bills strictly belonging to this user's connection
  const userInvoices = useMemo(() => {
    return invoices
      .filter((inv) => inv.connectionId === connection.id)
      .sort((a, b) => {
        // Sort descending by billing cycle / issue date
        if (a.cycleId !== b.cycleId) {
          return b.cycleId.localeCompare(a.cycleId);
        }
        return b.invoiceNumber.localeCompare(a.invoiceNumber);
      });
  }, [invoices, connection.id]);

  // Counts for status chips
  const counts = useMemo(() => {
    let paid = 0;
    let pending = 0;
    let overdue = 0;
    for (const inv of userInvoices) {
      if (inv.status === InvoiceStatus.Paid) paid += 1;
      else if (inv.status === InvoiceStatus.Pending) pending += 1;
      else if (inv.status === InvoiceStatus.Overdue) overdue += 1;
    }
    return { all: userInvoices.length, paid, pending, overdue };
  }, [userInvoices]);

  // Apply status and search filter
  const displayedInvoices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return userInvoices.filter((inv) => {
      if (statusFilter !== 'ALL' && inv.status !== statusFilter) return false;
      if (q) {
        const hay = `${inv.invoiceNumber} ${inv.cycleId}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [userInvoices, statusFilter, searchQuery]);

  const statusTone = (status: InvoiceStatus) => {
    switch (status) {
      case InvoiceStatus.Paid:
        return 'text-accent font-medium';
      case InvoiceStatus.Overdue:
        return 'text-danger font-medium';
      case InvoiceStatus.Pending:
        return 'text-warning font-medium';
    }
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Filter historical water bills by payment status"
          className="flex flex-wrap items-center gap-1.5"
        >
          {(
            [
              { id: 'ALL', label: 'All bills', count: counts.all },
              { id: InvoiceStatus.Paid, label: 'Paid', count: counts.paid },
              { id: InvoiceStatus.Pending, label: 'Pending', count: counts.pending },
              { id: InvoiceStatus.Overdue, label: 'Overdue', count: counts.overdue },
            ] as const
          ).map((chip) => {
            const active = statusFilter === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => setStatusFilter(chip.id)}
                className={`min-h-8 cursor-pointer whitespace-nowrap rounded-control border px-2.5 text-caption font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border/45 bg-surface text-foreground hover:bg-background'
                }`}
              >
                {`${chip.label} · ${chip.count}`}
              </button>
            );
          })}
        </div>

        <div className="relative min-w-44 flex-1 sm:flex-initial">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted" />
          <input
            type="search"
            aria-label="Search bills by invoice number or cycle"
            placeholder="Search INV-..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="min-h-8 w-full rounded-control border border-border/55 bg-surface pr-3 pl-8 text-caption text-foreground placeholder:text-muted/75 focus-visible:outline-2 focus-visible:outline-primary"
          />
        </div>
      </div>

      {/* Historical Water Bills Table */}
      <div className="overflow-x-auto rounded-control border border-border/35 bg-surface">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border/35 text-caption font-semibold uppercase tracking-wider text-muted">
              <th className="px-4 py-3">Bill / Cycle</th>
              <th className="px-4 py-3">Billing Date</th>
              <th className="px-4 py-3 text-right">Volume</th>
              <th className="px-4 py-3 text-right">Bill Total</th>
              <th className="px-4 py-3 text-right">Amount Paid</th>
              <th className="px-4 py-3">Payment Status</th>
              {onViewInvoice || onPayInvoice ? (
                <th className="px-4 py-3 text-right">Action</th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30 text-body">
            {displayedInvoices.length === 0 ? (
              <tr>
                <td
                  colSpan={onViewInvoice || onPayInvoice ? 7 : 6}
                  className="px-4 py-8 text-center text-caption text-muted"
                >
                  No historical water bills match the selected filter.
                </td>
              </tr>
            ) : (
              displayedInvoices.map((inv) => {
                const invPayments = paymentsByInvoice.get(inv.id) || [];
                const latestPayment =
                  invPayments.length > 0
                    ? [...invPayments].sort((a, b) => {
                        const aVal = a.paidDate.year * 10000 + a.paidDate.month * 100 + a.paidDate.day;
                        const bVal = b.paidDate.year * 10000 + b.paidDate.month * 100 + b.paidDate.day;
                        return bVal - aVal;
                      })[0]
                    : null;
                const isPaid = inv.status === InvoiceStatus.Paid;
                const balanceKsh = Math.max(0, inv.totalPayableKsh - inv.amountPaidKsh);

                return (
                  <tr
                    key={inv.id}
                    className="transition-colors hover:bg-background/60"
                  >
                    {/* Bill / Cycle */}
                    <td className="px-4 py-3">
                      <div className="font-mono text-label font-medium text-foreground">
                        {inv.invoiceNumber}
                      </div>
                      <div className="text-caption text-muted">{inv.cycleId}</div>
                    </td>

                    {/* Date: Billing Issue Date & Due Date */}
                    <td className="px-4 py-3 text-caption text-foreground">
                      <div>{formatLocalDate(inv.issueDate)}</div>
                      <div className="text-muted">
                        Due {formatLocalDate(inv.dueDate, false)}
                      </div>
                    </td>

                    {/* Metered Volume */}
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">
                      {formatTenthsM3(inv.consumptionTenthsM3)}
                    </td>

                    {/* Bill Total Payable */}
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">
                      {formatCents(inv.totalPayableKsh)}
                    </td>

                    {/* Amount Paid with receipt date if available */}
                    <td className="px-4 py-3 text-right tabular-nums">
                      <div className={inv.amountPaidKsh > 0 ? 'font-medium text-accent' : 'text-muted'}>
                        {formatCents(inv.amountPaidKsh)}
                      </div>
                      {latestPayment ? (
                        <div className="text-caption text-muted">
                          Paid {formatLocalDate(latestPayment.paidDate, false)}
                        </div>
                      ) : balanceKsh > 0 ? (
                        <div className="text-caption text-warning">
                          Bal {formatCents(balanceKsh)}
                        </div>
                      ) : null}
                    </td>

                    {/* Payment Status */}
                    <td className="px-4 py-3">
                      <span className={`text-label ${statusTone(inv.status)}`}>
                        {inv.status}
                      </span>
                      {inv.status === InvoiceStatus.Overdue && (
                        <div className="text-caption text-danger">Past due</div>
                      )}
                    </td>

                    {/* Action */}
                    {onViewInvoice || onPayInvoice ? (
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          {onViewInvoice ? (
                            <Button
                              tone="quiet"
                              size="sm"
                              onClick={() => onViewInvoice(inv.id)}
                            >
                              Statement
                            </Button>
                          ) : null}
                          {!isPaid && onPayInvoice ? (
                            <Button
                              tone="primary"
                              size="sm"
                              onClick={() => onPayInvoice(inv.id)}
                            >
                              Pay
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
