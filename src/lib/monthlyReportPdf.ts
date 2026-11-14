import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  BillingCycleId,
  BillingStoreState,
  InvoiceStatus,
  PaymentMethod,
  TariffCategory,
} from '../types/billing';
import {
  ACTIVE_CYCLE_ID,
  formatCents,
  formatLocalDate,
  formatTenthsM3,
  getCycleMeta,
  TODAY_LOCAL,
} from './billingMath';

export interface TariffSummaryRow {
  category: TariffCategory;
  ratePerM3: number;
  accountsCount: number;
  consumptionTenthsM3: number;
  cycleBilledKsh: number;
  arrearsBroughtFwdKsh: number;
  totalPayableKsh: number;
  collectedKsh: number;
  outstandingKsh: number;
  collectionRatePct: number;
}

export interface ChannelSummaryRow {
  method: PaymentMethod;
  transactionsCount: number;
  amountKsh: number;
  sharePct: number;
}

export interface AccountLedgerRow {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  accountCode: string;
  premiseAddress: string;
  category: TariffCategory | string;
  meterSerial: string;
  previousTenthsM3: number;
  currentTenthsM3: number;
  consumptionTenthsM3: number;
  cycleChargesKsh: number;
  arrearsBroughtForwardKsh: number;
  totalPayableKsh: number;
  amountPaidKsh: number;
  balanceKsh: number;
  status: InvoiceStatus;
}

export interface MonthlyMunicipalReportData {
  cycleId: BillingCycleId;
  cycleLabel: string;
  submissionRef: string;
  issueDateFormatted: string;
  dueDateFormatted: string;
  generatedDateFormatted: string;
  totalConnectionsActive: number;
  totalInvoices: number;
  paidInvoicesCount: number;
  pendingInvoicesCount: number;
  overdueInvoicesCount: number;
  totalPaymentsCount: number;
  totalVolumeTenthsM3: number;
  totalBilledKsh: number;
  totalArrearsBroughtFwdKsh: number;
  totalPayableKsh: number;
  totalCollectedKsh: number;
  totalOutstandingKsh: number;
  collectionVsBilledPct: number;
  collectionVsPayablePct: number;
  tariffBreakdown: TariffSummaryRow[];
  channelBreakdown: ChannelSummaryRow[];
  rows: AccountLedgerRow[];
}

