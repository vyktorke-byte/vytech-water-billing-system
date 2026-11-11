export enum TariffCategory {
  Residential = 'Residents',
  HeavyClients = 'Heavy Clients',
}

export enum SupplyZone {
  OldBuilding = 'Old Building',
  NewBuilding = 'New Building',
  HeavyConsumer = 'Heavy Consumer',
}

export enum ConnectionStatus {
  Active = 'Active',
  Suspended = 'Suspended',
}

export enum InvoiceStatus {
  Paid = 'Paid',
  Pending = 'Pending',
  Overdue = 'Overdue',
}

export enum PaymentMethod {
  Mpesa = 'M-Pesa',
  BankTransfer = 'Bank transfer',
  Card = 'Card terminal',
  DirectDebit = 'Direct debit',
  Cashier = 'Counter receipt',
}

export type BillingCycleId =
  | '2026-06'
  | '2026-07'
  | '2026-08'
  | '2026-09'
  | '2026-10'
  | '2026-11';

export type PeriodFilterId = '2026-11' | '2026-10' | 'Q3-2026' | '6M';

export interface BillingCycleMeta {
  id: BillingCycleId;
  label: string;
  shortLabel: string;
  dueDate: { year: number; month: number; day: number };
  issueDate: { year: number; month: number; day: number };
}

export interface TariffSchedule {
  category: TariffCategory;
  /** Fixed flat rate in KSh per cubic meter (e.g. 150 for Residents, 180 for Heavy Clients) */
  ratePerM3: number;
  /** Sewerage & wastewater surcharge as percentage (0% if none) */
  seweragePercent: number;
}

export interface WaterConnection {
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
  /** Latest confirmed meter index in tenths of m³ (deciliters of m³, i.e. 14284 = 1,428.4 m³) */
  lastReadingTenthsM3: number;
  lastReadCycle: BillingCycleId;
}

export interface MeterReading {
  id: string;
  connectionId: string;
  cycleId: BillingCycleId;
  readDate: { year: number; month: number; day: number };
  /** Meter index before this cycle in tenths of m³ */
  previousTenthsM3: number;
  /** Meter index recorded for this cycle in tenths of m³ */
  currentTenthsM3: number;
  /** Consumption in tenths of m³ (current - previous) */
  consumptionTenthsM3: number;
  readerInitials: string;
  anomalyNote?: string;
  isSpikeFlagged: boolean;
}

export interface PaymentRecord {
  id: string;
  invoiceId: string;
  paidDate: { year: number; month: number; day: number };
  amountKsh: number;
  method: PaymentMethod;
  reference: string;
}

export interface WaterInvoice {
  id: string;
  invoiceNumber: string;
  connectionId: string;
  cycleId: BillingCycleId;
  readingId: string;
  issueDate: { year: number; month: number; day: number };
  dueDate: { year: number; month: number; day: number };
  previousTenthsM3: number;
  currentTenthsM3: number;
  consumptionTenthsM3: number;
  ratePerM3: number;
  volumetricKsh: number;
  sewerageKsh: number;
  arrearsBroughtForwardKsh: number;
  /** Total billed for this cycle (volumetric + sewerage) excluding prior arrears */
  cycleChargesKsh: number;
  /** Total payable including brought-forward arrears */
  totalPayableKsh: number;
  amountPaidKsh: number;
  status: InvoiceStatus;
}

export interface BillingStoreState {
  version: number;
  connections: WaterConnection[];
  readings: MeterReading[];
  invoices: WaterInvoice[];
  payments: PaymentRecord[];
  tariffs: Record<TariffCategory, TariffSchedule>;
}

export type AppView = 'overview' | 'invoices' | 'readings' | 'accounts' | 'tariffs';

export interface StatusNotice {
  id: string;
  message: string;
  undoLabel?: string;
  onUndo?: () => void;
}
