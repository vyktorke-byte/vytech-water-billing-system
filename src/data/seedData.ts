import {
  BillingCycleId,
  BillingStoreState,
  ConnectionStatus,
  InvoiceStatus,
  MeterReading,
  NotificationLog,
  PaybillSettings,
  PaymentMethod,
  PaymentRecord,
  TariffCategory,
  TariffSchedule,
  WaterConnection,
  WaterInvoice,
} from '../types/billing';
import {
  ALTERNATE_PAYBILL_NUMBER,
  calculateWaterBill,
  CYCLES,
  DEFAULT_PAYBILL_NAME,
  DEFAULT_PAYBILL_NUMBER,
  deriveInvoiceStatus,
  evaluateConsumptionSpike,
  formatCents,
  getCycleMeta,
} from '../lib/billingMath';

export const DEFAULT_PAYBILL_SETTINGS: PaybillSettings = {
  primaryPaybill: DEFAULT_PAYBILL_NUMBER,
  alternatePaybill: ALTERNATE_PAYBILL_NUMBER,
  businessName: DEFAULT_PAYBILL_NAME,
  accountLabel: 'Account Number',
};

export const DEFAULT_TARIFFS: Record<TariffCategory, TariffSchedule> = {
  [TariffCategory.Residential]: {
    category: TariffCategory.Residential,
    ratePerM3: 150, // KSh 150 for residents
    seweragePercent: 0,
  },
  [TariffCategory.HeavyClients]: {
    category: TariffCategory.HeavyClients,
    ratePerM3: 180, // KSh 180 for heavy clients
    seweragePercent: 0,
  },
};

interface SeedSpec {
  id: string;
  accountCode: string;
  customerName: string;
  premiseAddress: string;
  category: TariffCategory;
  meterSerial: string;
  status: ConnectionStatus;
  phone: string;
  email: string;
  baseIndexTenthsM3: number;
  monthlyTenths: [number, number, number, number, number, number | null];
  octPaymentBehavior: 'full' | 'unpaid' | 'partial';
  novPaymentBehavior?: 'full' | 'pending' | 'partial';
  paymentMethod: PaymentMethod;
  novNote?: string;
}

