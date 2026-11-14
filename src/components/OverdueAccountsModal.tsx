import React, { useMemo, useState } from 'react';
import { PaybillSettings, WaterConnection, WaterInvoice } from '../types/billing';
import {
  buildWhatsAppUrl,
  DEFAULT_PAYBILL_NUMBER,
  formatCents,
  formatLocalDate,
} from '../lib/billingMath';
import { getOverdueAccounts, OverdueAccountSummary } from '../lib/overdueAccounts';
import { Button, ModalDialog } from './ui';
import { Check, ExternalLink, Mail, MessageSquare, Send } from 'lucide-react';

export type OverdueDispatchChannel = 'EMAIL' | 'SMS' | 'BOTH' | 'WHATSAPP';

export interface OverdueNotificationPayload {
  connectionId: string;
  customerName: string;
  accountCode: string;
  channel: OverdueDispatchChannel;
  contact: string;
  balanceCents: number;
  invoiceCount: number;
}

export interface OverdueAccountsModalProps {
  open: boolean;
  onClose: () => void;
  connections: WaterConnection[];
  invoices: WaterInvoice[];
  paybill?: PaybillSettings;
  onTriggerNotification: (opts: OverdueNotificationPayload) => void;
  onBatchTriggerNotification?: (notifications: OverdueNotificationPayload[]) => void;
  onOpenInvoice?: (invoiceId: string) => void;
}

export function OverdueAccountsModal({
  open,
  onClose,
  connections,
  invoices,
  paybill,
  onTriggerNotification,
  onBatchTriggerNotification,
}: OverdueAccountsModalProps) {
  const [selectedChannel, setSelectedChannel] = useState<OverdueDispatchChannel>('BOTH');
  const [notifiedAccountIds, setNotifiedAccountIds] = useState<Set<string>>(new Set());

  // Aggregate flagged overdue accounts
  const overdueAccounts = useMemo(() => {
    return getOverdueAccounts(connections, invoices);
  }, [connections, invoices]);

  const totalOutstandingCents = useMemo(() => {
    return overdueAccounts.reduce((sum, item) => sum + item.totalOverdueBalanceCents, 0);
  }, [overdueAccounts]);

  const getContactForChannel = (
    account: OverdueAccountSummary,
    channel: OverdueDispatchChannel
  ) => {
    if (channel === 'EMAIL') return account.connection.email;
    if (channel === 'SMS' || channel === 'WHATSAPP') return account.connection.phone;
    return `${account.connection.email} & ${account.connection.phone}`;
  };

  const buildOverdueWaMessage = (account: OverdueAccountSummary) => {
    const activePaybill = paybill?.primaryPaybill?.trim() || DEFAULT_PAYBILL_NUMBER;
    const accountLabel = paybill?.accountLabel?.trim() || 'Account';
    return `Dear ${account.connection.customerName},

URGENT ARREARS NOTICE — MajiTrack (Gawanji Heights Apartments)
• Account Code: ${account.connection.accountCode}
• Premise: ${account.connection.premiseAddress}
• Overdue Bills: ${account.overdueCount} (Earliest due ${formatLocalDate(account.oldestDueDate)})
• Total Overdue Balance: ${formatCents(account.totalOverdueBalanceCents)}

Please pay via Lipa na M-Pesa Paybill ${activePaybill}, ${accountLabel} ${account.connection.accountCode}.

Thank you,
MajiTrack Water Billing`;
  };

  const handleSendSingle = (account: OverdueAccountSummary) => {
    onTriggerNotification({
      connectionId: account.connection.id,
      customerName: account.connection.customerName,
      accountCode: account.connection.accountCode,
      channel: selectedChannel,
      contact: getContactForChannel(account, selectedChannel),
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
          accountCode: account.connection.accountCode,
          channel: selectedChannel,
          contact: getContactForChannel(account, selectedChannel),
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
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-caption font-semibold uppercase tracking-wider text-muted">
              Dispatch channel:
            </span>
            <div
              role="group"
              aria-label="Notification delivery channel"
              className="inline-flex flex-wrap rounded-control border border-border/45 bg-background p-0.5"
            >
              {(
                [
                  { id: 'BOTH', label: 'Email & SMS' },
                  { id: 'WHATSAPP', label: 'WhatsApp only' },
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
                      ? ch.id === 'WHATSAPP'
                        ? 'bg-[#25D366] text-white shadow-surface'
                        : 'bg-surface text-foreground shadow-surface'
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
                ? 'All notifications logged'
                : selectedChannel === 'WHATSAPP'
                ? `Log all WhatsApp (${overdueAccounts.length})`
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
                  <th className="px-4 py-2.5">Contact</th>
                  <th className="px-4 py-2.5 text-right">Overdue Invoices</th>
                  <th className="px-4 py-2.5 text-right">Total Balance</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30 text-body">
                {overdueAccounts.map((item) => {
                  const isNotified = notifiedAccountIds.has(item.connection.id);
                  const waUrl = buildWhatsAppUrl(
                    item.connection.phone,
                    buildOverdueWaMessage(item)
                  );

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

                      {/* Contact Info */}
                      <td className="px-4 py-3 text-caption">
                        <div
                          className="text-foreground truncate max-w-44"
                          title={`${item.connection.email} · ${item.connection.phone}`}
                        >
                          {selectedChannel === 'SMS' || selectedChannel === 'WHATSAPP'
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
                        {selectedChannel === 'WHATSAPP' && !isNotified ? (
                          <a
                            href={waUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => handleSendSingle(item)}
                            className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-control bg-[#25D366] px-3 text-caption font-semibold text-white shadow-xs transition-all hover:brightness-105 focus-visible:outline-2 focus-visible:outline-[#25D366]"
                            title={`Send WhatsApp-only arrears notice to ${item.connection.customerName}`}
                          >
                            <MessageSquare className="size-3.5 fill-current" />
                            <span>WhatsApp</span>
                            <ExternalLink className="size-3" />
                          </a>
                        ) : (
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
                                Notice logged
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
                        )}
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
            All dispatched reminders are automatically recorded in the Invoices & Ledger notification history.
          </p>
          <Button tone="quiet" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </ModalDialog>
  );
}
