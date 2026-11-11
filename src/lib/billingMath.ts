import {
  BillingCycleId,
  BillingCycleMeta,
  InvoiceStatus,
  MeterReading,
  PeriodFilterId,
  TariffCategory,
  TariffSchedule,
  WaterInvoice,
} from '../types/billing';

export const CYCLES: BillingCycleMeta[] = [
  {
    id: '2026-06',
    label: 'June 2026',
    shortLabel: 'Jun 26',
    issueDate: { year: 2026, month: 6, day: 10 },
    dueDate: { year: 2026, month: 6, day: 25 },
  },
  {
    id: '2026-07',
    label: 'July 2026',
    shortLabel: 'Jul 26',
    issueDate: { year: 2026, month: 7, day: 10 },
    dueDate: { year: 2026, month: 7, day: 25 },
  },
  {
    id: '2026-08',
    label: 'August 2026',
    shortLabel: 'Aug 26',
    issueDate: { year: 2026, month: 8, day: 10 },
    dueDate: { year: 2026, month: 8, day: 25 },
  },
  {
    id: '2026-09',
    label: 'September 2026',
    shortLabel: 'Sep 26',
    issueDate: { year: 2026, month: 9, day: 10 },
    dueDate: { year: 2026, month: 9, day: 25 },
  },
  {
    id: '2026-10',
    label: 'October 2026',
    shortLabel: 'Oct 26',
    issueDate: { year: 2026, month: 10, day: 10 },
    dueDate: { year: 2026, month: 10, day: 25 },
  },
  {
    id: '2026-11',
    label: 'November 2026',
    shortLabel: 'Nov 26',
    issueDate: { year: 2026, month: 11, day: 10 },
    dueDate: { year: 2026, month: 11, day: 25 },
  },
];

export const ACTIVE_CYCLE_ID: BillingCycleId = '2026-11';
export const TODAY_LOCAL = { year: 2026, month: 11, day: 11 };

const kshFormatter = new Intl.NumberFormat('en-KE', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const m3Formatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * Format monetary amount in Kenyan Shillings (KSh)
 */
export function formatCents(amountKsh: number): string {
  const safe = Number.isFinite(amountKsh) ? Math.round(amountKsh) : 0;
  return `KSh ${kshFormatter.format(safe)}`;
}

export function formatCentsCompact(amountKsh: number): string {
  const safe = Number.isFinite(amountKsh) ? Math.round(amountKsh) : 0;
  return `KSh ${kshFormatter.format(safe)}`;
}

export function formatTenthsM3(tenthsM3: number): string {
  const safe = Number.isFinite(tenthsM3) ? Math.round(tenthsM3) : 0;
  return `${m3Formatter.format(safe / 10)} m³`;
}

export function formatTenthsM3Plain(tenthsM3: number): string {
  const safe = Number.isFinite(tenthsM3) ? Math.round(tenthsM3) : 0;
  return m3Formatter.format(safe / 10);
}

export function parseM3InputToTenths(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 9_999_999) {
    return null;
  }
  return Math.round(parsed * 10);
}

export function parseUsdInputToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100_000_000) {
    return null;
  }
  return Math.round(parsed);
}

const shortDateFormatter = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const monthDayFormatter = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  day: 'numeric',
});

export function formatLocalDate(d: { year: number; month: number; day: number }, includeYear = true): string {
  const localDate = new Date(d.year, d.month - 1, d.day);
  return includeYear ? shortDateFormatter.format(localDate) : monthDayFormatter.format(localDate);
}

export function getCycleMeta(cycleId: BillingCycleId): BillingCycleMeta {
  return CYCLES.find((c) => c.id === cycleId) ?? CYCLES[CYCLES.length - 1];
}

export function getCyclesForPeriod(period: PeriodFilterId): {
  current: BillingCycleId[];
  comparison: BillingCycleId[] | null;
  periodLabel: string;
  comparisonLabel: string | null;
} {
  switch (period) {
    case '2026-11':
      return {
        current: ['2026-11'],
        comparison: ['2026-10'],
        periodLabel: 'Nov 2026 cycle',
        comparisonLabel: 'vs Oct 2026 cycle',
      };
    case '2026-10':
      return {
        current: ['2026-10'],
        comparison: ['2026-09'],
        periodLabel: 'Oct 2026 cycle',
        comparisonLabel: 'vs Sep 2026 cycle',
      };
    case 'Q3-2026':
      return {
        current: ['2026-07', '2026-08', '2026-09'],
        comparison: ['2026-06'],
        periodLabel: 'Q3 2026 (Jul–Sep)',
        comparisonLabel: null,
      };
    case '6M':
      return {
        current: ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'],
        comparison: null,
        periodLabel: 'Jun–Nov 2026 (6 cycles)',
        comparisonLabel: null,
      };
  }
}

