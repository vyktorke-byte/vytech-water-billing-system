import React, { useMemo, useState } from 'react';
import {
  MeterReading,
  NotificationChannel,
  PaybillSettings,
  PaymentRecord,
  WaterConnection,
  WaterInvoice,
} from '../types/billing';
import {
  ALTERNATE_PAYBILL_NUMBER,
  buildWhatsAppUrl,
  DEFAULT_PAYBILL_NUMBER,
  formatCents,
  formatLocalDate,
  formatTenthsM3,
} from '../lib/billingMath';
import {
  buildInvoiceWhatsAppMessage,
  canBrowserSharePdfFiles,
  createCustomerInvoicePdfFile,
  downloadCustomerInvoicePdf,
  getCustomerInvoicePdfFilename,
} from '../lib/invoicePdf';
import { Button, ModalDialog } from './ui';
import {
  Camera,
  CheckCircle2,
  Download,
  Mail,
  MessageSquare,
  Printer,
  Share2,
  ShieldCheck,
} from 'lucide-react';

export interface InvoiceShareModalProps {
  open: boolean;
  onClose: () => void;
  invoice: WaterInvoice | null;
  connection: WaterConnection | null;
  payments?: PaymentRecord[];
  reading?: MeterReading | null;
  paybill?: PaybillSettings;
  onNotificationLogged?: (entry: {
    connectionId: string;
    customerName: string;
    accountCode: string;
    invoiceId?: string;
    invoiceNumber?: string;
    channel: NotificationChannel;
    recipient: string;
    messageSummary: string;
  }) => void;
}

const BRAND_LOGO_PATH = '/assets/aistudio/vytech-icon_a1bffa57.svg';

