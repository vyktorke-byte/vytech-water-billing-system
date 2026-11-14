export enum TariffCategory {
  Residential = 'Residents',
  HeavyClients = 'Heavy Clients',
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
  MpesaPaybill = 'M-Pesa Paybill',
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
  /** Attached photo data URL of the physical meter dial for visual proof */
  photoUrl?: string;
}

export type PaymentStatus = 'Completed' | 'Pending' | 'Failed';

export interface PaymentRecord {
  id: string;
  invoiceId: string;
  paidDate: { year: number; month: number; day: number };
  amountKsh: number;
  method: PaymentMethod;
  reference: string;
  status?: PaymentStatus;
  connectionId?: string;
  accountCode?: string;
  billRefNumber?: string;
  msisdn?: string;
  shortCode?: string;
}

export interface MpesaC2BTransaction {
  id: string;
  transId: string;
  transTime: string;
  transAmount: number;
  businessShortCode: string;
  billRefNumber: string;
  msisdn: string;
  customerName: string;
  connectionId?: string;
  accountCode?: string;
  matchedInvoiceIds: string[];
  appliedAmountKsh: number;
  unallocatedKsh: number;
  status: 'Completed' | 'Unmatched' | 'Failed';
  receivedAt: string;
  reconciled?: boolean;
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

export type NotificationChannel = 'SMS' | 'EMAIL' | 'WHATSAPP';

export type NotificationStatus = 'Delivered' | 'Sent' | 'Pending' | 'Failed';

export interface NotificationLog {
  id: string;
  connectionId: string;
  customerName: string;
  accountCode: string;
  invoiceId?: string;
  invoiceNumber?: string;
  channel: NotificationChannel;
  recipient: string;
  messageSummary: string;
  status: NotificationStatus;
  sentDate: { year: number; month: number; day: number };
  sentTime: string;
  dispatchedBy: string;
}

export interface PaybillSettings {
  primaryPaybill: string;
  alternatePaybill?: string;
  businessName: string;
  accountLabel: string;
}

export interface BillingStoreState {
  version: number;
  connections: WaterConnection[];
  readings: MeterReading[];
  invoices: WaterInvoice[];
  payments: PaymentRecord[];
  tariffs: Record<TariffCategory, TariffSchedule>;
  notifications: NotificationLog[];
  mpesaTransactions?: MpesaC2BTransaction[];
  paybill?: PaybillSettings;
}

export type AppView = 'overview' | 'invoices' | 'readings' | 'accounts' | 'tariffs' | 'admin';

export type UserRole = 'superadmin' | 'admin' | 'operator';

export interface StaffAccessEntry {
  email: string;
  role: UserRole;
  displayName: string;
  assignedByEmail: string;
}

export interface OperatorProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: UserRole;
}

export interface StatusNotice {
  id: string;
  message: string;
  undoLabel?: string;
  onUndo?: () => void;
}