const SEED_SPECS: SeedSpec[] = [
  {
    id: 'conn-101',
    accountCode: 'VW-1042',
    customerName: 'Alderwood Bakery & Mill',
    premiseAddress: '412 Quarry Road',
    category: TariffCategory.HeavyClients,
    meterSerial: 'MTR-84102',
    status: ConnectionStatus.Active,
    phone: '0712345001',
    email: 'accounts@alderwoodmill.example.com',
    baseIndexTenthsM3: 28410,
    monthlyTenths: [615, 648, 672, 634, 658, 684],
    octPaymentBehavior: 'full',
    novPaymentBehavior: 'full',
    paymentMethod: PaymentMethod.BankTransfer,
  },
  {
    id: 'conn-102',
    accountCode: 'VW-1048',
    customerName: 'Amina Hassan',
    premiseAddress: 'Gawanji Heights, Unit 101',
    category: TariffCategory.Residential,
    meterSerial: 'MTR-84108',
    status: ConnectionStatus.Active,
    phone: '0722345002',
    email: 'amina.hassan@example.com',
    baseIndexTenthsM3: 13520,
    monthlyTenths: [174, 188, 196, 182, 186, 192],
    octPaymentBehavior: 'full',
    novPaymentBehavior: 'pending',
    paymentMethod: PaymentMethod.Mpesa,
  },
  {
    id: 'conn-103',
    accountCode: 'VW-1049',
    customerName: 'David Kamau',
    premiseAddress: 'Gawanji Heights, Unit 102',
    category: TariffCategory.Residential,
    meterSerial: 'MTR-84109',
    status: ConnectionStatus.Active,
    phone: '0722345006',
    email: 'david.kamau@example.com',
    baseIndexTenthsM3: 9800,
    monthlyTenths: [142, 148, 155, 146, 150, 154],
    octPaymentBehavior: 'full',
    novPaymentBehavior: 'full',
    paymentMethod: PaymentMethod.Mpesa,
  },
  {
    id: 'conn-104',
    accountCode: 'VW-1050',
    customerName: 'Grace Wanjiku',
    premiseAddress: 'Gawanji Heights, Unit 201',
    category: TariffCategory.Residential,
    meterSerial: 'MTR-84110',
    status: ConnectionStatus.Active,
    phone: '0722345010',
    email: 'grace.wanjiku@example.com',
    baseIndexTenthsM3: 11200,
    monthlyTenths: [160, 168, 172, 165, 169, 175],
    octPaymentBehavior: 'full',
    novPaymentBehavior: 'full',
    paymentMethod: PaymentMethod.Mpesa,
  },
  {
    id: 'conn-105',
    accountCode: 'VW-1055',
    customerName: 'Harbor Cold Storage',
    premiseAddress: 'Commercial Wing, Suite C1',
    category: TariffCategory.HeavyClients,
    meterSerial: 'MTR-84155',
    status: ConnectionStatus.Active,
    phone: '0733345003',
    email: 'facilities@harborcold.example.com',
    baseIndexTenthsM3: 142800,
    monthlyTenths: [1840, 1965, 2110, 1920, 1885, 1940],
    octPaymentBehavior: 'full',
    novPaymentBehavior: 'full',
    paymentMethod: PaymentMethod.BankTransfer,
  },
  {
    id: 'conn-106',
    accountCode: 'VW-1061',
    customerName: 'Crestline Linen Services',
    premiseAddress: 'Commercial Wing, Suite C2',
    category: TariffCategory.HeavyClients,
    meterSerial: 'MTR-84161',
    status: ConnectionStatus.Active,
    phone: '0711345004',
    email: 'ap@crestlinelinen.example.com',
    baseIndexTenthsM3: 89400,
    monthlyTenths: [1320, 1380, 1410, 1355, 1390, 2385],
    octPaymentBehavior: 'unpaid',
    novPaymentBehavior: 'pending',
    paymentMethod: PaymentMethod.BankTransfer,
    novNote: 'Boiler feed valve stuck open; customer notified on Nov 10',
  },
  {
    id: 'conn-107',
    accountCode: 'VW-1101',
    customerName: 'Samuel Mutua',
    premiseAddress: 'Gawanji Heights, Unit 202',
    category: TariffCategory.Residential,
    meterSerial: 'MTR-84201',
    status: ConnectionStatus.Active,
    phone: '0712001001',
    email: 'samuel.mutua@example.com',
    baseIndexTenthsM3: 1200,
    monthlyTenths: [95, 102, 110, 98, 104, 108],
    octPaymentBehavior: 'full',
    novPaymentBehavior: 'full',
    paymentMethod: PaymentMethod.Mpesa,
  },
  {
    id: 'conn-108',
    accountCode: 'VW-1102',
    customerName: 'Faith Njeri',
    premiseAddress: 'Gawanji Heights, Unit 203',
    category: TariffCategory.Residential,
    meterSerial: 'MTR-84202',
    status: ConnectionStatus.Active,
    phone: '0712001002',
    email: 'faith.njeri@example.com',
    baseIndexTenthsM3: 1450,
    monthlyTenths: [112, 118, 125, 119, 122, 128],
    octPaymentBehavior: 'full',
    novPaymentBehavior: 'pending',
    paymentMethod: PaymentMethod.Mpesa,
  },
  {
    id: 'conn-109',
    accountCode: 'VW-1103',
    customerName: 'Peter Ochieng',
    premiseAddress: 'Gawanji Heights, Unit 301',
    category: TariffCategory.Residential,
    meterSerial: 'MTR-84203',
    status: ConnectionStatus.Active,
    phone: '0712001003',
    email: 'peter.ochieng@example.com',
    baseIndexTenthsM3: 980,
    monthlyTenths: [88, 92, 95, 90, 94, 96],
    octPaymentBehavior: 'unpaid',
    novPaymentBehavior: 'pending',
    paymentMethod: PaymentMethod.Mpesa,
  },
  {
    id: 'conn-110',
    accountCode: 'VW-1104',
    customerName: 'Mary Akinyi',
    premiseAddress: 'Gawanji Heights, Unit 302',
    category: TariffCategory.Residential,
    meterSerial: 'MTR-84204',
    status: ConnectionStatus.Active,
    phone: '0712001004',
    email: 'mary.akinyi@example.com',
    baseIndexTenthsM3: 1600,
    monthlyTenths: [130, 136, 142, 138, 140, 145],
    octPaymentBehavior: 'full',
    novPaymentBehavior: 'full',
    paymentMethod: PaymentMethod.Mpesa,
  },
];