export interface CalculatedBillBreakdown {
  consumptionTenthsM3: number;
  ratePerM3: number;
  volumetricKsh: number;
  sewerageKsh: number;
  cycleChargesKsh: number;
}

/**
 * Water calculation engine with two distinct tariff classes:
 * - Residents @ KSh 150 / m³
 * - Heavy Clients @ KSh 180 / m³
 * Operates on integer tenths of m³ (1 unit = 0.1 m³ = 100 L) and whole KSh.
 */
export function calculateWaterBill(
  consumptionTenthsM3: number,
  schedule: TariffSchedule
): CalculatedBillBreakdown {
  const safeTenths = Math.max(0, Math.round(consumptionTenthsM3));
  // 10 tenths = 1 m³
  const volumetricKsh = Math.round((safeTenths * schedule.ratePerM3) / 10);
  const sewerageKsh = Math.round((volumetricKsh * (schedule.seweragePercent || 0)) / 100);
  const cycleChargesKsh = volumetricKsh + sewerageKsh;

  return {
    consumptionTenthsM3: safeTenths,
    ratePerM3: schedule.ratePerM3,
    volumetricKsh,
    sewerageKsh,
    cycleChargesKsh,
  };
}

/**
 * Computes trailing 3-cycle mean consumption (in tenths of m³) and flags spikes >= 1.6x trailing mean
 */
export function evaluateConsumptionSpike(
  newConsumptionTenthsM3: number,
  priorReadings: MeterReading[]
): {
  trailingMeanTenthsM3: number | null;
  ratio: number | null;
  isSpike: boolean;
} {
  if (priorReadings.length === 0) {
    return { trailingMeanTenthsM3: null, ratio: null, isSpike: false };
  }
  const sorted = [...priorReadings].sort((a, b) => b.cycleId.localeCompare(a.cycleId));
  const recent = sorted.slice(0, 3);
  const sum = recent.reduce((acc, r) => acc + r.consumptionTenthsM3, 0);
  const mean = Math.round(sum / recent.length);
  if (mean <= 0) {
    return { trailingMeanTenthsM3: mean, ratio: null, isSpike: newConsumptionTenthsM3 >= 200 };
  }
  const ratio = newConsumptionTenthsM3 / mean;
  const isSpike = ratio >= 1.6 && newConsumptionTenthsM3 >= 150;
  return {
    trailingMeanTenthsM3: mean,
    ratio,
    isSpike,
  };
}

export function deriveInvoiceStatus(
  totalPayableKsh: number,
  amountPaidKsh: number,
  dueDate: { year: number; month: number; day: number },
  arrearsBroughtForwardKsh: number
): InvoiceStatus {
  if (amountPaidKsh >= totalPayableKsh) {
    return InvoiceStatus.Paid;
  }
  const dueVal = dueDate.year * 10000 + dueDate.month * 100 + dueDate.day;
  const todayVal = TODAY_LOCAL.year * 10000 + TODAY_LOCAL.month * 100 + TODAY_LOCAL.day;
  if (todayVal > dueVal || arrearsBroughtForwardKsh > amountPaidKsh) {
    return InvoiceStatus.Overdue;
  }
  return InvoiceStatus.Pending;
}

export function buildInvoicesCsv(
  invoices: WaterInvoice[],
  connectionLookup: Map<string, { accountCode: string; customerName: string; zone: string; meterSerial: string }>
): string {
  const headers = [
    'Invoice Number',
    'Billing Cycle',
    'Account Code',
    'Customer Name',
    'Supply Zone',
    'Meter Serial',
    'Previous (m3)',
    'Current (m3)',
    'Consumption (m3)',
    'Rate (KSh/m3)',
    'Cycle Charges (KSh)',
    'Prior Arrears (KSh)',
    'Total Payable (KSh)',
    'Paid (KSh)',
    'Balance Due (KSh)',
    'Status',
  ];

  const escapeCsv = (val: string) => {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };

  const rows = invoices.map((inv) => {
    const conn = connectionLookup.get(inv.connectionId);
    const balanceKsh = Math.max(0, inv.totalPayableKsh - inv.amountPaidKsh);
    return [
      inv.invoiceNumber,
      inv.cycleId,
      conn?.accountCode ?? inv.connectionId,
      conn?.customerName ?? 'Unknown',
      conn?.zone ?? '',
      conn?.meterSerial ?? '',
      formatTenthsM3Plain(inv.previousTenthsM3),
      formatTenthsM3Plain(inv.currentTenthsM3),
      formatTenthsM3Plain(inv.consumptionTenthsM3),
      inv.ratePerM3.toString(),
      inv.cycleChargesKsh.toFixed(0),
      inv.arrearsBroughtForwardKsh.toFixed(0),
      inv.totalPayableKsh.toFixed(0),
      inv.amountPaidKsh.toFixed(0),
      balanceKsh.toFixed(0),
      inv.status,
    ]
      .map(escapeCsv)
      .join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}
