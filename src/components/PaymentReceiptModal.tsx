import React from 'react';
import { PaymentRecord, WaterConnection, WaterInvoice } from '../types/billing';
import { formatCents, formatLocalDate, formatTenthsM3 } from '../lib/billingMath';
import { Button, ModalDialog } from './ui';
import { CheckCircle2, Download, Printer, ShieldCheck } from 'lucide-react';

export interface PaymentReceiptModalProps {
  open: boolean;
  onClose: () => void;
  payment: PaymentRecord | null;
  invoice: WaterInvoice | null;
  connection: WaterConnection | null;
}

const BRAND_LOGO_PATH = '/assets/aistudio/vytech-icon_a1bffa57.svg';

export function PaymentReceiptModal({
  open,
  onClose,
  payment,
  invoice,
  connection,
}: PaymentReceiptModalProps) {
  if (!payment) return null;

  const handlePrint = () => {
    window.print();
  };

  const receiptNumber = `RCP-${payment.id.replace(/^pay-/, '').toUpperCase()}`;
  const isFullyPaid = invoice ? invoice.amountPaidKsh >= invoice.totalPayableKsh : false;
  const remainingBalanceKsh = invoice
    ? Math.max(0, invoice.totalPayableKsh - invoice.amountPaidKsh)
    : 0;

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Official Payment Receipt"
      subtitle={`${receiptNumber} · ${payment.reference}`}
      maxWidthClass="max-w-xl"
    >
      <div className="space-y-6">
        {/* Printable Receipt Paper Container */}
        <div
          id="printable-payment-receipt"
          className="rounded-control border border-border/55 bg-surface p-6 shadow-sm print:m-0 print:border-none print:p-0 print:shadow-none"
        >
          {/* Header & Logo */}
          <div className="flex items-start justify-between border-b border-border/40 pb-4">
            <div className="flex items-center gap-3">
              <img
                src={BRAND_LOGO_PATH}
                alt="Vytech Water Logo"
                className="size-10 rounded-control object-contain"
                onError={(e) => {
                  (e.currentTarget as HTMLElement).style.display = 'none';
                }}
              />
              <div>
                <h2 className="text-section font-bold tracking-tight text-foreground">
                  Vytech Water Utility
                </h2>
                <p className="text-caption text-muted">
                  Municipal & Estate Water Billing Services
                </p>
                <p className="text-caption text-muted">
                  Nairobi, Kenya · P.O. Box 40120 · Tel: +254 700 000 000
                </p>
              </div>
            </div>

            <div className="text-right">
              <span className="inline-flex items-center gap-1 rounded-control bg-accent/15 px-2.5 py-1 text-caption font-bold text-accent">
                <CheckCircle2 className="size-3.5" />
                OFFICIAL RECEIPT
              </span>
              <div className="mt-1.5 font-mono text-label font-bold text-foreground">
                {receiptNumber}
              </div>
              <div className="text-caption text-muted">
                Date: {formatLocalDate(payment.paidDate)}
              </div>
            </div>
          </div>

          {/* Customer & Premise Details */}
          <div className="mt-4 grid grid-cols-2 gap-4 rounded-control border border-border/30 bg-surface-muted/30 p-3.5 text-caption">
            <div>
              <span className="block font-semibold uppercase tracking-wider text-muted">
                Received From:
              </span>
              <span className="font-medium text-foreground text-label">
                {connection?.customerName || 'Water Consumer'}
              </span>
              <div className="mt-0.5 text-muted">
                Account: <span className="font-mono font-medium text-foreground">{connection?.accountCode || 'N/A'}</span>
              </div>
              <div className="text-muted">
                Premise: {connection?.premiseAddress || 'N/A'}
              </div>
              <div className="text-muted">
                Zone: <span className="font-medium text-foreground">{connection?.zone || 'N/A'}</span>
              </div>
            </div>

            <div className="text-right">
              <span className="block font-semibold uppercase tracking-wider text-muted">
                Billing Reference:
              </span>
              <div className="font-medium text-foreground">
                Invoice No: <span className="font-mono">{invoice?.invoiceNumber || 'N/A'}</span>
              </div>
              <div className="text-muted">
                Billing Cycle: {invoice?.cycleId || 'Current'}
              </div>
              <div className="text-muted">
                Meter Serial: <span className="font-mono font-medium text-foreground">{connection?.meterSerial || 'N/A'}</span>
              </div>
              {invoice?.consumptionTenthsM3 !== undefined ? (
                <div className="text-muted">
                  Billed Volume: {formatTenthsM3(invoice.consumptionTenthsM3)}
                </div>
              ) : null}
            </div>
          </div>

          {/* Payment Breakdown Table */}
          <div className="mt-5">
            <table className="w-full border-collapse text-left text-caption">
              <thead>
                <tr className="border-b border-border/40 text-muted uppercase tracking-wider">
                  <th className="py-2">Item Description</th>
                  <th className="py-2 text-center">Channel</th>
                  <th className="py-2 text-center">Transaction Ref</th>
                  <th className="py-2 text-right">Amount (KSh)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/25 text-body">
                <tr>
                  <td className="py-3">
                    <div className="font-medium text-foreground">
                      Water Utility Bill Payment
                    </div>
                    <div className="text-caption text-muted">
                      Credited toward {invoice?.invoiceNumber || 'account arrears'}
                    </div>
                  </td>
                  <td className="py-3 text-center">
                    <span className="inline-block rounded-xs bg-surface-muted px-2 py-0.5 font-medium text-foreground text-caption">
                      {payment.method}
                    </span>
                  </td>
                  <td className="py-3 text-center font-mono font-medium text-foreground">
                    {payment.reference}
                  </td>
                  <td className="py-3 text-right font-mono text-label font-bold text-accent">
                    {formatCents(payment.amountKsh)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Summary Box */}
          <div className="mt-4 flex flex-col items-end border-t border-border/40 pt-3 text-caption">
            <div className="w-full max-w-xs space-y-1.5">
              <div className="flex justify-between text-muted">
                <span>Total Invoice Charges:</span>
                <span className="font-mono tabular-nums text-foreground">
                  {invoice ? formatCents(invoice.totalPayableKsh) : '—'}
                </span>
              </div>
              <div className="flex justify-between font-semibold text-accent border-b border-border/25 pb-1.5">
                <span>Amount Paid This Receipt:</span>
                <span className="font-mono tabular-nums text-label">
                  {formatCents(payment.amountKsh)}
                </span>
              </div>
              <div className="flex justify-between text-muted pt-0.5">
                <span>Remaining Statement Balance:</span>
                <span className={`font-mono font-medium tabular-nums ${remainingBalanceKsh > 0 ? 'text-danger' : 'text-accent'}`}>
                  {formatCents(remainingBalanceKsh)}
                </span>
              </div>
              {isFullyPaid ? (
                <div className="mt-1 text-right text-[11px] font-semibold uppercase tracking-wider text-accent">
                  ✓ Settle in full
                </div>
              ) : null}
            </div>
          </div>

          {/* Security & Authentication Seal Footer */}
          <div className="mt-6 flex items-center justify-between border-t border-border/40 pt-4 text-caption text-muted">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="size-4 text-accent" />
              <span>Electronically generated and verified by Vytech Water ERP</span>
            </div>
            <div className="text-right font-mono text-[11px]">
              Auth Hash: {payment.id.slice(-8).toUpperCase()}
            </div>
          </div>
        </div>

        {/* Dialog Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1 no-print">
          <Button tone="quiet" onClick={onClose}>
            Close
          </Button>

          <div className="flex items-center gap-2">
            <Button tone="primary" onClick={handlePrint}>
              <Printer className="size-4" />
              Print Receipt
            </Button>
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}
