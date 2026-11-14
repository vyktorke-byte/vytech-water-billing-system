import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  InvoiceStatus,
  MeterReading,
  PaybillSettings,
  PaymentRecord,
  WaterConnection,
  WaterInvoice,
} from '../types/billing';
import {
  DEFAULT_PAYBILL_NAME,
  DEFAULT_PAYBILL_NUMBER,
  formatCents,
  formatLocalDate,
  formatTenthsM3,
  getCycleMeta,
  TODAY_LOCAL,
} from './billingMath';

export interface CustomerInvoicePdfInput {
  invoice: WaterInvoice;
  connection: WaterConnection;
  payments?: PaymentRecord[];
  reading?: MeterReading | null;
  paybill?: PaybillSettings;
}

function getLastAutoTableY(doc: jsPDF, fallbackY: number): number {
  const internal = doc as unknown as { lastAutoTable?: { finalY?: number } };
  return internal.lastAutoTable?.finalY ?? fallbackY;
}

export function getCustomerInvoicePdfFilename(
  invoice: WaterInvoice,
  connection: WaterConnection
): string {
  const safeInv = invoice.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '');
  const safeAcct = connection.accountCode.replace(/[^a-zA-Z0-9_-]/g, '');
  return `MajiTrack-Invoice-${safeInv}-${safeAcct}.pdf`;
}

export function buildInvoiceWhatsAppMessage({
  invoice,
  connection,
  pdfFilename,
  paybill,
}: {
  invoice: WaterInvoice;
  connection: WaterConnection;
  pdfFilename?: string;
  paybill?: PaybillSettings;
}): string {
  const balanceDueKsh = Math.max(0, invoice.totalPayableKsh - invoice.amountPaidKsh);
  const isPaid = invoice.amountPaidKsh >= invoice.totalPayableKsh;
  const activePaybill = paybill?.primaryPaybill?.trim() || DEFAULT_PAYBILL_NUMBER;
  const activeBusiness = (paybill?.businessName?.trim() || DEFAULT_PAYBILL_NAME).replace(
    ' Water Billing',
    ''
  );
  const accountLabel = paybill?.accountLabel?.trim() || 'Account No';

  return `Dear ${connection.customerName},

Here is your official water bill statement from MajiTrack (Gawanji Heights Apartments)${
    pdfFilename ? ` (${pdfFilename})` : ''
  }:
• Invoice Number: ${invoice.invoiceNumber}
• Billing Cycle: ${invoice.cycleId}
• Premise: ${connection.premiseAddress}
• Meter Serial: ${connection.meterSerial}
• Consumption: ${formatTenthsM3(invoice.consumptionTenthsM3)}
• Tariff: ${connection.category} (KSh ${invoice.ratePerM3}/m³)
• Billed Charges: ${formatCents(invoice.cycleChargesKsh)}
${
  invoice.arrearsBroughtForwardKsh > 0
    ? `• Prior Arrears: ${formatCents(invoice.arrearsBroughtForwardKsh)}\n`
    : ''
}• Amount Paid: ${formatCents(invoice.amountPaidKsh)}
• Total Balance Due: ${formatCents(balanceDueKsh)}
• Due Date: ${formatLocalDate(invoice.dueDate)}

Status: ${isPaid ? 'PAID IN FULL' : invoice.status === InvoiceStatus.Overdue ? 'OVERDUE' : 'PENDING PAYMENT'}
Payment Method: Lipa na M-Pesa -> Paybill
• Business No: ${activePaybill} (${activeBusiness})
• ${accountLabel}: ${connection.accountCode}

Thank you for your prompt payment.
MajiTrack Water Billing · majitracksystembilling.net`;
}

