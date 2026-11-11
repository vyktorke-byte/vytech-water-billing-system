import React from 'react';
import { PaymentRecord, WaterConnection, WaterInvoice } from '../types/billing';
import { formatCents, formatLocalDate, formatTenthsM3 } from '../lib/billingMath';
import { Button, ModalDialog } from './ui';
import { Download, Mail, MessageSquare, Printer, Send, ShieldCheck } from 'lucide-react';

export interface InvoiceShareModalProps {
  open: boolean;
  onClose: () => void;
  invoice: WaterInvoice | null;
  connection: WaterConnection | null;
  payments?: PaymentRecord[];
}

const BRAND_LOGO_PATH = '/assets/aistudio/vytech-icon_a1bffa57.svg';

export function InvoiceShareModal({
  open,
  onClose,
  invoice,
  connection,
  payments = [],
}: InvoiceShareModalProps) {
  if (!invoice || !connection) return null;

  const balanceDueKsh = Math.max(0, invoice.totalPayableKsh - invoice.amountPaidKsh);
  const isPaid = invoice.amountPaidKsh >= invoice.totalPayableKsh;

  // Clean phone number format for WhatsApp (defaults to Kenya 254 if starts with 0)
  const rawPhone = connection.phone.replace(/[^0-9]/g, '');
  const waPhone = rawPhone.startsWith('0')
    ? `254${rawPhone.slice(1)}`
    : rawPhone.startsWith('254')
    ? rawPhone
    : `254${rawPhone}`;

  // Pre-composed WhatsApp message text
  const waMessage = `Dear ${connection.customerName},

Here is your official water bill statement from Vytech Water Utility:
• Invoice Number: ${invoice.invoiceNumber}
• Billing Cycle: ${invoice.cycleId}
• Premise: ${connection.premiseAddress}
• Meter Serial: ${connection.meterSerial}
• Consumption: ${formatTenthsM3(invoice.consumptionTenthsM3)}
• Tariff: ${connection.category} (KSh ${invoice.ratePerM3}/m³)
• Billed Charges: ${formatCents(invoice.cycleChargesKsh)}
${invoice.arrearsBroughtForwardKsh > 0 ? `• Prior Arrears: ${formatCents(invoice.arrearsBroughtForwardKsh)}\n` : ''}• Amount Paid: ${formatCents(invoice.amountPaidKsh)}
• Total Balance Due: ${formatCents(balanceDueKsh)}
• Due Date: ${formatLocalDate(invoice.dueDate)}

Status: ${isPaid ? 'PAID IN FULL' : 'PENDING PAYMENT'}
Payment Method: M-Pesa Paybill or Bank Transfer with Ref: ${connection.accountCode}

Thank you for being a valued customer.
Vytech Water Utility ERP`;

  const waUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(waMessage)}`;

  // Pre-composed Email subject & body
  const emailSubject = `Vytech Water Bill Statement - ${invoice.invoiceNumber} (${connection.accountCode})`;
  const emailBody = `Dear ${connection.customerName},

Please find your official water utility invoice details below:

Invoice Number: ${invoice.invoiceNumber}
Account Code: ${connection.accountCode}
Premise Address: ${connection.premiseAddress}
Supply Zone: ${connection.zone}
Meter Serial: ${connection.meterSerial}
Billing Cycle: ${invoice.cycleId}
Issue Date: ${formatLocalDate(invoice.issueDate)}
Due Date: ${formatLocalDate(invoice.dueDate)}

METER READING & CONSUMPTION:
• Previous Reading: ${formatTenthsM3(invoice.previousTenthsM3)}
• Current Reading: ${formatTenthsM3(invoice.currentTenthsM3)}
• Billed Consumption: ${formatTenthsM3(invoice.consumptionTenthsM3)}
• Tariff Class: ${connection.category} @ KSh ${invoice.ratePerM3}/m³

