import { InvoiceStatus, WaterConnection, WaterInvoice } from '../types/billing';

export interface OverdueAccountSummary {
  connection: WaterConnection;
  /** List of all overdue invoices for this connection */
  overdueInvoices: WaterInvoice[];
  /** Total outstanding balance across all overdue invoices */
  totalOverdueBalanceCents: number;
  /** Oldest due date among the overdue invoices */
  oldestDueDate: { year: number; month: number; day: number };
  /** Total number of overdue invoices */
  overdueCount: number;
}

/**
 * Flags and aggregates all accounts with overdue invoices.
 * Calculates total overdue balance in integer cents and identifies the overdue invoices.
 */
export function getOverdueAccounts(
  connections: WaterConnection[],
  invoices: WaterInvoice[]
): OverdueAccountSummary[] {
  const overdueMap = new Map<string, WaterInvoice[]>();

  for (const inv of invoices) {
    if (inv.status === InvoiceStatus.Overdue) {
      const balance = inv.totalPayableKsh - inv.amountPaidKsh;
      if (balance > 0) {
        const arr = overdueMap.get(inv.connectionId) || [];
        arr.push(inv);
        overdueMap.set(inv.connectionId, arr);
      }
    }
  }

  const results: OverdueAccountSummary[] = [];

  for (const conn of connections) {
    const list = overdueMap.get(conn.id);
    if (list && list.length > 0) {
      // Sort oldest due date first
      list.sort((a, b) => {
        const aVal = a.dueDate.year * 10000 + a.dueDate.month * 100 + a.dueDate.day;
        const bVal = b.dueDate.year * 10000 + b.dueDate.month * 100 + b.dueDate.day;
        return aVal - bVal;
      });

      const totalOverdueBalanceCents = list.reduce(
        (sum, inv) => sum + Math.max(0, inv.totalPayableKsh - inv.amountPaidKsh),
        0
      );

      results.push({
        connection: conn,
        overdueInvoices: list,
        totalOverdueBalanceCents,
        oldestDueDate: list[0].dueDate,
        overdueCount: list.length,
      });
    }
  }

  // Sort by highest overdue balance descending
  results.sort((a, b) => b.totalOverdueBalanceCents - a.totalOverdueBalanceCents);

  return results;
}