export function InvoiceShareModal({
  open,
  onClose,
  invoice,
  connection,
  payments = [],
  reading,
  paybill,
  onNotificationLogged,
}: InvoiceShareModalProps) {
  const [pdfFeedback, setPdfFeedback] = useState<string>('');
  const [isSharingNative, setIsSharingNative] = useState(false);

  const supportsNativePdfShare = useMemo(() => canBrowserSharePdfFiles(), []);

  if (!invoice || !connection) return null;

  const balanceDueKsh = Math.max(0, invoice.totalPayableKsh - invoice.amountPaidKsh);
  const isPaid = invoice.amountPaidKsh >= invoice.totalPayableKsh;
  const pdfFilename = getCustomerInvoicePdfFilename(invoice, connection);

  const activePrimaryPaybill = paybill?.primaryPaybill?.trim() || DEFAULT_PAYBILL_NUMBER;
  const activeAlternatePaybill =
    paybill?.alternatePaybill !== undefined
      ? paybill.alternatePaybill.trim()
      : ALTERNATE_PAYBILL_NUMBER;
  const activeAccountLabel = paybill?.accountLabel?.trim() || 'Account Reference';

  const waMessage = buildInvoiceWhatsAppMessage({
    invoice,
    connection,
    paybill,
  });

  const waUrl = buildWhatsAppUrl(connection.phone, waMessage);

  // Pre-composed Email subject & body
  const emailSubject = `MajiTrack Water Bill Statement - ${invoice.invoiceNumber} (${connection.accountCode})`;
  const emailBody = `Dear ${connection.customerName},

Please find your official water utility invoice details below:

Invoice Number: ${invoice.invoiceNumber}
Account Code: ${connection.accountCode}
Premise Address: ${connection.premiseAddress}
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
M-Pesa Paybill ${activePrimaryPaybill}${activeAlternatePaybill ? ` (or ${activeAlternatePaybill})` : ''} · ${activeAccountLabel}: ${connection.accountCode}

For queries, contact support at billing@majitracksystembilling.net.

Sincerely,
Management & Billing Department
MajiTrack · Gawanji Heights Apartments`;

  const mailtoUrl = `mailto:${encodeURIComponent(connection.email || '')}?subject=${encodeURIComponent(
    emailSubject
  )}&body=${encodeURIComponent(emailBody)}`;

  const handlePrintPdf = () => {
    window.print();
  };

  const handleDownloadPdf = () => {
    const filename = downloadCustomerInvoicePdf({
      invoice,
      connection,
      payments,
      reading,
      paybill,
    });
    setPdfFeedback(`PDF downloaded: ${filename}`);
  };

  const logChannelDispatch = (channel: 'WHATSAPP' | 'EMAIL', summaryPrefix?: string) => {
    onNotificationLogged?.({
      connectionId: connection.id,
      customerName: connection.customerName,
      accountCode: connection.accountCode,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      channel,
      recipient: channel === 'WHATSAPP' ? connection.phone : connection.email || connection.phone,
      messageSummary: `${
        summaryPrefix ?? (channel === 'WHATSAPP' ? 'WhatsApp' : 'Email')
      } statement ${invoice.invoiceNumber} (${invoice.cycleId}) · Balance ${formatCents(
        balanceDueKsh
      )}`,
    });
  };

  const handleNativePdfShare = async () => {
    setIsSharingNative(true);
    try {
      const pdfFile = createCustomerInvoicePdfFile({
        invoice,
        connection,
        payments,
        reading,
        paybill,
      });
      if (navigator.canShare?.({ files: [pdfFile] })) {
        await navigator.share({
          title: `Water Invoice ${invoice.invoiceNumber} · ${connection.customerName}`,
          text: waMessage,
          files: [pdfFile],
        });
        logChannelDispatch('WHATSAPP', `Shared PDF (${pdfFile.name})`);
        setPdfFeedback(`Shared PDF file (${pdfFile.name}) successfully.`);
      } else {
        const filename = downloadCustomerInvoicePdf({
          invoice,
          connection,
          payments,
          reading,
          paybill,
        });
        setPdfFeedback(`PDF saved (${filename}) for WhatsApp attachment.`);
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        const filename = downloadCustomerInvoicePdf({
          invoice,
          connection,
          payments,
          reading,
          paybill,
        });
        setPdfFeedback(`PDF downloaded (${filename}) — attach it in WhatsApp.`);
      }
    } finally {
      setIsSharingNative(false);
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={() => {
        setPdfFeedback('');
        onClose();
      }}
      title="Client Water Invoice & Statement"
      subtitle={`${invoice.invoiceNumber} · ${connection.customerName} (${connection.accountCode})`}
      maxWidthClass="max-w-2xl"
    >
      <div className="space-y-5">
        {/* Quick Dispatch Action Bar for WhatsApp, PDF Download & Email */}
        <div className="space-y-2.5 rounded-control border border-border/45 bg-surface-muted/40 p-3 text-caption no-print">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">Client Channels:</span>
              <span className="text-muted">
                {connection.phone} · {connection.email || 'No email registered'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Direct WhatsApp Message Button */}
              <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => logChannelDispatch('WHATSAPP')}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-control bg-[#25D366] px-3 py-1.5 font-semibold text-white shadow-xs transition-colors hover:brightness-105 focus-visible:outline-2 focus-visible:outline-[#25D366]"
                title="Send invoice summary via WhatsApp"
              >
                <MessageSquare className="size-3.5 fill-current" />
                <span>Send WhatsApp</span>
              </a>

              {supportsNativePdfShare ? (
                <Button
                  tone="quiet"
                  size="sm"
                  onClick={handleNativePdfShare}
                  disabled={isSharingNative}
                  title="Attach invoice PDF file directly via device share sheet"
                >
                  <Share2 className="size-3.5 text-[#15803d]" />
                  <span>{isSharingNative ? 'Preparing...' : 'Share PDF'}</span>
                </Button>
              ) : null}

              {/* Standalone Download PDF Button */}
              <Button
                tone="quiet"
                size="sm"
                onClick={handleDownloadPdf}
                title={`Download ${pdfFilename}`}
              >
                <Download className="size-3.5 text-primary" />
                <span>Download PDF</span>
              </Button>

              {/* Email Dispatch Button */}
              <a
                href={mailtoUrl}
                onClick={() => logChannelDispatch('EMAIL')}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-control border border-border/60 bg-surface px-3 py-1.5 font-medium text-foreground transition-colors hover:bg-background hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
              >
                <Mail className="size-3.5 text-primary" />
                <span>Email</span>
              </a>

              {/* Print Button */}
              <Button tone="primary" size="sm" onClick={handlePrintPdf}>
                <Printer className="size-3.5" />
                <span>Print</span>
              </Button>
            </div>
          </div>

          {pdfFeedback ? (
            <div className="flex items-center gap-2 rounded-control border border-accent/35 bg-accent/10 px-3 py-2 text-caption font-medium text-accent">
              <CheckCircle2 className="size-4 shrink-0" />
              <span>{pdfFeedback}</span>
            </div>
          ) : null}
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
                alt="MajiTrack Logo"
                className="size-11 rounded-control object-contain"
                onError={(e) => {
                  (e.currentTarget as HTMLElement).style.display = 'none';
                }}
              />
              <div>
                <h1 className="text-section font-bold tracking-tight text-foreground">
                  MajiTrack Water Billing
                </h1>
                <p className="text-caption font-semibold text-primary">
                  Gawanji Heights Apartments
                </p>
                <p className="text-[11px] text-muted">
                  majitracksystembilling.net · Dual Tariff Metering · billing@majitracksystembilling.net
                </p>
              </div>
            </div>

            <div className="text-right">
              <span
                className={`inline-flex items-center gap-1 rounded-control px-2.5 py-1 text-caption font-bold ${
                  isPaid ? 'bg-accent/15 text-accent' : 'bg-warning/15 text-warning'
                }`}
              >
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
                Account No:{' '}
                <span className="font-mono font-medium text-foreground">
                  {connection.accountCode}
                </span>
              </div>
              <div className="text-muted">Premise Address: {connection.premiseAddress}</div>
              <div className="text-muted">
                Phone: <span className="font-mono">{connection.phone}</span>
              </div>
            </div>

            <div className="text-right">
              <span className="block font-semibold uppercase tracking-wider text-muted">
                Billing Details:
              </span>
              <div className="text-muted">
                Issue Date:{' '}
                <span className="font-medium text-foreground">
                  {formatLocalDate(invoice.issueDate)}
                </span>
              </div>
              <div className="text-muted">
                Due Date:{' '}
                <span className="font-medium text-danger">
                  {formatLocalDate(invoice.dueDate)}
                </span>
              </div>
              <div className="text-muted">
                Meter Serial:{' '}
                <span className="font-mono font-medium text-foreground">
                  {connection.meterSerial}
                </span>
              </div>
              <div className="text-muted">
                Tariff Class:{' '}
                <span className="font-medium text-foreground">{connection.category}</span>
              </div>
              <div className="text-muted">
                Unit Rate:{' '}
                <span className="font-mono font-medium text-foreground">
                  KSh {invoice.ratePerM3}/m³
                </span>
              </div>
            </div>
          </div>

          {/* Meter Register Reading Table */}
          <div className="mt-4 rounded-control border border-border/30 bg-background/50 p-3">
            <div className="grid grid-cols-3 divide-x divide-border/35 text-center text-caption">
              <div>
                <span className="text-muted uppercase text-[10px] font-semibold">
                  Previous Index
                </span>
                <div className="font-mono text-label text-foreground">
                  {formatTenthsM3(invoice.previousTenthsM3)}
                </div>
              </div>
              <div>
                <span className="text-muted uppercase text-[10px] font-semibold">
                  Current Index
                </span>
                <div className="font-mono text-label text-foreground">
                  {formatTenthsM3(invoice.currentTenthsM3)}
                </div>
              </div>
              <div>
                <span className="text-muted uppercase text-[10px] font-semibold">
                  Billed Consumption
                </span>
                <div className="font-mono text-label font-bold text-primary">
                  {formatTenthsM3(invoice.consumptionTenthsM3)}
                </div>
              </div>
            </div>
          </div>

          {/* Verified Meter Dial Photo Proof */}
          {reading?.photoUrl ? (
            <div className="mt-3 flex items-center justify-between rounded-control border border-border/40 bg-surface-muted/30 p-2.5 text-caption">
              <div className="flex items-center gap-3">
                <img
                  src={reading.photoUrl}
                  alt={`Dial photo for ${connection.meterSerial}`}
                  className="size-11 rounded-control object-cover border border-border/60"
                />
                <div>
                  <div className="font-semibold text-foreground flex items-center gap-1.5">
                    <Camera className="size-3.5 text-primary" />
                    <span>Verified Meter Register Dial Photo Attached</span>
                  </div>
                  <div className="text-[11px] text-muted">
                    Photo captured at meter box during index capture for billing transparency
                  </div>
                </div>
              </div>
              <span className="rounded-control bg-accent/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-accent">
                Verified Proof
              </span>
            </div>
          ) : null}

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
                <span
                  className={`font-mono tabular-nums text-title ${
                    balanceDueKsh > 0 ? 'text-danger' : 'text-accent'
                  }`}
                >
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
                      Ref: <span className="font-mono text-foreground">{p.reference}</span> (
                      {p.method}) · {formatLocalDate(p.paidDate)}
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
              <span>
                Certified original electronic utility bill generated by MajiTrack
                (majitracksystembilling.net)
              </span>
            </div>
            <div className="text-right font-mono text-[11px]">
              Doc ID: {invoice.id.toUpperCase()}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1 no-print">
          <Button
            tone="quiet"
            onClick={() => {
              setPdfFeedback('');
              onClose();
            }}
          >
            Close
          </Button>

          <div className="flex flex-wrap items-center gap-2">
            <Button tone="quiet" onClick={handleDownloadPdf}>
              <Download className="size-4 text-primary" />
              <span>Download PDF</span>
            </Button>

            <a
              href={mailtoUrl}
              onClick={() => logChannelDispatch('EMAIL')}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-control border border-border/50 bg-surface px-3.5 py-2 text-label font-medium text-foreground transition-colors hover:bg-background"
            >
              <Mail className="size-4 text-primary" />
              <span>Email</span>
            </a>

            <Button tone="primary" onClick={handlePrintPdf}>
              <Printer className="size-4" />
              <span>Print</span>
            </Button>
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}