export function buildCustomerInvoicePdfDocument({
  invoice,
  connection,
  payments = [],
  reading,
  paybill,
}: CustomerInvoicePdfInput): { doc: jsPDF; filename: string } {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 36;
  const contentWidth = pageWidth - marginX * 2;

  const navy: [number, number, number] = [16, 43, 80];
  const emerald: [number, number, number] = [21, 128, 93];
  const danger: [number, number, number] = [180, 45, 45];
  const amber: [number, number, number] = [180, 105, 14];
  const slate: [number, number, number] = [90, 105, 125];
  const borderGray: [number, number, number] = [208, 216, 226];
  const softBg: [number, number, number] = [244, 247, 250];

  const balanceDueKsh = Math.max(0, invoice.totalPayableKsh - invoice.amountPaidKsh);
  const isPaid = invoice.amountPaidKsh >= invoice.totalPayableKsh;
  const isOverdue = !isPaid && invoice.status === InvoiceStatus.Overdue;
  const cycleMeta = getCycleMeta(invoice.cycleId);
  const statusLabel = isPaid ? 'PAID IN FULL' : isOverdue ? 'OVERDUE NOTICE' : 'TAX INVOICE';
  const statusColor: [number, number, number] = isPaid ? emerald : isOverdue ? danger : amber;

  // Top Header Band
  doc.setFillColor(...navy);
  doc.rect(0, 0, pageWidth, 88, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('OFFICIAL WATER UTILITY BILL & STATEMENT', marginX, 24);

  doc.setFontSize(17);
  doc.text('MajiTrack Water Billing', marginX, 45);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(215, 228, 242);
  doc.text(
    'Gawanji Heights Apartments · Portal: majitracksystembilling.net',
    marginX,
    63
  );
  doc.text(
    'Email: billing@majitracksystembilling.net · Dual Tariff Metering',
    marginX,
    76
  );

  // Invoice Reference Box in Header
  doc.setFillColor(28, 61, 107);
  doc.roundedRect(pageWidth - marginX - 178, 16, 178, 60, 4, 4, 'F');

  doc.setFillColor(...statusColor);
  doc.roundedRect(pageWidth - marginX - 168, 22, 92, 15, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text(statusLabel, pageWidth - marginX - 122, 32, { align: 'center' });

  doc.setFont('courier', 'bold');
  doc.setFontSize(11);
  doc.text(invoice.invoiceNumber, pageWidth - marginX - 168, 52);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(215, 228, 242);
  doc.text(`Cycle: ${cycleMeta.label} (${invoice.cycleId})`, pageWidth - marginX - 168, 66);

  let cursorY = 106;

  // Billed To & Billing Details Two-Column Card
  doc.setFillColor(...softBg);
  doc.setDrawColor(...borderGray);
  doc.roundedRect(marginX, cursorY, contentWidth, 88, 4, 4, 'FD');

  const midX = marginX + contentWidth / 2;
  doc.line(midX, cursorY + 10, midX, cursorY + 78);

  // Left: Customer details
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...slate);
  doc.text('BILLED TO', marginX + 12, cursorY + 18);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...navy);
  doc.text(connection.customerName, marginX + 12, cursorY + 34);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(45, 55, 72);
  doc.text(`Account No: ${connection.accountCode}`, marginX + 12, cursorY + 49);
  doc.text(`Premise: ${connection.premiseAddress}`, marginX + 12, cursorY + 62);
  doc.text(
    `Phone: ${connection.phone}${connection.email ? ` · ${connection.email}` : ''}`,
    marginX + 12,
    cursorY + 75
  );

  // Right: Billing details
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...slate);
  doc.text('BILLING DETAILS', midX + 14, cursorY + 18);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(45, 55, 72);
  doc.text(`Issue Date: ${formatLocalDate(invoice.issueDate)}`, midX + 14, cursorY + 34);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...(isPaid ? emerald : danger));
  doc.text(`Due Date: ${formatLocalDate(invoice.dueDate)}`, midX + 14, cursorY + 48);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(45, 55, 72);
  doc.text(`Meter Serial: ${connection.meterSerial}`, midX + 14, cursorY + 62);
  doc.text(
    `Tariff: ${connection.category} (KSh ${invoice.ratePerM3}/m³)`,
    midX + 14,
    cursorY + 75
  );

  cursorY += 104;

  // Meter Index Strip
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...borderGray);
  doc.roundedRect(marginX, cursorY, contentWidth, 48, 4, 4, 'FD');

  const thirdW = contentWidth / 3;
  doc.line(marginX + thirdW, cursorY + 8, marginX + thirdW, cursorY + 40);
  doc.line(marginX + thirdW * 2, cursorY + 8, marginX + thirdW * 2, cursorY + 40);

  const meterCols = [
    { label: 'PREVIOUS INDEX', val: formatTenthsM3(invoice.previousTenthsM3), color: navy },
    { label: 'CURRENT INDEX', val: formatTenthsM3(invoice.currentTenthsM3), color: navy },
    {
      label: 'BILLED CONSUMPTION',
      val: formatTenthsM3(invoice.consumptionTenthsM3),
      color: emerald,
    },
  ];
  meterCols.forEach((col, i) => {
    const cx = marginX + thirdW * i + thirdW / 2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...slate);
    doc.text(col.label, cx, cursorY + 17, { align: 'center' });

    doc.setFont('courier', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...col.color);
    doc.text(col.val, cx, cursorY + 36, { align: 'center' });
  });

  cursorY += 62;

  // Optional Verified Meter Dial Photo Box (if base64 data URI is present)
  if (reading?.photoUrl && reading.photoUrl.startsWith('data:image/')) {
    doc.setFillColor(...softBg);
    doc.setDrawColor(...borderGray);
    doc.roundedRect(marginX, cursorY, contentWidth, 54, 4, 4, 'FD');

    let photoEmbedded = false;
    try {
      const imgType = reading.photoUrl.includes('image/png') ? 'PNG' : 'JPEG';
      doc.addImage(reading.photoUrl, imgType, marginX + 10, cursorY + 7, 40, 40);
      photoEmbedded = true;
    } catch {
      photoEmbedded = false;
    }

    const textOffset = photoEmbedded ? 62 : 12;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...navy);
    doc.text('VERIFIED METER DIAL PHOTO ON FILE', marginX + textOffset, cursorY + 22);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...slate);
    doc.text(
      `Captured on-site for meter ${connection.meterSerial} during ${invoice.cycleId} reading`,
      marginX + textOffset,
      cursorY + 37
    );

    cursorY += 68;
  }

  // Charges Table
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...navy);
  doc.text('ITEMIZED WATER CHARGES', marginX, cursorY);
  cursorY += 6;

  const chargeRows: string[][] = [
    [
      `Water Consumption Charges (${cycleMeta.label})\nMetered utility supply · ${connection.category}`,
      formatTenthsM3(invoice.consumptionTenthsM3),
      `${invoice.ratePerM3}.00`,
      formatCents(invoice.volumetricKsh),
    ],
  ];

  if (invoice.sewerageKsh > 0) {
    chargeRows.push([
      'Sewerage & Wastewater Treatment Surcharge',
      '—',
      '—',
      formatCents(invoice.sewerageKsh),
    ]);
  }

  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    headStyles: {
      fillColor: navy,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
    },
    bodyStyles: {
      fontSize: 8.5,
      textColor: [30, 41, 59],
    },
    head: [['Description', 'Volume', 'Rate (KSh/m³)', 'Amount (KSh)']],
    body: chargeRows,
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right', fontStyle: 'bold' },
    },
  });

  cursorY = getLastAutoTableY(doc, cursorY + 60) + 16;

  // Two-column Reconciliation: Left = Lipa na M-Pesa Instructions, Right = Statement Totals
  const boxHeight = invoice.arrearsBroughtForwardKsh > 0 ? 116 : 98;
  const leftBoxW = contentWidth * 0.48;
  const rightBoxW = contentWidth * 0.48;
  const rightBoxX = marginX + contentWidth - rightBoxW;

  // Left: M-Pesa Payment Box
  doc.setFillColor(...softBg);
  doc.setDrawColor(...borderGray);
  doc.roundedRect(marginX, cursorY, leftBoxW, boxHeight, 4, 4, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...emerald);
  doc.text('PAYMENT INSTRUCTIONS · LIPA NA M-PESA', marginX + 12, cursorY + 18);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(45, 55, 72);
  const pdfPaybill = paybill?.primaryPaybill?.trim() || DEFAULT_PAYBILL_NUMBER;
  const pdfBusiness = (paybill?.businessName?.trim() || 'MajiTrack').slice(0, 32);
  const pdfAcctLabel = paybill?.accountLabel?.trim() || 'Account Number';
  doc.text('1. Open M-Pesa -> Lipa na M-Pesa -> Paybill', marginX + 12, cursorY + 35);
  doc.text(
    `2. Business Number: ${pdfPaybill} (${pdfBusiness})`,
    marginX + 12,
    cursorY + 50
  );
  doc.text(`3. ${pdfAcctLabel}: ${connection.accountCode}`, marginX + 12, cursorY + 65);
  doc.text(
    `4. Amount Due: ${formatCents(balanceDueKsh)}`,
    marginX + 12,
    cursorY + 80
  );

  // Right: Totals Card
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...borderGray);
  doc.roundedRect(rightBoxX, cursorY, rightBoxW, boxHeight, 4, 4, 'FD');

  let ty = cursorY + 18;
  const drawTotalLine = (
    label: string,
    val: string,
    color: [number, number, number] = [45, 55, 72],
    bold = false
  ) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 9 : 8.5);
    doc.setTextColor(...color);
    doc.text(label, rightBoxX + 12, ty);
    doc.text(val, rightBoxX + rightBoxW - 12, ty, { align: 'right' });
    ty += 16;
  };

  drawTotalLine('Cycle Water Charges:', formatCents(invoice.cycleChargesKsh));
  if (invoice.arrearsBroughtForwardKsh > 0) {
    drawTotalLine(
      'Prior Unpaid Arrears:',
      `+${formatCents(invoice.arrearsBroughtForwardKsh)}`,
      amber
    );
  }
  drawTotalLine('Total Bill Payable:', formatCents(invoice.totalPayableKsh), navy, true);
  drawTotalLine('Payments Credited:', `-${formatCents(invoice.amountPaidKsh)}`, emerald);

  doc.setDrawColor(...borderGray);
  doc.line(rightBoxX + 10, ty - 8, rightBoxX + rightBoxW - 10, ty - 8);
  ty += 4;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...(balanceDueKsh > 0 ? danger : emerald));
  doc.text('BALANCE DUE:', rightBoxX + 12, ty);
  doc.text(formatCents(balanceDueKsh), rightBoxX + rightBoxW - 12, ty, { align: 'right' });

  cursorY += boxHeight + 18;

  // Payment History Table (if any)
  if (payments.length > 0) {
    if (cursorY > pageHeight - 130) {
      doc.addPage();
      cursorY = 44;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...navy);
    doc.text('PAYMENT TRANSACTIONS CREDITED', marginX, cursorY);
    cursorY += 6;

    autoTable(doc, {
      startY: cursorY,
      margin: { left: marginX, right: marginX },
      theme: 'striped',
      headStyles: {
        fillColor: [51, 65, 85],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8,
      },
      bodyStyles: {
        fontSize: 8,
        textColor: [30, 41, 59],
      },
      head: [['Date Credited', 'Channel', 'Transaction Ref', 'Amount (KSh)']],
      body: payments.map((p) => [
        formatLocalDate(p.paidDate),
        p.method,
        p.reference,
        formatCents(p.amountKsh),
      ]),
      columnStyles: {
        3: { halign: 'right', fontStyle: 'bold' },
      },
    });
  }

  // Footer across pages
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...borderGray);
    doc.line(marginX, pageHeight - 36, pageWidth - marginX, pageHeight - 36);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...slate);
    doc.text(
      `Certified electronic water utility bill · MajiTrack (majitracksystembilling.net) · Doc ID: ${invoice.id.toUpperCase()}`,
      marginX,
      pageHeight - 22
    );
    doc.text(
      `Generated ${formatLocalDate(TODAY_LOCAL)} · Page ${p} of ${totalPages}`,
      pageWidth - marginX,
      pageHeight - 22,
      { align: 'right' }
    );
  }

  const filename = getCustomerInvoicePdfFilename(invoice, connection);
  return { doc, filename };
}

export function downloadCustomerInvoicePdf(input: CustomerInvoicePdfInput): string {
  const { doc, filename } = buildCustomerInvoicePdfDocument(input);
  doc.save(filename);
  return filename;
}

export function createCustomerInvoicePdfFile(input: CustomerInvoicePdfInput): File {
  const { doc, filename } = buildCustomerInvoicePdfDocument(input);
  const blob = doc.output('blob');
  return new File([blob], filename, { type: 'application/pdf' });
}

export function canBrowserSharePdfFiles(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
    return false;
  }
  try {
    const probeFile = new File(['%PDF-1.4'], 'probe.pdf', { type: 'application/pdf' });
    return navigator.canShare({ files: [probeFile] });
  } catch {
    return false;
  }
}