export function buildMonthlyMunicipalReportData(
  state: BillingStoreState,
  cycleId: BillingCycleId = ACTIVE_CYCLE_ID
): MonthlyMunicipalReportData {
  const cycleMeta = getCycleMeta(cycleId);
  const connMap = new Map(state.connections.map((c) => [c.id, c]));
  const cycleInvoices = state.invoices.filter((inv) => inv.cycleId === cycleId);
  const invoiceIds = new Set(cycleInvoices.map((i) => i.id));
  const cyclePayments = state.payments.filter((p) => invoiceIds.has(p.invoiceId));

  const totalBilledKsh = cycleInvoices.reduce((s, i) => s + i.cycleChargesKsh, 0);
  const totalArrearsBroughtFwdKsh = cycleInvoices.reduce(
    (s, i) => s + i.arrearsBroughtForwardKsh,
    0
  );
  const totalPayableKsh = cycleInvoices.reduce((s, i) => s + i.totalPayableKsh, 0);
  const totalCollectedKsh = cycleInvoices.reduce((s, i) => s + i.amountPaidKsh, 0);
  const totalOutstandingKsh = Math.max(0, totalPayableKsh - totalCollectedKsh);
  const totalVolumeTenthsM3 = cycleInvoices.reduce((s, i) => s + i.consumptionTenthsM3, 0);

  const collectionVsBilledPct =
    totalBilledKsh > 0 ? (totalCollectedKsh / totalBilledKsh) * 100 : 0;
  const collectionVsPayablePct =
    totalPayableKsh > 0 ? (totalCollectedKsh / totalPayableKsh) * 100 : 0;

  let paidInvoicesCount = 0;
  let pendingInvoicesCount = 0;
  let overdueInvoicesCount = 0;
  for (const inv of cycleInvoices) {
    if (inv.status === InvoiceStatus.Paid) paidInvoicesCount += 1;
    else if (inv.status === InvoiceStatus.Pending) pendingInvoicesCount += 1;
    else if (inv.status === InvoiceStatus.Overdue) overdueInvoicesCount += 1;
  }

  // Tariff class aggregation
  const tariffOrder = [TariffCategory.Residential, TariffCategory.HeavyClients];
  const tariffBreakdown: TariffSummaryRow[] = tariffOrder.map((category) => {
    const ratePerM3 =
      state.tariffs[category]?.ratePerM3 ??
      (category === TariffCategory.Residential ? 150 : 180);
    const matchingInvoices = cycleInvoices.filter((inv) => {
      const conn = connMap.get(inv.connectionId);
      return (conn?.category ?? TariffCategory.Residential) === category;
    });
    const consumptionTenthsM3 = matchingInvoices.reduce(
      (s, i) => s + i.consumptionTenthsM3,
      0
    );
    const cycleBilledKsh = matchingInvoices.reduce((s, i) => s + i.cycleChargesKsh, 0);
    const arrearsBroughtFwdKsh = matchingInvoices.reduce(
      (s, i) => s + i.arrearsBroughtForwardKsh,
      0
    );
    const catPayable = matchingInvoices.reduce((s, i) => s + i.totalPayableKsh, 0);
    const collectedKsh = matchingInvoices.reduce((s, i) => s + i.amountPaidKsh, 0);
    const outstandingKsh = Math.max(0, catPayable - collectedKsh);
    return {
      category,
      ratePerM3,
      accountsCount: matchingInvoices.length,
      consumptionTenthsM3,
      cycleBilledKsh,
      arrearsBroughtFwdKsh,
      totalPayableKsh: catPayable,
      collectedKsh,
      outstandingKsh,
      collectionRatePct: catPayable > 0 ? (collectedKsh / catPayable) * 100 : 0,
    };
  });

  // Payment channel reconciliation
  const channelMap = new Map<PaymentMethod, { count: number; amount: number }>();
  for (const p of cyclePayments) {
    const prev = channelMap.get(p.method) ?? { count: 0, amount: 0 };
    prev.count += 1;
    prev.amount += p.amountKsh;
    channelMap.set(p.method, prev);
  }
  const totalPaymentVolume = cyclePayments.reduce((s, p) => s + p.amountKsh, 0);
  const channelBreakdown: ChannelSummaryRow[] = Array.from(channelMap.entries())
    .map(([method, stat]) => ({
      method,
      transactionsCount: stat.count,
      amountKsh: stat.amount,
      sharePct: totalPaymentVolume > 0 ? (stat.amount / totalPaymentVolume) * 100 : 0,
    }))
    .sort((a, b) => b.amountKsh - a.amountKsh);

  // Account-level ledger rows
  const rows: AccountLedgerRow[] = cycleInvoices
    .map((inv) => {
      const conn = connMap.get(inv.connectionId);
      const balanceKsh = Math.max(0, inv.totalPayableKsh - inv.amountPaidKsh);
      return {
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customerName: conn?.customerName ?? 'Water Customer',
        accountCode: conn?.accountCode ?? inv.connectionId,
        premiseAddress: conn?.premiseAddress ?? 'N/A',
        category: conn?.category ?? TariffCategory.Residential,
        meterSerial: conn?.meterSerial ?? 'N/A',
        previousTenthsM3: inv.previousTenthsM3,
        currentTenthsM3: inv.currentTenthsM3,
        consumptionTenthsM3: inv.consumptionTenthsM3,
        cycleChargesKsh: inv.cycleChargesKsh,
        arrearsBroughtForwardKsh: inv.arrearsBroughtForwardKsh,
        totalPayableKsh: inv.totalPayableKsh,
        amountPaidKsh: inv.amountPaidKsh,
        balanceKsh,
        status: inv.status,
      };
    })
    .sort((a, b) => b.balanceKsh - a.balanceKsh || a.accountCode.localeCompare(b.accountCode));

  const submissionRef = `MUN-${cycleId.replace('-', '')}-GH-${String(
    cycleInvoices.length
  ).padStart(3, '0')}`;

  return {
    cycleId,
    cycleLabel: cycleMeta.label,
    submissionRef,
    issueDateFormatted: formatLocalDate(cycleMeta.issueDate),
    dueDateFormatted: formatLocalDate(cycleMeta.dueDate),
    generatedDateFormatted: formatLocalDate(TODAY_LOCAL),
    totalConnectionsActive: state.connections.length,
    totalInvoices: cycleInvoices.length,
    paidInvoicesCount,
    pendingInvoicesCount,
    overdueInvoicesCount,
    totalPaymentsCount: cyclePayments.length,
    totalVolumeTenthsM3,
    totalBilledKsh,
    totalArrearsBroughtFwdKsh,
    totalPayableKsh,
    totalCollectedKsh,
    totalOutstandingKsh,
    collectionVsBilledPct,
    collectionVsPayablePct,
    tariffBreakdown,
    channelBreakdown,
    rows,
  };
}

