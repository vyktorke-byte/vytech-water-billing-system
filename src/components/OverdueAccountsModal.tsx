import React, { useMemo, useState } from 'react';
import { WaterConnection, WaterInvoice } from '../types/billing';
import { formatCents, formatLocalDate } from '../lib/billingMath';
import { getOverdueAccounts, OverdueAccountSummary } from '../lib/overdueAccounts';
import { Button, ModalDialog, Surface } from './ui';
import { AlertCircle, Check, Mail, MessageSquare, Send } from 'lucide-react';

export interface OverdueAccountsModalProps {
  open: boolean;
  onClose: () => void;
  connections: WaterConnection[];
  invoices: WaterInvoice[];
  onTriggerNotification: (opts: {
    connectionId: string;
    customerName: string;
    channel: 'EMAIL' | 'SMS' | 'BOTH';
    contact: string;
    balanceCents: number;
    invoiceCount: number;
  }) => void;
  onBatchTriggerNotification?: (notifications: {
    connectionId: string;
    customerName: string;
    channel: 'EMAIL' | 'SMS' | 'BOTH';
    contact: string;
    balanceCents: number;
    invoiceCount: number;
  }[]) => void;
  onOpenInvoice?: (invoiceId: string) => void;
}

export function OverdueAccountsModal({
  open,
  onClose,
  connections,
  invoices,
  onTriggerNotification,
  onBatchTriggerNotification,
  onOpenInvoice,
}: OverdueAccountsModalProps) {
  const [selectedChannel, setSelectedChannel] = useState<'BOTH' | 'EMAIL' | 'SMS'>('BOTH');
  const [notifiedAccountIds, setNotifiedAccountIds] = useState<Set<string>>(new Set());

  // Aggregate flagged overdue accounts
  const overdueAccounts = useMemo(() => {
    return getOverdueAccounts(connections, invoices);
  }, [connections, invoices]);

  const totalOutstandingCents = useMemo(() => {
    return overdueAccounts.reduce((sum, item) => sum + item.totalOverdueBalanceCents, 0);
  }, [overdueAccounts]);

  const handleSendSingle = (account: OverdueAccountSummary) => {
    const contact =
      selectedChannel === 'EMAIL'
        ? account.connection.email
        : selectedChannel === 'SMS'
        ? account.connection.phone
        : `${account.connection.email} & ${account.connection.phone}`;

    onTriggerNotification({
      connectionId: account.connection.id,
      customerName: account.connection.customerName,
      channel: selectedChannel,
      contact,
      balanceCents: account.totalOverdueBalanceCents,
      invoiceCount: account.overdueCount,
    });

    setNotifiedAccountIds((prev) => new Set(prev).add(account.connection.id));
  };

  const handleSendAll = () => {
    const pendingList = overdueAccounts.filter(
      (a) => !notifiedAccountIds.has(a.connection.id)
    );
    if (pendingList.length === 0) return;

    if (onBatchTriggerNotification) {
      onBatchTriggerNotification(
        pendingList.map((account) => ({
          connectionId: account.connection.id,
          customerName: account.connection.customerName,
          channel: selectedChannel,
          contact:
            selectedChannel === 'EMAIL'
              ? account.connection.email
              : selectedChannel === 'SMS'
              ? account.connection.phone
              : `${account.connection.email} & ${account.connection.phone}`,
          balanceCents: account.totalOverdueBalanceCents,
          invoiceCount: account.overdueCount,
        }))
      );
    } else {
      for (const account of pendingList) {
        handleSendSingle(account);
      }
    }

    setNotifiedAccountIds(new Set(overdueAccounts.map((a) => a.connection.id)));
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Overdue Accounts & Collections Utility"
      subtitle={`Flagged ${overdueAccounts.length} customer accounts with outstanding overdue water invoices (${formatCents(
        totalOutstandingCents
      )} total arrears)`}
      maxWidthClass="max-w-3xl"
    >
      <div className="space-y-4">
        {/* Controls Bar: Channel Toggle and Send All */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/35 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-caption font-semibold uppercase tracking-wider text-muted">
              Dispatch channel:
            </span>
            <div
              role="group"
              aria-label="Notification delivery channel"
              className="inline-flex rounded-control border border-border/45 bg-background p-0.5"
            >
              {(
                [
                  { id: 'BOTH', label: 'Email & SMS' },
                  { id: 'EMAIL', label: 'Email only' },
                  { id: 'SMS', label: 'SMS only' },
                ] as const
              ).map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => setSelectedChannel(ch.id)}
                  className={`min-h-7 cursor-pointer whitespace-nowrap rounded-control px-2.5 text-caption font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
                    selectedChannel === ch.id
                      ? 'bg-surface text-foreground shadow-surface'
                      : 'text-muted hover:text-foreground'
                  }`}
                >
                  {ch.label}
                </button>
              ))}
            </div>
          </div>

          {overdueAccounts.length > 0 && (
            <Button
              tone="primary"
              size="sm"
              onClick={handleSendAll}
              disabled={notifiedAccountIds.size >= overdueAccounts.length}
            >
              <Send className="size-3.5" />
              {notifiedAccountIds.size >= overdueAccounts.length
                ? 'All notifications dispatched'
                : `Dispatch notice to all (${overdueAccounts.length})`}
            </Button>
          )}
        </div>

        {/* Flagged Accounts Table */}
        {overdueAccounts.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-section text-foreground">No accounts are currently overdue</p>
            <p className="mt-1 text-caption text-muted">
              All active customer accounts are fully paid or within their standard payment terms.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-control border border-border/35">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border/35 text-caption font-semibold uppercase tracking-wider text-muted">
                  <th className="px-4 py-2.5">Customer / Account</th>
                  <th className="px-4 py-2.5">Zone & Contact</th>
                  <th className="px-4 py-2.5 text-right">Overdue Invoices</th>
                  <th className="px-4 py-2.5 text-right">Total Balance</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30 text-body">
                {overdueAccounts.map((item) => {
                  const isNotified = notifiedAccountIds.has(item.connection.id);

                  return (
                    <tr
                      key={item.connection.id}
                      className="transition-colors hover:bg-background/60"
                    >
                      {/* Customer / Account */}
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">
                          {item.connection.customerName}
                        </div>
                        <div className="text-caption text-muted font-mono">
                          {item.connection.accountCode} · Meter {item.connection.meterSerial}
                        </div>
                      </td>

                      {/* Zone & Contact Info */}
                      <td className="px-4 py-3 text-caption">
                        <div className="text-foreground">{item.connection.zone}</div>
                        <div className="text-muted truncate max-w-44" title={`${item.connection.email} · ${item.connection.phone}`}>
                          {selectedChannel === 'SMS'
                            ? item.connection.phone
                            : selectedChannel === 'EMAIL'
                            ? item.connection.email
                            : `${item.connection.phone} · ${item.connection.email}`}
                        </div>
                      </td>

                      {/* Overdue Invoices Breakdown */}
                      <td className="px-4 py-3 text-right">
                        <div className="font-medium text-danger tabular-nums text-caption">
                          {item.overdueCount} {item.overdueCount === 1 ? 'invoice' : 'invoices'}
                        </div>
                        <div className="text-caption text-muted">
                          Earliest due {formatLocalDate(item.oldestDueDate, false)}
                        </div>
                      </td>

                      {/* Total Arrears Balance */}
                      <td className="px-4 py-3 text-right tabular-nums">
                        <div className="font-semibold text-danger">
                          {formatCents(item.totalOverdueBalanceCents)}
                        </div>
                        <div className="text-caption text-muted">arrears</div>
                      </td>

                      {/* Trigger Notification Button */}
                      <td className="px-4 py-3 text-right">
                        <Button
                          tone={isNotified ? 'quiet' : 'danger'}
                          size="sm"
                          onClick={() => handleSendSingle(item)}
                          disabled={isNotified}
                          title={`Send ${selectedChannel} overdue reminder to ${item.connection.customerName}`}
                        >
                          {isNotified ? (
                            <>
                              <Check className="size-3.5 text-accent" />
                              Notice sent
                            </>
                          ) : (
                            <>
                              {selectedChannel === 'EMAIL' ? (
                                <Mail className="size-3.5" />
                              ) : selectedChannel === 'SMS' ? (
                                <MessageSquare className="size-3.5" />
                              ) : (
                                <Send className="size-3.5" />
                              )}
                              Send notice
                            </>
                          )}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <p className="text-caption text-muted">
            Notifications include the total outstanding balance, invoice IDs, and electronic payment links.
          </p>
          <Button tone="quiet" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </ModalDialog>
  );
}
