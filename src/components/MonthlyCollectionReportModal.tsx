import React, { useMemo } from 'react';
import { BillingCycleId, BillingStoreState, InvoiceStatus } from '../types/billing';
import { formatCents, formatTenthsM3 } from '../lib/billingMath';
import {
  buildMonthlyMunicipalReportData,
  downloadMonthlyMunicipalReportPdf,
} from '../lib/monthlyReportPdf';
import { Button, ModalDialog } from './ui';
import { Download, FileText, Printer, ShieldCheck } from 'lucide-react';

export interface MonthlyCollectionReportModalProps {
  open: boolean;
  onClose: () => void;
  state: BillingStoreState;
  cycleId: BillingCycleId;
  onReportDownloaded?: (filename: string) => void;
}

const BRAND_LOGO_PATH = '/assets/aistudio/vytech-icon_a1bffa57.svg';

export function MonthlyCollectionReportModal({
  open,
  onClose,
  state,
  cycleId,
  onReportDownloaded,
}: MonthlyCollectionReportModalProps) {
  const reportData = useMemo(
    () => buildMonthlyMunicipalReportData(state, cycleId),
    [state, cycleId]
  );

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPdf = () => {
    const filename = downloadMonthlyMunicipalReportPdf({ state, cycleId });
    onReportDownloaded?.(filename);
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Municipal Monthly Revenue & Arrears Submission"
      subtitle={`${reportData.cycleLabel} (${reportData.cycleId}) · Ref ${reportData.submissionRef}`}
      maxWidthClass="max-w-4xl"
    >
      <div className="space-y-6">
        {/* Top Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border/45 bg-surface-muted/40 p-3 text-caption no-print">
          <div className="min-w-0">
            <span className="font-semibold text-foreground">Official Municipal Return:</span>{' '}
            <span className="font-mono text-muted">{reportData.submissionRef}</span>
            <span className="text-muted"> · Cycle cutoff {reportData.dueDateFormatted}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button tone="quiet" size="sm" onClick={handlePrint}>
              <Printer className="size-3.5" />
              <span>Print</span>
            </Button>
            <Button tone="primary" size="sm" onClick={handleDownloadPdf}>
              <Download className="size-3.5" />
              <span>Download Monthly Report</span>
            </Button>
          </div>
        </div>

        {/* Printable Official Municipal Submission Sheet */}
        <div
          id="printable-monthly-report"
          className="rounded-control border border-border/55 bg-surface p-6 shadow-sm print:m-0 print:border-none print:p-0 print:shadow-none"
        >
          {/* Header */}
          <div className="flex items-start justify-between border-b border-border/40 pb-4">
            <div className="flex items-center gap-3">
              <img
                src={BRAND_LOGO_PATH}
                alt="MajiTrack Emblem"
                className="size-11 rounded-control object-contain"
                onError={(e) => {
                  (e.currentTarget as HTMLElement).style.display = 'none';
                }}
              />
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted">
                  Official Municipal Water Utility Submission
                </p>
                <h1 className="text-title font-bold tracking-tight text-foreground">
                  MajiTrack Water Billing & Revenue Return
                </h1>
                <p className="text-caption font-semibold text-primary">
                  Gawanji Heights Apartments · Monthly Billed vs. Collected Revenue Audit
                </p>
                <p className="text-[11px] text-muted">
                  majitracksystembilling.net · Dual Tariff Metering (Residents KSh 150/m³ · Heavy Clients KSh 180/m³)
                </p>
              </div>
            </div>

            <div className="text-right">
              <span className="inline-flex items-center gap-1 rounded-control bg-primary/10 px-2.5 py-1 text-caption font-bold text-primary">
                <FileText className="size-3.5" />
                MUNICIPAL RETURN
              </span>
              <div className="mt-1.5 font-mono text-label font-bold text-foreground">
                {reportData.submissionRef}
              </div>
              <div className="text-caption text-muted">
                Cycle: {reportData.cycleLabel} ({reportData.cycleId})
              </div>
              <div className="text-[11px] text-muted">
                Issued: {reportData.generatedDateFormatted}
              </div>
            </div>
          </div>

          {/* 1. Executive Revenue Summary */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-control border border-border/30 bg-surface-muted/30 p-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Cycle Billed Charges
              </span>
              <div className="mt-1 font-mono text-title font-bold text-foreground">
                {formatCents(reportData.totalBilledKsh)}
              </div>
              <div className="text-[11px] text-muted">
                {formatTenthsM3(reportData.totalVolumeTenthsM3)} consumed
              </div>
            </div>

            <div className="rounded-control border border-border/30 bg-surface-muted/30 p-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Total Payable (w/ Arrears)
              </span>
              <div className="mt-1 font-mono text-title font-bold text-foreground">
                {formatCents(reportData.totalPayableKsh)}
              </div>
              <div className="text-[11px] text-muted">
                Prior arrears: {formatCents(reportData.totalArrearsBroughtFwdKsh)}
              </div>
            </div>

            <div className="rounded-control border border-border/30 bg-surface-muted/30 p-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Total Collected Revenue
              </span>
              <div className="mt-1 font-mono text-title font-bold text-accent">
                {formatCents(reportData.totalCollectedKsh)}
              </div>
              <div className="text-[11px] font-medium text-accent">
                {reportData.collectionVsPayablePct.toFixed(1)}% of total payable
              </div>
            </div>

            <div className="rounded-control border border-border/30 bg-surface-muted/30 p-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Outstanding Arrears
              </span>
              <div className="mt-1 font-mono text-title font-bold text-danger">
                {formatCents(reportData.totalOutstandingKsh)}
              </div>
              <div className="text-[11px] text-muted">
                {reportData.paidInvoicesCount}/{reportData.totalInvoices} bills settled
              </div>
            </div>
          </div>

          {/* Billed vs Collected Reconciliation Progress Bar */}
          <div className="mt-3 rounded-control border border-border/35 bg-background/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-caption">
              <span className="font-semibold text-foreground">
                Billed vs. Collected Reconciliation Ratio
              </span>
              <span className="font-mono text-muted">
                Collected {formatCents(reportData.totalCollectedKsh)} / {formatCents(reportData.totalPayableKsh)} ({reportData.collectionVsPayablePct.toFixed(1)}%)
              </span>
            </div>
            <div className="mt-2 h-2.5 w-full overflow-hidden rounded-control bg-border/25">
              <div
                className="h-full rounded-control bg-accent transition-all"
                style={{ width: `${Math.min(100, Math.max(0, reportData.collectionVsPayablePct))}%` }}
              />
            </div>
          </div>

          {/* 2. Tariff Classification & Volume Aggregation */}
          <div className="mt-5">
            <h2 className="text-label font-bold text-foreground uppercase tracking-wider border-b border-border/30 pb-1.5 mb-2">
              Tariff Classification Aggregation
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-caption">
                <thead>
                  <tr className="border-b border-border/40 text-muted uppercase tracking-wider bg-surface-muted/20">
                    <th className="py-2 px-2">Tariff Class</th>
                    <th className="py-2 px-2 text-right">Rate</th>
                    <th className="py-2 px-2 text-center">Meters</th>
                    <th className="py-2 px-2 text-right">Volume</th>
                    <th className="py-2 px-2 text-right">Cycle Billed</th>
                    <th className="py-2 px-2 text-right">Collected</th>
                    <th className="py-2 px-2 text-right">Balance Due</th>
                    <th className="py-2 px-2 text-right">Rate %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20 text-body text-[12px]">
                  {reportData.tariffBreakdown.map((t) => (
                    <tr key={t.category}>
                      <td className="py-2 px-2 font-medium text-foreground">{t.category}</td>
                      <td className="py-2 px-2 text-right font-mono text-muted">
                        KSh {t.ratePerM3}/m³
                      </td>
                      <td className="py-2 px-2 text-center font-mono text-muted">
                        {t.accountsCount}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-foreground">
                        {formatTenthsM3(t.consumptionTenthsM3)}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-foreground">
                        {formatCents(t.cycleBilledKsh)}
                      </td>
                      <td className="py-2 px-2 text-right font-mono font-medium text-accent">
                        {formatCents(t.collectedKsh)}
                      </td>
                      <td className="py-2 px-2 text-right font-mono font-semibold text-danger">
                        {formatCents(t.outstandingKsh)}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-foreground">
                        {t.collectionRatePct.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 3. Payment Channel Reconciliation */}
          <div className="mt-5">
            <h2 className="text-label font-bold text-foreground uppercase tracking-wider border-b border-border/30 pb-1.5 mb-2">
              Payment Channel Reconciliation
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-caption">
                <thead>
                  <tr className="border-b border-border/40 text-muted uppercase tracking-wider bg-surface-muted/20">
                    <th className="py-2 px-2">Channel</th>
                    <th className="py-2 px-2 text-center">Transactions</th>
                    <th className="py-2 px-2 text-right">Collected (KSh)</th>
                    <th className="py-2 px-2 text-right">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20 text-body text-[12px]">
                  {reportData.channelBreakdown.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-3 px-2 text-center text-muted">
                        No payments recorded in {reportData.cycleLabel}.
                      </td>
                    </tr>
                  ) : (
                    reportData.channelBreakdown.map((ch) => (
                      <tr key={ch.method}>
                        <td className="py-2 px-2 font-medium text-foreground">{ch.method}</td>
                        <td className="py-2 px-2 text-center font-mono text-muted">
                          {ch.transactionsCount}
                        </td>
                        <td className="py-2 px-2 text-right font-mono font-medium text-accent">
                          {formatCents(ch.amountKsh)}
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-muted">
                          {ch.sharePct.toFixed(1)}%
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 4. Customer Collection & Arrears Detailed Ledger */}
          <div className="mt-5">
            <h2 className="text-label font-bold text-foreground uppercase tracking-wider border-b border-border/30 pb-1.5 mb-2">
              Individual Account Billing & Arrears Schedule
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-caption">
                <thead>
                  <tr className="border-b border-border/40 text-muted uppercase tracking-wider bg-surface-muted/20">
                    <th className="py-2 px-2">Account & Customer</th>
                    <th className="py-2 px-2">Premise / Unit</th>
                    <th className="py-2 px-2">Meter</th>
                    <th className="py-2 px-2 text-right">Volume</th>
                    <th className="py-2 px-2 text-right">Billed</th>
                    <th className="py-2 px-2 text-right">Collected</th>
                    <th className="py-2 px-2 text-right">Balance Due</th>
                    <th className="py-2 px-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20 text-body text-[12px]">
                  {reportData.rows.map((row) => (
                    <tr key={row.invoiceId} className="hover:bg-background/40">
                      <td className="py-2 px-2">
                        <div className="font-medium text-foreground">{row.customerName}</div>
                        <div className="font-mono text-[11px] text-muted">
                          {row.accountCode} · {row.invoiceNumber}
                        </div>
                      </td>
                      <td className="py-2 px-2 text-muted">{row.premiseAddress}</td>
                      <td className="py-2 px-2 font-mono text-muted">{row.meterSerial}</td>
                      <td className="py-2 px-2 text-right font-mono text-foreground">
                        {formatTenthsM3(row.consumptionTenthsM3)}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-foreground">
                        {formatCents(row.cycleChargesKsh)}
                      </td>
                      <td className="py-2 px-2 text-right font-mono font-medium text-accent">
                        {formatCents(row.amountPaidKsh)}
                      </td>
                      <td
                        className={`py-2 px-2 text-right font-mono font-bold ${
                          row.balanceKsh > 0 ? 'text-danger' : 'text-accent'
                        }`}
                      >
                        {formatCents(row.balanceKsh)}
                      </td>
                      <td className="py-2 px-2 text-center">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded-xs text-[10px] font-semibold uppercase ${
                            row.status === InvoiceStatus.Paid
                              ? 'bg-accent/15 text-accent'
                              : row.status === InvoiceStatus.Overdue
                              ? 'bg-danger/15 text-danger'
                              : 'bg-warning/15 text-warning'
                          }`}
                        >
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 5. Municipal Submission Attestation Footer */}
          <div className="mt-6 rounded-control border border-border/35 bg-surface-muted/25 p-4 text-caption">
            <div className="font-bold uppercase tracking-wider text-foreground">
              Official Municipal Submission Attestation
            </div>
            <p className="mt-1 text-muted">
              Certified accurate for {reportData.cycleLabel} ({reportData.cycleId}):{' '}
              {formatCents(reportData.totalBilledKsh)} cycle billed vs.{' '}
              {formatCents(reportData.totalCollectedKsh)} collected (
              {formatCents(reportData.totalOutstandingKsh)} remaining balance).
            </p>
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="border-t border-border/50 pt-1.5">
                <div className="font-semibold text-foreground">Prepared By (Billing Clerk)</div>
                <div className="text-[11px] text-muted">Operator VK · MajiTrack</div>
              </div>
              <div className="border-t border-border/50 pt-1.5">
                <div className="font-semibold text-foreground">Verified By (Management)</div>
                <div className="text-[11px] text-muted">Gawanji Heights Apartments</div>
              </div>
              <div className="border-t border-border/50 pt-1.5">
                <div className="font-semibold text-foreground">Municipal Receiving Officer</div>
                <div className="text-[11px] text-muted">Date & Official Stamp</div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-border/40 pt-3 text-caption text-muted">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="size-4 text-accent" />
              <span>
                Certified municipal revenue return · Generated on {reportData.generatedDateFormatted}
              </span>
            </div>
            <div className="text-right font-mono text-[11px]">
              Ref: {reportData.submissionRef}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1 no-print">
          <Button tone="quiet" onClick={onClose}>
            Close
          </Button>

          <div className="flex flex-wrap items-center gap-2">
            <Button tone="quiet" onClick={handlePrint}>
              <Printer className="size-4" />
              <span>Print Layout</span>
            </Button>
            <Button tone="primary" onClick={handleDownloadPdf}>
              <Download className="size-4" />
              <span>Download Monthly Report</span>
            </Button>
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}