function getLastAutoTableY(doc: jsPDF, fallbackY: number): number {
  const internal = doc as unknown as { lastAutoTable?: { finalY?: number } };
  return internal.lastAutoTable?.finalY ?? fallbackY;
}

export function downloadMonthlyMunicipalReportPdf({
  state,
  cycleId = ACTIVE_CYCLE_ID,
}: {
  state: BillingStoreState;
  cycleId?: BillingCycleId;
}): string {
  const data = buildMonthlyMunicipalReportData(state, cycleId);
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 36;
  const contentWidth = pageWidth - marginX * 2;

  // Palette (deep marine ink, viridian emerald, slate, light porcelain tint)
  const navy: [number, number, number] = [16, 43, 80];
  const emerald: [number, number, number] = [21, 128, 93];
  const danger: [number, number, number] = [180, 45, 45];
  const slate: [number, number, number] = [90, 105, 125];
  const borderGray: [number, number, number] = [208, 216, 226];
  const softBg: [number, number, number] = [244, 247, 250];

  // Top Header Band
  doc.setFillColor(...navy);
  doc.rect(0, 0, pageWidth, 88, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('OFFICIAL MUNICIPAL WATER UTILITY SUBMISSION', marginX, 24);

  doc.setFontSize(17);
  doc.text('MajiTrack Water Billing & Revenue Return', marginX, 45);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(215, 228, 242);
  doc.text(
    'Entity: Gawanji Heights Apartments · Portal: majitracksystembilling.net',
    marginX,
    63
  );
  doc.text(
    `Reporting Cycle: ${data.cycleLabel} (${data.cycleId}) · Cycle Cutoff: ${data.dueDateFormatted}`,
    marginX,
    76
  );

  // Right-aligned Submission Reference Box in Header
  doc.setFillColor(28, 61, 107);
  doc.roundedRect(pageWidth - marginX - 168, 18, 168, 56, 4, 4, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('SUBMISSION REFERENCE', pageWidth - marginX - 158, 33);
  doc.setFont('courier', 'bold');
  doc.setFontSize(10.5);
  doc.text(data.submissionRef, pageWidth - marginX - 158, 48);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(215, 228, 242);
  doc.text(`Issued: ${data.generatedDateFormatted}`, pageWidth - marginX - 158, 63);

  let cursorY = 108;

  // Section 1: Executive Revenue Summary (Billed vs Collected)
  doc.setTextColor(...navy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('1. EXECUTIVE REVENUE SUMMARY (BILLED VS. COLLECTED)', marginX, cursorY);
  cursorY += 10;

  const cardGap = 8;
  const cardW = (contentWidth - cardGap * 3) / 4;
  const cardH = 58;

  const kpiCards: {
    label: string;
    value: string;
    sub: string;
    color: [number, number, number];
  }[] = [
    {
      label: 'CYCLE BILLED REVENUE',
      value: formatCents(data.totalBilledKsh),
      sub: `${formatTenthsM3(data.totalVolumeTenthsM3)} delivered`,
      color: navy,
    },
    {
      label: 'TOTAL PAYABLE (W/ ARREARS)',
      value: formatCents(data.totalPayableKsh),
      sub: `Prior arrears: ${formatCents(data.totalArrearsBroughtFwdKsh)}`,
      color: navy,
    },
    {
      label: 'COLLECTED REVENUE',
      value: formatCents(data.totalCollectedKsh),
      sub: `${data.collectionVsPayablePct.toFixed(1)}% of total payable`,
      color: emerald,
    },
    {
      label: 'OUTSTANDING ARREARS',
      value: formatCents(data.totalOutstandingKsh),
      sub: `${data.overdueInvoicesCount} overdue · ${data.pendingInvoicesCount} pending`,
      color: data.totalOutstandingKsh > 0 ? danger : emerald,
    },
  ];

  kpiCards.forEach((card, idx) => {
    const x = marginX + idx * (cardW + cardGap);
    doc.setFillColor(...softBg);
    doc.setDrawColor(...borderGray);
    doc.roundedRect(x, cursorY, cardW, cardH, 3, 3, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...slate);
    doc.text(card.label, x + 8, cursorY + 14);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...card.color);
    doc.text(card.value, x + 8, cursorY + 34);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...slate);
    doc.text(card.sub, x + 8, cursorY + 49);
  });

  cursorY += cardH + 14;

  // Billed vs Collected visual reconciliation bar
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...borderGray);
  doc.roundedRect(marginX, cursorY, contentWidth, 38, 3, 3, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...navy);
  doc.text('Collection Reconciliation Ratio (Collected vs. Total Payable)', marginX + 10, cursorY + 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...slate);
  doc.text(
    `Collected ${formatCents(data.totalCollectedKsh)} of ${formatCents(data.totalPayableKsh)} (${data.collectionVsPayablePct.toFixed(1)}%) · ${data.paidInvoicesCount}/${data.totalInvoices} invoices settled`,
    pageWidth - marginX - 10,
    cursorY + 14,
    { align: 'right' }
  );

  const barX = marginX + 10;
  const barY = cursorY + 22;
  const barW = contentWidth - 20;
  const barH = 8;
  doc.setFillColor(230, 236, 243);
  doc.roundedRect(barX, barY, barW, barH, 2, 2, 'F');

  const fillRatio = Math.min(1, Math.max(0, data.collectionVsPayablePct / 100));
  if (fillRatio > 0) {
    doc.setFillColor(...emerald);
    doc.roundedRect(barX, barY, Math.max(4, barW * fillRatio), barH, 2, 2, 'F');
  }

  cursorY += 54;

  // Section 2: Tariff Classification Breakdown
  doc.setTextColor(...navy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('2. TARIFF CLASSIFICATION & VOLUME AGGREGATION', marginX, cursorY);
  cursorY += 6;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    headStyles: {
      fillColor: navy,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [30, 41, 59],
    },
    footStyles: {
      fillColor: softBg,
      textColor: navy,
      fontStyle: 'bold',
      fontSize: 8,
    },
    head: [
      [
        'Tariff Class',
        'Rate (KSh/m³)',
        'Billed Meters',
        'Volume (m³)',
        'Cycle Billed',
        'Prior Arrears',
        'Total Payable',
        'Collected',
        'Balance Due',
        'Rate %',
      ],
    ],
    body: data.tariffBreakdown.map((t) => [
      t.category,
      `KSh ${t.ratePerM3}`,
      String(t.accountsCount),
      formatTenthsM3(t.consumptionTenthsM3),
      formatCents(t.cycleBilledKsh),
      formatCents(t.arrearsBroughtFwdKsh),
      formatCents(t.totalPayableKsh),
      formatCents(t.collectedKsh),
      formatCents(t.outstandingKsh),
      `${t.collectionRatePct.toFixed(1)}%`,
    ]),
    foot: [
      [
        'TOTAL',
        '—',
        String(data.totalInvoices),
        formatTenthsM3(data.totalVolumeTenthsM3),
        formatCents(data.totalBilledKsh),
        formatCents(data.totalArrearsBroughtFwdKsh),
        formatCents(data.totalPayableKsh),
        formatCents(data.totalCollectedKsh),
        formatCents(data.totalOutstandingKsh),
        `${data.collectionVsPayablePct.toFixed(1)}%`,
      ],
    ],
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'center' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' },
      8: { halign: 'right' },
      9: { halign: 'right' },
    },
  });

  cursorY = getLastAutoTableY(doc, cursorY + 60) + 18;

  // Section 3: Payment Channel Reconciliation
  doc.setTextColor(...navy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('3. PAYMENT CHANNEL RECONCILIATION SUMMARY', marginX, cursorY);
  cursorY += 6;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    headStyles: {
      fillColor: navy,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [30, 41, 59],
    },
    head: [['Payment Channel', 'Transactions Posted', 'Total Collected (KSh)', 'Share of Collections']],
    body:
      data.channelBreakdown.length > 0
        ? data.channelBreakdown.map((ch) => [
            ch.method,
            String(ch.transactionsCount),
            formatCents(ch.amountKsh),
            `${ch.sharePct.toFixed(1)}%`,
          ])
        : [['No payments recorded for this cycle', '0', 'KSh 0', '0.0%']],
    columnStyles: {
      1: { halign: 'center' },
      2: { halign: 'right' },
      3: { halign: 'right' },
    },
  });

  cursorY = getLastAutoTableY(doc, cursorY + 50) + 18;

  // Section 4: Itemized Account Billing & Arrears Schedule
  if (cursorY > pageHeight - 160) {
    doc.addPage();
    cursorY = 44;
  }

  doc.setTextColor(...navy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('4. ACCOUNT-LEVEL BILLING & ARREARS SCHEDULE', marginX, cursorY);
  cursorY += 6;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'striped',
    headStyles: {
      fillColor: navy,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.5,
    },
    bodyStyles: {
      fontSize: 7.5,
      textColor: [30, 41, 59],
    },
    head: [
      [
        'Account / Inv',
        'Customer & Premise',
        'Meter',
        'Vol (m³)',
        'Billed',
        'Arrears',
        'Payable',
        'Collected',
        'Balance',
        'Status',
      ],
    ],
    body:
      data.rows.length > 0
        ? data.rows.map((r) => [
            `${r.accountCode}\n${r.invoiceNumber}`,
            `${r.customerName}\n${r.premiseAddress}`,
            r.meterSerial,
            formatTenthsM3(r.consumptionTenthsM3),
            formatCents(r.cycleChargesKsh),
            formatCents(r.arrearsBroughtForwardKsh),
            formatCents(r.totalPayableKsh),
            formatCents(r.amountPaidKsh),
            formatCents(r.balanceKsh),
            r.status.toUpperCase(),
          ])
        : [['—', 'No invoices issued for this billing cycle', '—', '0.0 m³', 'KSh 0', 'KSh 0', 'KSh 0', 'KSh 0', 'KSh 0', 'N/A']],
    columnStyles: {
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' },
      8: { halign: 'right', fontStyle: 'bold' },
      9: { halign: 'center', fontStyle: 'bold' },
    },
  });

  cursorY = getLastAutoTableY(doc, cursorY + 60) + 22;

  // Section 5: Official Municipal Attestation & Sign-Off Block
  if (cursorY > pageHeight - 135) {
    doc.addPage();
    cursorY = 48;
  }

  doc.setFillColor(...softBg);
  doc.setDrawColor(...borderGray);
  doc.roundedRect(marginX, cursorY, contentWidth, 98, 4, 4, 'FD');

  doc.setTextColor(...navy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('5. OFFICIAL MUNICIPAL SUBMISSION ATTESTATION', marginX + 12, cursorY + 18);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...slate);
  doc.text(
    `We certify that the metered volumes, billed water charges (${formatCents(
      data.totalBilledKsh
    )}), collected revenue (${formatCents(
      data.totalCollectedKsh
    )}), and outstanding arrears (${formatCents(
      data.totalOutstandingKsh
    )}) reported for ${data.cycleLabel} accurately reflect the MajiTrack utility ledger.`,
    marginX + 12,
    cursorY + 33,
    { maxWidth: contentWidth - 24 }
  );

  const sigY = cursorY + 72;
  const colW = (contentWidth - 48) / 3;
  const signers = [
    { title: 'Prepared By (Billing Clerk)', sub: 'Operator VK · MajiTrack' },
    { title: 'Verified By (Property Management)', sub: 'Gawanji Heights Apartments' },
    { title: 'Municipal Water Authority Stamp', sub: 'Date & Official Endorsement' },
  ];

  signers.forEach((s, idx) => {
    const sx = marginX + 12 + idx * (colW + 12);
    doc.setDrawColor(148, 163, 184);
    doc.line(sx, sigY, sx + colW, sigY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...navy);
    doc.text(s.title, sx, sigY + 11);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...slate);
    doc.text(s.sub, sx, sigY + 20);
  });

  // Add consistent page footers across all pages
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...borderGray);
    doc.line(marginX, pageHeight - 32, pageWidth - marginX, pageHeight - 32);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...slate);
    doc.text(
      `MajiTrack Water Billing · Official Municipal Submission (${data.submissionRef})`,
      marginX,
      pageHeight - 19
    );
    doc.text(`Page ${p} of ${totalPages}`, pageWidth - marginX, pageHeight - 19, {
      align: 'right',
    });
  }

  const filename = `MajiTrack-Municipal-Monthly-Report-${data.cycleId}.pdf`;
  doc.save(filename);
  return filename;
}
