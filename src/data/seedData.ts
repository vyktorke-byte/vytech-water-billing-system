import {
  BillingCycleId,
  BillingStoreState,
  ConnectionStatus,
  InvoiceStatus,
  MeterReading,
  PaymentMethod,
  PaymentRecord,
  SupplyZone,
  TariffCategory,
  TariffSchedule,
  WaterConnection,
  WaterInvoice,
} from '../types/billing';
import {
  calculateWaterBill,
  CYCLES,
  deriveInvoiceStatus,
  evaluateConsumptionSpike,
  getCycleMeta,
} from '../lib/billingMath';

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
  zone: SupplyZone;
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
    zone: SupplyZone.HeavyConsumer,
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
    id: 'conn-ob-f1-a1',
    accountCode: 'VW-1048',
    customerName: 'Floor 1 Room A1 Tenant',
    premiseAddress: 'Old Building, Floor 1, Room A1',
    zone: SupplyZone.OldBuilding,
    category: TariffCategory.Residential,
    meterSerial: 'OB-F1-A1',
    status: ConnectionStatus.Active,
    phone: '0722345002',
    email: 'ob.f1.a1@oldbuilding.ke',
    baseIndexTenthsM3: 13520,
    monthlyTenths: [174, 188, 196, 182, 186, 192],
    octPaymentBehavior: 'full',
    novPaymentBehavior: 'pending',
    paymentMethod: PaymentMethod.Mpesa,
  },
  {
    id: 'conn-ob-f1-a6',
    accountCode: 'VW-1049',
    customerName: 'Floor 1 Room A6 Tenant',
    premiseAddress: 'Old Building, Floor 1, Room A6',
    zone: SupplyZone.OldBuilding,
    category: TariffCategory.Residential,
    meterSerial: 'OB-F1-A6',
    status: ConnectionStatus.Active,
    phone: '0722345006',
    email: 'ob.f1.a6@oldbuilding.ke',
    baseIndexTenthsM3: 9800,
    monthlyTenths: [142, 148, 155, 146, 150, 154],
    octPaymentBehavior: 'full',
    novPaymentBehavior: 'full',
    paymentMethod: PaymentMethod.Mpesa,
  },
  {
    id: 'conn-ob-f2-b1',
    accountCode: 'VW-1050',
    customerName: 'Floor 2 Room B1 Tenant',
    premiseAddress: 'Old Building, Floor 2, Room B1',
    zone: SupplyZone.OldBuilding,
    category: TariffCategory.Residential,
    meterSerial: 'OB-F2-B1',
    status: ConnectionStatus.Active,
    phone: '0722345010',
    email: 'ob.f2.b1@oldbuilding.ke',
    baseIndexTenthsM3: 11200,
    monthlyTenths: [160, 168, 172, 165, 169, 175],
    octPaymentBehavior: 'full',
    novPaymentBehavior: 'full',
    paymentMethod: PaymentMethod.Mpesa,
  },
  {
    id: 'conn-103',
    accountCode: 'VW-1055',
    customerName: 'Heavy Consumer F1 (Harbor Cold Storage)',
    premiseAddress: 'Heavy Consumer Zone, Main Feeder F1',
    zone: SupplyZone.HeavyConsumer,
    category: TariffCategory.HeavyClients,
    meterSerial: 'HM-F1',
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
    id: 'conn-104',
    accountCode: 'VW-1061',
    customerName: 'Heavy Consumer F2 (Crestline Linen)',
    premiseAddress: 'Heavy Consumer Zone, Main Feeder F2',
    zone: SupplyZone.HeavyConsumer,
    category: TariffCategory.HeavyClients,
    meterSerial: 'HM-F2',
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
  // New Building Floor 1 Rooms A1 to A10
  {
    id: 'conn-nb-f1-a1',
    accountCode: 'VW-1101',
    customerName: 'Floor 1 Room A1 Tenant',
    premiseAddress: 'New Building, Floor 1, Room A1',
    zone: SupplyZone.NewBuilding,
    category: TariffCategory.Residential,
    meterSerial: 'NB-F1-A1',
    status: ConnectionStatus.Active,
    phone: '0712001001',
    email: 'f1.a1@newbuilding.ke',
    baseIndexTenthsM3: 1200,
    monthlyTenths: [95, 102, 110, 98, 104, 108],
    octPaymentBehavior: 'full',
    novPaymentBehavior: 'full',
    paymentMethod: PaymentMethod.Mpesa,
  },
  {
    id: 'conn-nb-f1-a2',
    accountCode: 'VW-1102',
    customerName: 'Floor 1 Room A2 Tenant',
    premiseAddress: 'New Building, Floor 1, Room A2',
    zone: SupplyZone.NewBuilding,
    category: TariffCategory.Residential,
    meterSerial: 'NB-F1-A2',
    status: ConnectionStatus.Active,
    phone: '0712001002',
    email: 'f1.a2@newbuilding.ke',
    baseIndexTenthsM3: 1450,
    monthlyTenths: [112, 118, 125, 119, 122, 128],
    octPaymentBehavior: 'full',
    novPaymentBehavior: 'pending',
    paymentMethod: PaymentMethod.Mpesa,
  },
  {
    id: 'conn-nb-f1-a3',
    accountCode: 'VW-1103',
    customerName: 'Floor 1 Room A3 Tenant',
    premiseAddress: 'New Building, Floor 1, Room A3',
    zone: SupplyZone.NewBuilding,
    category: TariffCategory.Residential,
    meterSerial: 'NB-F1-A3',
    status: ConnectionStatus.Active,
    phone: '0712001003',
    email: 'f1.a3@newbuilding.ke',
    baseIndexTenthsM3: 980,
    monthlyTenths: [88, 92, 95, 90, 94, 96],
    octPaymentBehavior: 'full',
    novPaymentBehavior: 'full',
    paymentMethod: PaymentMethod.Mpesa,
  },
  {
    id: 'conn-nb-f1-a4',
    accountCode: 'VW-1104',
    customerName: 'Floor 1 Room A4 Tenant',
    premiseAddress: 'New Building, Floor 1, Room A4',
    zone: SupplyZone.NewBuilding,
    category: TariffCategory.Residential,
    meterSerial: 'NB-F1-A4',
    status: ConnectionStatus.Active,
    phone: '0712001004',
    email: 'f1.a4@newbuilding.ke',
    baseIndexTenthsM3: 1600,
    monthlyTenths: [130, 136, 142, 138, 140, 145],
    octPaymentBehavior: 'full',
    novPaymentBehavior: 'full',
    paymentMethod: PaymentMethod.Mpesa,
  },
  {
    id: 'conn-nb-f1-a5',
    accountCode: 'VW-1105',
    customerName: 'Floor 1 Room A5 Tenant',
    premiseAddress: 'New Building, Floor 1, Room A5',
    zone: SupplyZone.NewBuilding,
    category: TariffCategory.Residential,
    meterSerial: 'NB-F1-A5',
    status: ConnectionStatus.Active,
    phone: '0712001005',
    email: 'f1.a5@newbuilding.ke',
    baseIndexTenthsM3: 840,
    monthlyTenths: [74, 80, 85, 78, 82, 84],
    octPaymentBehavior: 'full',
    novPaymentBehavior: 'full',
    paymentMethod: PaymentMethod.Mpesa,
  },
  {
    id: 'conn-nb-f1-a6',
    accountCode: 'VW-1106',
    customerName: 'Floor 1 Room A6 Tenant',
    premiseAddress: 'New Building, Floor 1, Room A6',
    zone: SupplyZone.NewBuilding,
    category: TariffCategory.Residential,
    meterSerial: 'NB-F1-A6',
    status: ConnectionStatus.Active,
    phone: '0712001006',
    email: 'f1.a6@newbuilding.ke',
    baseIndexTenthsM3: 1110,
    monthlyTenths: [102, 108, 114, 106, 110, 115],
    octPaymentBehavior: 'unpaid',
    novPaymentBehavior: 'pending',
    paymentMethod: PaymentMethod.Mpesa,
  },
  {
    id: 'conn-nb-f1-a7',
    accountCode: 'VW-1107',
    customerName: 'Floor 1 Room A7 Tenant',
    premiseAddress: 'New Building, Floor 1, Room A7',
    zone: SupplyZone.NewBuilding,
    category: TariffCategory.Residential,
    meterSerial: 'NB-F1-A7',
    status: ConnectionStatus.Active,
    phone: '0712001007',
    email: 'f1.a7@newbuilding.ke',
    baseIndexTenthsM3: 1330,
    monthlyTenths: [120, 126, 131, 124, 128, 132],
    octPaymentBehavior: 'full',
    novPaymentBehavior: 'full',
    paymentMethod: PaymentMethod.Mpesa,
  },
  {
    id: 'conn-nb-f1-a8',
    accountCode: 'VW-1108',
    customerName: 'Floor 1 Room A8 Tenant',
    premiseAddress: 'New Building, Floor 1, Room A8',
    zone: SupplyZone.NewBuilding,
    category: TariffCategory.Residential,
    meterSerial: 'NB-F1-A8',
    status: ConnectionStatus.Active,
    phone: '0712001008',
    email: 'f1.a8@newbuilding.ke',
    baseIndexTenthsM3: 1720,
    monthlyTenths: [145, 150, 158, 149, 154, 160],
    octPaymentBehavior: 'full',
    novPaymentBehavior: 'full',
    paymentMethod: PaymentMethod.Mpesa,
  },
  {
    id: 'conn-nb-f1-a9',
    accountCode: 'VW-1109',
    customerName: 'Floor 1 Room A9 Tenant',
    premiseAddress: 'New Building, Floor 1, Room A9',
    zone: SupplyZone.NewBuilding,
    category: TariffCategory.Residential,
    meterSerial: 'NB-F1-A9',
    status: ConnectionStatus.Active,
    phone: '0712001009',
    email: 'f1.a9@newbuilding.ke',
    baseIndexTenthsM3: 920,
    monthlyTenths: [82, 88, 92, 86, 90, 93],
    octPaymentBehavior: 'full',
    novPaymentBehavior: 'full',
    paymentMethod: PaymentMethod.Mpesa,
  },
  {
    id: 'conn-nb-f1-a10',
    accountCode: 'VW-1110',
    customerName: 'Floor 1 Room A10 Tenant',
    premiseAddress: 'New Building, Floor 1, Room A10',
    zone: SupplyZone.NewBuilding,
    category: TariffCategory.Residential,
    meterSerial: 'NB-F1-A10',
    status: ConnectionStatus.Active,
    phone: '0712001010',
    email: 'f1.a10@newbuilding.ke',
    baseIndexTenthsM3: 1250,
    monthlyTenths: [110, 116, 122, 114, 118, 124],
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
        });
      }
    });

    connections.push({
      id: spec.id,
      accountCode: spec.accountCode,
      customerName,
      premiseAddress: spec.premiseAddress,
      zone: spec.zone,
      category: spec.category,
      meterSerial: spec.meterSerial,
      status: spec.status,
      phone: spec.phone,
      email: spec.email,
      lastReadingTenthsM3: runningIndexTenths,
      lastReadCycle,
    });
  });

  return {
    version: 1,
    connections,
    readings,
    invoices,
    payments,
    tariffs: structuredClone(DEFAULT_TARIFFS),
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
      return parsed as BillingStoreState;
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