CHARGES SUMMARY:
• Volumetric Water Charge: ${formatCents(invoice.volumetricKsh)}
${invoice.sewerageKsh > 0 ? `• Sewerage Charge: ${formatCents(invoice.sewerageKsh)}\n` : ''}• Cycle Total: ${formatCents(invoice.cycleChargesKsh)}
${invoice.arrearsBroughtForwardKsh > 0 ? `• Prior Unpaid Arrears: ${formatCents(invoice.arrearsBroughtForwardKsh)}\n` : ''}• Total Payable: ${formatCents(invoice.totalPayableKsh)}
• Payments Credited: ${formatCents(invoice.amountPaidKsh)}
• OUTSTANDING BALANCE: ${formatCents(balanceDueKsh)}

Payment Options:
M-Pesa / Bank Transfer using Reference: ${connection.accountCode}

For queries, contact support at billing@vytechwater.co.ke or call +254 700 000 000.

Sincerely,
Billing Department
Vytech Water Utility`;

  const mailtoUrl = `mailto:${encodeURIComponent(connection.email || '')}?subject=${encodeURIComponent(
    emailSubject
  )}&body=${encodeURIComponent(emailBody)}`;

  const handlePrintPdf = () => {
    window.print();
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Client Water Invoice & Statement"
      subtitle={`${invoice.invoiceNumber} · ${connection.customerName} (${connection.accountCode})`}
      maxWidthClass="max-w-2xl"
    >
      <div className="space-y-6">
        {/* Quick Dispatch Action Bar for WhatsApp, Email & PDF */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-control border border-border/45 bg-surface-muted/40 p-3 text-caption no-print">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">Client Channels:</span>
            <span className="text-muted">
              {connection.phone} · {connection.email || 'No email registered'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* WhatsApp Dispatch Button */}
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-control bg-[#25D366] px-3 py-1.5 font-medium text-white shadow-xs transition-colors hover:brightness-105 focus-visible:outline-2 focus-visible:outline-[#25D366]"
            >
              <MessageSquare className="size-3.5 fill-current" />
              <span>Send WhatsApp</span>
            </a>

            {/* Email Dispatch Button */}
            <a
              href={mailtoUrl}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-control border border-border/60 bg-surface px-3 py-1.5 font-medium text-foreground transition-colors hover:bg-background hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
            >
              <Mail className="size-3.5 text-primary" />
              <span>Send Email</span>
            </a>

            {/* Print / Save as PDF Button */}
            <Button tone="primary" size="sm" onClick={handlePrintPdf}>
              <Printer className="size-3.5" />
              <span>Print / PDF</span>
            </Button>
          </div>
        </div>

        {/* Printable Invoice Page Document */}
        <div
          id="printable-client-invoice"
          className="rounded-control border border-border/55 bg-surface p-6 shadow-sm print:m-0 print:border-none print:p-0 print:shadow-none"
        >
          {/* Header */}
          <div className="flex items-start justify-between border-b border-border/40 pb-4">
            <div className="flex items-center gap-3">
              <img
                src={BRAND_LOGO_PATH}
                alt="Vytech Water Logo"
                className="size-11 rounded-control object-contain"
                onError={(e) => {
                  (e.currentTarget as HTMLElement).style.display = 'none';
                }}
              />
              <div>
                <h1 className="text-section font-bold tracking-tight text-foreground">
                  Vytech Water Utility
                </h1>
                <p className="text-caption text-muted">
                  Municipal & Estate Water Billing Services
                </p>
                <p className="text-[11px] text-muted">
                  Nairobi, Kenya · P.O. Box 40120 · Tel: +254 700 000 000 · billing@vytechwater.co.ke
                </p>
              </div>
            </div>

            <div className="text-right">
              <span className={`inline-flex items-center gap-1 rounded-control px-2.5 py-1 text-caption font-bold ${
                isPaid ? 'bg-accent/15 text-accent' : 'bg-warning/15 text-warning'
              }`}>
                {isPaid ? 'PAID IN FULL' : 'TAX INVOICE'}
              </span>
              <div className="mt-1.5 font-mono text-title font-bold text-foreground">
                {invoice.invoiceNumber}
              </div>
              <div className="text-caption text-muted">
                Cycle: <span className="font-semibold text-foreground">{invoice.cycleId}</span>
              </div>
            </div>
          </div>

          {/* Bill-To & Account Meta */}
          <div className="mt-4 grid grid-cols-2 gap-4 rounded-control border border-border/30 bg-surface-muted/20 p-4 text-caption">
            <div>
              <span className="block font-semibold uppercase tracking-wider text-muted">
                Billed To:
              </span>
              <div className="mt-0.5 text-label font-bold text-foreground">
                {connection.customerName}
              </div>
              <div className="text-muted">
                Account No: <span className="font-mono font-medium text-foreground">{connection.accountCode}</span>
              </div>
              <div className="text-muted">
                Premise Address: {connection.premiseAddress}
              </div>
              <div className="text-muted">
                Supply Zone: <span className="font-medium text-foreground">{connection.zone}</span>
              </div>
              <div className="text-muted">
                Phone: <span className="font-mono">{connection.phone}</span>
              </div>
            </div>

            <div className="text-right">
              <span className="block font-semibold uppercase tracking-wider text-muted">
                Billing Details:
              </span>
              <div className="text-muted">
                Issue Date: <span className="font-medium text-foreground">{formatLocalDate(invoice.issueDate)}</span>
              </div>
              <div className="text-muted">
                Due Date: <span className="font-medium text-danger">{formatLocalDate(invoice.dueDate)}</span>
              </div>
              <div className="text-muted">
                Meter Serial: <span className="font-mono font-medium text-foreground">{connection.meterSerial}</span>
              </div>
              <div className="text-muted">
                Tariff Class: <span className="font-medium text-foreground">{connection.category}</span>
              </div>
              <div className="text-muted">
                Unit Rate: <span className="font-mono font-medium text-foreground">KSh {invoice.ratePerM3}/m³</span>
              </div>
            </div>
          </div>

          {/* Meter Register Reading Table */}
          <div className="mt-4 rounded-control border border-border/30 bg-background/50 p-3">
            <div className="grid grid-cols-3 divide-x divide-border/35 text-center text-caption">
              <div>
                <span className="text-muted uppercase text-[10px] font-semibold">Previous Index</span>
                <div className="font-mono text-label text-foreground">
                  {formatTenthsM3(invoice.previousTenthsM3)}
                </div>
              </div>
              <div>
                <span className="text-muted uppercase text-[10px] font-semibold">Current Index</span>
                <div className="font-mono text-label text-foreground">
                  {formatTenthsM3(invoice.currentTenthsM3)}
                </div>
              </div>
              <div>
                <span className="text-muted uppercase text-[10px] font-semibold">Billed Consumption</span>
                <div className="font-mono text-label font-bold text-primary">
                  {formatTenthsM3(invoice.consumptionTenthsM3)}
                </div>
              </div>
            </div>
          </div>

          {/* Volumetric Charges Breakdown Table */}
          <div className="mt-4">
            <table className="w-full border-collapse text-left text-caption">
              <thead>
                <tr className="border-b border-border/40 text-muted uppercase tracking-wider bg-surface-muted/30">
                  <th className="py-2.5 px-3">Description</th>
                  <th className="py-2.5 px-3 text-right">Volume</th>
                  <th className="py-2.5 px-3 text-right">Rate (KSh/m³)</th>
                  <th className="py-2.5 px-3 text-right">Amount (KSh)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/25 text-body">
                <tr>
                  <td className="py-3 px-3">
                    <div className="font-medium text-foreground">Water Consumption Charges</div>
                    <div className="text-caption text-muted">
                      Metered volumetric utility supply for {invoice.cycleId}
                    </div>
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-caption text-foreground">
                    {formatTenthsM3(invoice.consumptionTenthsM3)}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-caption text-foreground">
                    {invoice.ratePerM3}.00
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-label font-medium text-foreground">
                    {formatCents(invoice.volumetricKsh)}
                  </td>
                </tr>
                {invoice.sewerageKsh > 0 ? (
                  <tr>
                    <td className="py-2.5 px-3 font-medium text-foreground">
                      Sewerage & Wastewater Treatment
                    </td>
                    <td className="py-2.5 px-3 text-right text-muted">—</td>
                    <td className="py-2.5 px-3 text-right text-muted">—</td>
                    <td className="py-2.5 px-3 text-right font-mono text-label text-foreground">
                      {formatCents(invoice.sewerageKsh)}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {/* Statement Reconciliation Totals */}
          <div className="mt-4 flex flex-col items-end border-t border-border/40 pt-3 text-caption">
            <div className="w-full max-w-sm space-y-1.5">
              <div className="flex justify-between text-muted">
                <span>Cycle Water Charges:</span>
                <span className="font-mono tabular-nums text-foreground">
                  {formatCents(invoice.cycleChargesKsh)}
                </span>
              </div>

              {invoice.arrearsBroughtForwardKsh > 0 ? (
                <div className="flex justify-between text-warning">
                  <span>Prior Unpaid Arrears:</span>
                  <span className="font-mono tabular-nums">
                    +{formatCents(invoice.arrearsBroughtForwardKsh)}
                  </span>
                </div>
              ) : null}

              <div className="flex justify-between font-semibold text-foreground border-t border-border/25 pt-1.5">
                <span>Total Bill Payable:</span>
                <span className="font-mono tabular-nums text-label">
                  {formatCents(invoice.totalPayableKsh)}
                </span>
              </div>

              <div className="flex justify-between text-accent">
                <span>Payments Credited:</span>
                <span className="font-mono tabular-nums">
                  −{formatCents(invoice.amountPaidKsh)}
                </span>
              </div>

              <div className="flex justify-between border-t-2 border-border/45 pt-1.5 font-bold text-foreground">
                <span className="text-label">BALANCE DUE:</span>
                <span className={`font-mono tabular-nums text-title ${balanceDueKsh > 0 ? 'text-danger' : 'text-accent'}`}>
                  {formatCents(balanceDueKsh)}
                </span>
              </div>
            </div>
          </div>

          {/* Payment History if any */}
          {payments.length > 0 ? (
            <div className="mt-4 border-t border-border/30 pt-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted block mb-1.5">
                Payment Transactions Credited to this Bill:
              </span>
              <div className="space-y-1 text-caption">
                {payments.map((p) => (
                  <div key={p.id} className="flex justify-between text-muted">
                    <span>
                      Ref: <span className="font-mono text-foreground">{p.reference}</span> ({p.method}) · {formatLocalDate(p.paidDate)}
                    </span>
                    <span className="font-mono text-accent font-medium">
                      {formatCents(p.amountKsh)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Footer & Security Stamp */}
          <div className="mt-6 flex items-center justify-between border-t border-border/40 pt-4 text-caption text-muted">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="size-4 text-accent" />
              <span>Certified original electronic utility bill generated by Vytech Water ERP</span>
            </div>
            <div className="text-right font-mono text-[11px]">
              Doc ID: {invoice.id.toUpperCase()}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1 no-print">
          <Button tone="quiet" onClick={onClose}>
            Close
          </Button>

          <div className="flex items-center gap-2">
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-control bg-[#25D366] px-3.5 py-2 text-label font-medium text-white shadow-xs transition-colors hover:brightness-105"
            >
              <MessageSquare className="size-4 fill-current" />
              <span>Share on WhatsApp</span>
            </a>

            <a
              href={mailtoUrl}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-control border border-border/50 bg-surface px-3.5 py-2 text-label font-medium text-foreground transition-colors hover:bg-background"
            >
              <Mail className="size-4 text-primary" />
              <span>Email Invoice</span>
            </a>

            <Button tone="primary" onClick={handlePrintPdf}>
              <Printer className="size-4" />
              <span>Print / Save PDF</span>
            </Button>
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}