function cleanName(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function createInitialSeedState(): BillingStoreState {
  const connections: WaterConnection[] = [];
  const readings: MeterReading[] = [];
  const invoices: WaterInvoice[] = [];
  const payments: PaymentRecord[] = [];

  let invoiceSeq = 4100;
  let paymentSeq = 8800;

  const readerPool = ['VK', 'JM', 'AR'];

  SEED_SPECS.forEach((spec, specIdx) => {
    const customerName = cleanName(spec.customerName);
    const schedule = DEFAULT_TARIFFS[spec.category];
    let runningIndexTenths = spec.baseIndexTenthsM3;
    let runningUnpaidArrearsKsh = 0;
    let lastReadCycle: BillingCycleId = '2026-10';
    const connReadings: MeterReading[] = [];

    CYCLES.forEach((cycle, cycleIdx) => {
      const consumption = spec.monthlyTenths[cycleIdx];
      if (consumption === null) {
        return;
      }

      const prevTenths = runningIndexTenths;
      const currTenths = prevTenths + consumption;
      runningIndexTenths = currTenths;
      lastReadCycle = cycle.id;

      const spikeCheck = evaluateConsumptionSpike(consumption, connReadings);
      const readingId = `rd-${spec.id}-${cycle.id}`;
      const readDay = 8 + (specIdx % 3);

      const reading: MeterReading = {
        id: readingId,
        connectionId: spec.id,
        cycleId: cycle.id,
        readDate: { year: cycle.issueDate.year, month: cycle.issueDate.month, day: readDay },
        previousTenthsM3: prevTenths,
        currentTenthsM3: currTenths,
        consumptionTenthsM3: consumption,
        readerInitials: readerPool[(specIdx + cycleIdx) % readerPool.length],
        anomalyNote: cycle.id === '2026-11' ? spec.novNote : undefined,
        isSpikeFlagged: spikeCheck.isSpike,
      };

      connReadings.push(reading);
      readings.push(reading);

      const bill = calculateWaterBill(consumption, schedule);
      const arrearsBroughtForwardKsh = runningUnpaidArrearsKsh;
      const totalPayableKsh = bill.cycleChargesKsh + arrearsBroughtForwardKsh;

      let paidKsh = 0;
      if (cycleIdx < 4) {
        paidKsh = totalPayableKsh;
      } else if (cycle.id === '2026-10') {
        if (spec.octPaymentBehavior === 'full') {
          paidKsh = totalPayableKsh;
        } else if (spec.octPaymentBehavior === 'partial') {
          paidKsh = Math.round(totalPayableKsh * 0.55);
        } else {
          paidKsh = 0;
        }
      } else if (cycle.id === '2026-11') {
        if (spec.novPaymentBehavior === 'full') {
          paidKsh = totalPayableKsh;
        } else if (spec.novPaymentBehavior === 'partial') {
          paidKsh = Math.round(totalPayableKsh * 0.4);
        } else {
          paidKsh = 0;
        }
      }

      runningUnpaidArrearsKsh = Math.max(0, totalPayableKsh - paidKsh);

      invoiceSeq += 1;
      const invoiceId = `inv-${spec.id}-${cycle.id}`;
      const meta = getCycleMeta(cycle.id);
      const status: InvoiceStatus = deriveInvoiceStatus(
        totalPayableKsh,
        paidKsh,
        meta.dueDate,
        arrearsBroughtForwardKsh
      );

      const invoice: WaterInvoice = {
        id: invoiceId,
        invoiceNumber: `INV-${invoiceSeq}`,
        connectionId: spec.id,
        cycleId: cycle.id,
        readingId,
        issueDate: meta.issueDate,
        dueDate: meta.dueDate,
        previousTenthsM3: prevTenths,
        currentTenthsM3: currTenths,
        consumptionTenthsM3: consumption,
        ratePerM3: bill.ratePerM3,
        volumetricKsh: bill.volumetricKsh,
        sewerageKsh: bill.sewerageKsh,
        arrearsBroughtForwardKsh,
        cycleChargesKsh: bill.cycleChargesKsh,
        totalPayableKsh,
        amountPaidKsh: paidKsh,
        status,
      };
      invoices.push(invoice);

      if (paidKsh > 0) {
        paymentSeq += 1;
        const paidDay = cycle.id === '2026-11' ? 11 : 18 + (specIdx % 6);
        payments.push({
          id: `pay-${paymentSeq}`,
          invoiceId,
          paidDate: { year: meta.issueDate.year, month: meta.issueDate.month, day: paidDay },
          amountKsh: paidKsh,
          method: spec.paymentMethod,
          reference: `MP-${paymentSeq}`,
          status: 'Completed',
          connectionId: spec.id,
          accountCode: spec.accountCode,
        });
      }
    });

    connections.push({
      id: spec.id,
      accountCode: spec.accountCode,
      customerName,
      premiseAddress: spec.premiseAddress,
      category: spec.category,
      meterSerial: spec.meterSerial,
      status: spec.status,
      phone: spec.phone,
      email: spec.email,
      lastReadingTenthsM3: runningIndexTenths,
      lastReadCycle,
    });
  });

  const notifications: NotificationLog[] = [];
  const invByConnAndCycle = new Map<string, WaterInvoice>();
  for (const inv of invoices) {
    invByConnAndCycle.set(`${inv.connectionId}:${inv.cycleId}`, inv);
  }

  let notifSeq = 100;
  const pushSeedNotif = (entry: Omit<NotificationLog, 'id'>) => {
    notifSeq += 1;
    notifications.push({
      id: `ntf-${notifSeq}`,
      ...entry,
    });
  };

  for (const conn of connections) {
    const octInv = invByConnAndCycle.get(`${conn.id}:2026-10`);
    const novInv = invByConnAndCycle.get(`${conn.id}:2026-11`);

    if (octInv) {
      pushSeedNotif({
        connectionId: conn.id,
        customerName: conn.customerName,
        accountCode: conn.accountCode,
        invoiceId: octInv.id,
        invoiceNumber: octInv.invoiceNumber,
        channel: 'SMS',
        recipient: conn.phone,
        messageSummary: `Cycle 2026-10 water statement ${octInv.invoiceNumber} issued (${formatCents(
          octInv.totalPayableKsh
        )}). Paybill ${DEFAULT_PAYBILL_NUMBER} Ref ${conn.accountCode}.`,
        status: octInv.status === InvoiceStatus.Overdue ? 'Delivered' : 'Delivered',
        sentDate: { year: 2026, month: 10, day: 11 },
        sentTime: '09:15',
        dispatchedBy: 'System',
      });

      if (octInv.status === InvoiceStatus.Overdue) {
        pushSeedNotif({
          connectionId: conn.id,
          customerName: conn.customerName,
          accountCode: conn.accountCode,
          invoiceId: octInv.id,
          invoiceNumber: octInv.invoiceNumber,
          channel: 'EMAIL',
          recipient: conn.email,
          messageSummary: `Overdue arrears reminder for ${octInv.invoiceNumber} (${formatCents(
            Math.max(0, octInv.totalPayableKsh - octInv.amountPaidKsh)
          )} due).`,
          status: 'Delivered',
          sentDate: { year: 2026, month: 10, day: 28 },
          sentTime: '14:20',
          dispatchedBy: 'VK',
        });
      }
    }

    if (novInv) {
      pushSeedNotif({
        connectionId: conn.id,
        customerName: conn.customerName,
        accountCode: conn.accountCode,
        invoiceId: novInv.id,
        invoiceNumber: novInv.invoiceNumber,
        channel: 'EMAIL',
        recipient: conn.email,
        messageSummary: `November 2026 water bill ${novInv.invoiceNumber} (${formatCents(
          novInv.totalPayableKsh
        )}) due Nov 25, 2026.`,
        status: conn.id === 'conn-109' ? 'Failed' : 'Delivered',
        sentDate: { year: 2026, month: 11, day: 10 },
        sentTime: '10:05',
        dispatchedBy: 'System',
      });

      if (novInv.status === InvoiceStatus.Paid) {
        pushSeedNotif({
          connectionId: conn.id,
          customerName: conn.customerName,
          accountCode: conn.accountCode,
          invoiceId: novInv.id,
          invoiceNumber: novInv.invoiceNumber,
          channel: 'WHATSAPP',
          recipient: conn.phone,
          messageSummary: `Official WhatsApp payment receipt confirmed for ${novInv.invoiceNumber} (${formatCents(
            novInv.amountPaidKsh
          )}).`,
          status: 'Sent',
          sentDate: { year: 2026, month: 11, day: 11 },
          sentTime: '11:32',
          dispatchedBy: 'VK',
        });
      } else if (novInv.status === InvoiceStatus.Overdue) {
        pushSeedNotif({
          connectionId: conn.id,
          customerName: conn.customerName,
          accountCode: conn.accountCode,
          invoiceId: novInv.id,
          invoiceNumber: novInv.invoiceNumber,
          channel: 'SMS',
          recipient: conn.phone,
          messageSummary: `Urgent arrears notice: ${novInv.invoiceNumber} balance ${formatCents(
            Math.max(0, novInv.totalPayableKsh - novInv.amountPaidKsh)
          )}. Paybill ${DEFAULT_PAYBILL_NUMBER} Acc ${conn.accountCode}.`,
          status: 'Delivered',
          sentDate: { year: 2026, month: 11, day: 11 },
          sentTime: '08:45',
          dispatchedBy: 'JM',
        });
      }
    }
  }

  // Most recent notifications first
  notifications.sort((a, b) => {
    const scoreA = a.sentDate.year * 10000 + a.sentDate.month * 100 + a.sentDate.day;
    const scoreB = b.sentDate.year * 10000 + b.sentDate.month * 100 + b.sentDate.day;
    if (scoreA !== scoreB) return scoreB - scoreA;
    return b.sentTime.localeCompare(a.sentTime);
  });

  return {
    version: 1,
    connections,
    readings,
    invoices,
    payments,
    tariffs: structuredClone(DEFAULT_TARIFFS),
    notifications,
    mpesaTransactions: [],
    paybill: structuredClone(DEFAULT_PAYBILL_SETTINGS),
  };
}

export function createEmptyFreshState(): BillingStoreState {
  return {
    version: 1,
    connections: [],
    readings: [],
    invoices: [],
    payments: [],
    tariffs: structuredClone(DEFAULT_TARIFFS),
    notifications: [],
    mpesaTransactions: [],
    paybill: structuredClone(DEFAULT_PAYBILL_SETTINGS),
  };
}

const STORAGE_KEY = 'vytech_water_billing_state_v3';

export function loadBillingState(): BillingStoreState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyFreshState();
    const parsed = JSON.parse(raw) as Partial<BillingStoreState>;
    if (
      parsed &&
      parsed.version === 1 &&
      Array.isArray(parsed.connections) &&
      Array.isArray(parsed.readings) &&
      Array.isArray(parsed.invoices) &&
      Array.isArray(parsed.payments) &&
      parsed.tariffs
    ) {
      return {
        ...(parsed as BillingStoreState),
        notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
        mpesaTransactions: Array.isArray(parsed.mpesaTransactions) ? parsed.mpesaTransactions : [],
        paybill:
          parsed.paybill && typeof parsed.paybill.primaryPaybill === 'string'
            ? parsed.paybill
            : structuredClone(DEFAULT_PAYBILL_SETTINGS),
      };
    }
  } catch {
    // Fall back to clean empty state
  }
  return createEmptyFreshState();
}

export function saveBillingState(state: BillingStoreState): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
