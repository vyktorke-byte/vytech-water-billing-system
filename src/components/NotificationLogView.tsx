import React, { useMemo, useState } from 'react';
import {
  BillingStoreState,
  NotificationChannel,
  NotificationLog,
  NotificationStatus,
  PaybillSettings,
} from '../types/billing';
import {
  buildWhatsAppUrl,
  DEFAULT_PAYBILL_NUMBER,
  formatCents,
  formatLocalDate,
  formatTenthsM3,
  formatWhatsAppPhone,
} from '../lib/billingMath';
import { downloadCustomerInvoicePdf } from '../lib/invoicePdf';
import { Button, ModalDialog, SelectField, Surface } from './ui';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  Mail,
  MessageSquare,
  Search,
  Send,
  Smartphone,
} from 'lucide-react';

interface NotificationLogViewProps {
  state: BillingStoreState;
  onLogNotification: (entry: {
    connectionId: string;
    customerName: string;
    accountCode: string;
    invoiceId?: string;
    invoiceNumber?: string;
    channel: NotificationChannel;
    recipient: string;
    messageSummary: string;
    status?: NotificationStatus;
  }) => void;
  onOpenInvoice?: (invoiceId: string) => void;
}

type ChannelFilter = 'ALL' | NotificationChannel;
type StatusFilter = 'ALL' | NotificationStatus;
type WhatsAppTemplateId = 'balance' | 'overdue' | 'statement' | 'custom';

function buildTemplateMessage(opts: {
  template: WhatsAppTemplateId;
  customerName: string;
  accountCode: string;
  premiseAddress: string;
  invoiceNumber?: string;
  cycleId?: string;
  balanceDueKsh?: number;
  totalPayableKsh?: number;
  consumptionTenthsM3?: number;
  dueDateLabel?: string;
  paybill?: PaybillSettings;
}): string {
  const {
    template,
    customerName,
    accountCode,
    premiseAddress,
    invoiceNumber,
    cycleId,
    balanceDueKsh = 0,
    totalPayableKsh = 0,
    consumptionTenthsM3,
    dueDateLabel,
    paybill,
  } = opts;
  const activePaybill = paybill?.primaryPaybill?.trim() || DEFAULT_PAYBILL_NUMBER;
  const accountLabel = paybill?.accountLabel?.trim() || 'Account';

  if (template === 'overdue') {
    return `Dear ${customerName},

URGENT WATER BILL REMINDER — MajiTrack (Gawanji Heights Apartments)
• Account Code: ${accountCode} (${premiseAddress})${
      invoiceNumber ? `\n• Invoice: ${invoiceNumber} (${cycleId ?? 'Current'})` : ''
    }
• Outstanding Overdue Balance: ${formatCents(balanceDueKsh)}

Please settle via Lipa na M-Pesa Paybill ${activePaybill}, ${accountLabel} ${accountCode} to avoid supply interruption.

Thank you,
MajiTrack Water Billing`;
  }

  if (template === 'statement') {
    return `Dear ${customerName},

Your water utility statement from MajiTrack (Gawanji Heights Apartments) is ready:
• Account Code: ${accountCode}${
      invoiceNumber ? `\n• Invoice Number: ${invoiceNumber} (${cycleId ?? 'Current'})` : ''
    }${
      typeof consumptionTenthsM3 === 'number'
        ? `\n• Billed Volume: ${formatTenthsM3(consumptionTenthsM3)}`
        : ''
    }
• Total Billed: ${formatCents(totalPayableKsh)}
• Balance Due: ${formatCents(balanceDueKsh)}${
      dueDateLabel ? `\n• Due Date: ${dueDateLabel}` : ''
    }

Paybill: ${activePaybill} · ${accountLabel}: ${accountCode}

MajiTrack Water Billing · majitracksystembilling.net`;
  }

  if (template === 'custom') {
    return `Dear ${customerName} (${accountCode}), `;
  }

  return `Dear ${customerName},

Friendly payment reminder from MajiTrack (Gawanji Heights Apartments):
• Account: ${accountCode} (${premiseAddress})${
    invoiceNumber ? `\n• Statement: ${invoiceNumber}` : ''
  }
• Balance Due: ${formatCents(balanceDueKsh)}${
    dueDateLabel ? ` (Due ${dueDateLabel})` : ''
  }

Pay via M-Pesa Paybill ${activePaybill}, ${accountLabel} ${accountCode}.

Thank you.`;
}

export function NotificationLogView({
  state,
  onLogNotification,
  onOpenInvoice,
}: NotificationLogViewProps) {
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // WhatsApp-Only Composer Modal State
  const [waModalOpen, setWaModalOpen] = useState(false);
  const [selectedConnId, setSelectedConnId] = useState<string>('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>('');
  const [selectedTemplate, setSelectedTemplate] = useState<WhatsAppTemplateId>('balance');
  const [customMessage, setCustomMessage] = useState('');

  const connMap = useMemo(
    () => new Map(state.connections.map((c) => [c.id, c])),
    [state.connections]
  );

  const notifications = state.notifications ?? [];

  const counts = useMemo(() => {
    let whatsapp = 0;
    let sms = 0;
    let email = 0;
    let deliveredOrSent = 0;
    let failedOrPending = 0;

    for (const n of notifications) {
      if (n.channel === 'WHATSAPP') whatsapp += 1;
      else if (n.channel === 'SMS') sms += 1;
      else if (n.channel === 'EMAIL') email += 1;

      if (n.status === 'Delivered' || n.status === 'Sent') deliveredOrSent += 1;
      else failedOrPending += 1;
    }

    return {
      all: notifications.length,
      whatsapp,
      sms,
      email,
      deliveredOrSent,
      failedOrPending,
    };
  }, [notifications]);

  const filteredNotifications = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return notifications
      .filter((n) => {
        if (channelFilter !== 'ALL' && n.channel !== channelFilter) return false;
        if (statusFilter !== 'ALL' && n.status !== statusFilter) return false;
        if (q) {
          const hay = `${n.customerName} ${n.accountCode} ${n.recipient} ${n.invoiceNumber ?? ''} ${n.messageSummary} ${n.channel} ${n.status} ${n.dispatchedBy}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const scoreA = a.sentDate.year * 10000 + a.sentDate.month * 100 + a.sentDate.day;
        const scoreB = b.sentDate.year * 10000 + b.sentDate.month * 100 + b.sentDate.day;
        if (scoreA !== scoreB) return scoreB - scoreA;
        return b.sentTime.localeCompare(a.sentTime);
      });
  }, [notifications, channelFilter, statusFilter, searchQuery]);

  const openWhatsAppComposer = (opts?: {
    connectionId?: string;
    invoiceId?: string;
    template?: WhatsAppTemplateId;
    initialText?: string;
  }) => {
    const fallbackConn = state.connections[0];
    const targetConnId = opts?.connectionId ?? fallbackConn?.id ?? '';
    const conn = connMap.get(targetConnId) ?? fallbackConn;

    const connInvoices = state.invoices
      .filter((i) => i.connectionId === (conn?.id ?? ''))
      .sort((a, b) => b.cycleId.localeCompare(a.cycleId));
    const preferredInv =
      (opts?.invoiceId ? connInvoices.find((i) => i.id === opts.invoiceId) : undefined) ??
      connInvoices.find((i) => i.totalPayableKsh > i.amountPaidKsh) ??
      connInvoices[0];

    const tpl = opts?.template ?? (preferredInv?.status === 'Overdue' ? 'overdue' : 'balance');

    setSelectedConnId(conn?.id ?? '');
    setSelectedInvoiceId(preferredInv?.id ?? '');
    setSelectedTemplate(tpl);

    if (opts?.initialText) {
      setCustomMessage(opts.initialText);
    } else if (conn) {
      const balanceDueKsh = preferredInv
        ? Math.max(0, preferredInv.totalPayableKsh - preferredInv.amountPaidKsh)
        : 0;
      setCustomMessage(
        buildTemplateMessage({
          template: tpl,
          customerName: conn.customerName,
          accountCode: conn.accountCode,
          premiseAddress: conn.premiseAddress,
          invoiceNumber: preferredInv?.invoiceNumber,
          cycleId: preferredInv?.cycleId,
          balanceDueKsh,
          totalPayableKsh: preferredInv?.totalPayableKsh,
          consumptionTenthsM3: preferredInv?.consumptionTenthsM3,
          dueDateLabel: preferredInv ? formatLocalDate(preferredInv.dueDate) : undefined,
          paybill: state.paybill,
        })
      );
    } else {
      setCustomMessage('');
    }
    setWaModalOpen(true);
  };

  const activeComposeConn = connMap.get(selectedConnId) ?? state.connections[0] ?? null;
  const activeComposeInvoices = useMemo(() => {
    if (!activeComposeConn) return [];
    return state.invoices
      .filter((i) => i.connectionId === activeComposeConn.id)
      .sort((a, b) => b.cycleId.localeCompare(a.cycleId));
  }, [activeComposeConn, state.invoices]);

  const activeComposeInvoice =
    activeComposeInvoices.find((i) => i.id === selectedInvoiceId) ?? activeComposeInvoices[0] ?? null;

  const refreshComposedText = (
    connId: string,
    invoiceId: string,
    template: WhatsAppTemplateId
  ) => {
    const conn = connMap.get(connId);
    if (!conn) return;
    const inv = state.invoices.find((i) => i.id === invoiceId);
    const balanceDueKsh = inv ? Math.max(0, inv.totalPayableKsh - inv.amountPaidKsh) : 0;
    setCustomMessage(
      buildTemplateMessage({
        template,
        customerName: conn.customerName,
        accountCode: conn.accountCode,
        premiseAddress: conn.premiseAddress,
        invoiceNumber: inv?.invoiceNumber,
        cycleId: inv?.cycleId,
        balanceDueKsh,
        totalPayableKsh: inv?.totalPayableKsh,
        consumptionTenthsM3: inv?.consumptionTenthsM3,
        dueDateLabel: inv ? formatLocalDate(inv.dueDate) : undefined,
        paybill: state.paybill,
      })
    );
  };

  const composeWaUrl = activeComposeConn
    ? buildWhatsAppUrl(activeComposeConn.phone, customMessage)
    : '#';

  const handleConfirmWhatsAppSend = () => {
    if (!activeComposeConn) return;
    const summaryText = customMessage.replace(/\s+/g, ' ').trim().slice(0, 260);
    onLogNotification({
      connectionId: activeComposeConn.id,
      customerName: activeComposeConn.customerName,
      accountCode: activeComposeConn.accountCode,
      invoiceId: activeComposeInvoice?.id,
      invoiceNumber: activeComposeInvoice?.invoiceNumber,
      channel: 'WHATSAPP',
      recipient: activeComposeConn.phone,
      messageSummary: summaryText || `WhatsApp message dispatched to ${activeComposeConn.customerName}`,
      status: 'Sent',
    });
    setWaModalOpen(false);
  };

  const buildRowWhatsAppUrl = (row: NotificationLog): string => {
    const conn = connMap.get(row.connectionId);
    const phone = conn?.phone || row.recipient;
    const inv = row.invoiceId ? state.invoices.find((i) => i.id === row.invoiceId) : undefined;
    const balance = inv ? Math.max(0, inv.totalPayableKsh - inv.amountPaidKsh) : 0;
    const activePaybill = state.paybill?.primaryPaybill?.trim() || DEFAULT_PAYBILL_NUMBER;
    const accountLabel = state.paybill?.accountLabel?.trim() || 'Account';
    const text = `Dear ${row.customerName},\n\n${row.messageSummary}${
      inv && balance > 0
        ? `\n\nRemaining Balance on ${inv.invoiceNumber}: ${formatCents(balance)}\nPaybill ${activePaybill} · ${accountLabel} ${row.accountCode}`
        : ''
    }\n\nMajiTrack Water Billing · majitracksystembilling.net`;
    return buildWhatsAppUrl(phone, text);
  };

  const handleRowWhatsAppResend = (row: NotificationLog) => {
    const conn = connMap.get(row.connectionId);
    const phone = conn?.phone || row.recipient;
    onLogNotification({
      connectionId: row.connectionId,
      customerName: row.customerName,
      accountCode: row.accountCode,
      invoiceId: row.invoiceId,
      invoiceNumber: row.invoiceNumber,
      channel: 'WHATSAPP',
      recipient: phone,
      messageSummary: `WhatsApp-only follow-up: ${row.messageSummary}`.slice(0, 260),
      status: 'Sent',
    });
  };

  const channelBadge = (channel: NotificationChannel) => {
    if (channel === 'WHATSAPP') {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-control bg-[#25D366]/14 px-2 py-0.5 text-caption font-semibold text-[#15803d]">
          <MessageSquare className="size-3.5" />
          WhatsApp
        </span>
      );
    }
    if (channel === 'SMS') {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-control bg-primary/12 px-2 py-0.5 text-caption font-semibold text-primary">
          <Smartphone className="size-3.5" />
          SMS
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 rounded-control bg-surface-muted px-2 py-0.5 text-caption font-semibold text-foreground border border-border/40">
        <Mail className="size-3.5 text-muted" />
        Email
      </span>
    );
  };

  const statusBadge = (status: NotificationStatus) => {
    if (status === 'Delivered') {
      return (
        <span className="inline-flex items-center gap-1 text-caption font-semibold text-accent">
          <CheckCircle2 className="size-3.5" />
          Delivered
        </span>
      );
    }
    if (status === 'Sent') {
      return (
        <span className="inline-flex items-center gap-1 text-caption font-semibold text-primary">
          <Send className="size-3" />
          Sent
        </span>
      );
    }
    if (status === 'Pending') {
      return (
        <span className="inline-flex items-center gap-1 text-caption font-semibold text-warning">
          <Clock className="size-3.5" />
          Pending
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-caption font-semibold text-danger">
        <AlertCircle className="size-3.5" />
        Failed
      </span>
    );
  };

  const channelTabs: { id: ChannelFilter; label: string; count: number }[] = [
    { id: 'ALL', label: 'All channels', count: counts.all },
    { id: 'WHATSAPP', label: 'WhatsApp', count: counts.whatsapp },
    { id: 'SMS', label: 'SMS', count: counts.sms },
    { id: 'EMAIL', label: 'Email', count: counts.email },
  ];

  return (
    <div className="space-y-5">
      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Surface className="px-4 py-3.5">
          <div className="text-caption text-muted">Total notifications sent</div>
          <div className="mt-1 text-title font-semibold tabular-nums text-foreground">
            {counts.all}
          </div>
          <div className="mt-0.5 text-caption text-muted">
            {counts.deliveredOrSent} delivered or sent
          </div>
        </Surface>

        <Surface className="px-4 py-3.5">
          <div className="text-caption text-muted">WhatsApp dispatches</div>
          <div className="mt-1 text-title font-semibold tabular-nums text-[#15803d]">
            {counts.whatsapp}
          </div>
          <div className="mt-0.5 text-caption text-muted">
            Direct WhatsApp-only channel
          </div>
        </Surface>

        <Surface className="px-4 py-3.5">
          <div className="text-caption text-muted">SMS notices</div>
          <div className="mt-1 text-title font-semibold tabular-nums text-primary">
            {counts.sms}
          </div>
          <div className="mt-0.5 text-caption text-muted">
            Mobile carrier SMS alerts
          </div>
        </Surface>

        <Surface className="px-4 py-3.5">
          <div className="text-caption text-muted">Email statements</div>
          <div className="mt-1 text-title font-semibold tabular-nums text-foreground">
            {counts.email}
          </div>
          <div
            className={`mt-0.5 text-caption ${
              counts.failedOrPending > 0 ? 'text-danger font-medium' : 'text-muted'
            }`}
          >
            {counts.failedOrPending > 0
              ? `${counts.failedOrPending} failed / pending`
              : 'All notices acknowledged'}
          </div>
        </Surface>
      </div>

      {/* Filter & WhatsApp-Only Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Filter notification history by dispatch channel"
          className="flex flex-wrap items-center gap-1.5"
        >
          {channelTabs.map((tab) => {
            const active = channelFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setChannelFilter(tab.id)}
                className={`min-h-9 cursor-pointer whitespace-nowrap rounded-control border px-3 text-caption font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border/45 bg-surface text-foreground hover:bg-background'
                }`}
              >
                {`${tab.label} · ${tab.count}`}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-52 flex-1 sm:flex-initial">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              aria-label="Search notification history"
              placeholder="Search customer, phone, INV-..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="min-h-10 w-full rounded-control border border-border/55 bg-surface pr-3 pl-9 text-label text-foreground placeholder:text-muted/75 focus-visible:outline-2 focus-visible:outline-primary"
            />
          </div>

          <select
            aria-label="Filter by delivery status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="min-h-10 rounded-control border border-border/55 bg-surface px-3 text-label text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          >
            <option value="ALL">All statuses</option>
            <option value="Delivered">Delivered</option>
            <option value="Sent">Sent</option>
            <option value="Pending">Pending</option>
            <option value="Failed">Failed</option>
          </select>

          <button
            type="button"
            onClick={() => openWhatsAppComposer()}
            disabled={state.connections.length === 0}
            className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-control bg-[#25D366] px-3.5 text-label font-semibold text-white shadow-xs transition-all hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-[#25D366]"
          >
            <MessageSquare className="size-4 fill-current" />
            <span>Send via WhatsApp only</span>
          </button>
        </div>
      </div>

      {/* Historical Notification Log Table */}
      <Surface className="overflow-hidden">
        {filteredNotifications.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-section text-foreground">No notification logs match your filters</p>
            <p className="mt-1 text-caption text-muted">
              Dispatch a statement reminder, overdue alert, or WhatsApp-only message to populate the audit trail.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {channelFilter !== 'ALL' || statusFilter !== 'ALL' || searchQuery ? (
                <Button
                  tone="quiet"
                  size="sm"
                  onClick={() => {
                    setChannelFilter('ALL');
                    setStatusFilter('ALL');
                    setSearchQuery('');
                  }}
                >
                  Clear filters
                </Button>
              ) : null}
              {state.connections.length > 0 ? (
                <button
                  type="button"
                  onClick={() => openWhatsAppComposer()}
                  className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-control bg-[#25D366] px-3 text-caption font-semibold text-white hover:brightness-105"
                >
                  <MessageSquare className="size-3.5 fill-current" />
                  <span>Send WhatsApp-only notice</span>
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border/35 text-caption font-semibold uppercase tracking-wider text-muted">
                  <th className="px-4 py-3">Date & time</th>
                  <th className="px-4 py-3">Customer / Account</th>
                  <th className="px-4 py-3">Channel</th>
                  <th className="px-4 py-3">Recipient</th>
                  <th className="px-4 py-3">Message & invoice context</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">WhatsApp only</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30 text-body">
                {filteredNotifications.map((row) => {
                  const rowWaUrl = buildRowWhatsAppUrl(row);
                  return (
                    <tr key={row.id} className="transition-colors hover:bg-background/55">
                      <td className="px-4 py-3.5 whitespace-nowrap align-top">
                        <div className="font-medium tabular-nums text-foreground">
                          {formatLocalDate(row.sentDate)}
                        </div>
                        <div className="text-caption tabular-nums text-muted">
                          {`${row.sentTime} · By ${row.dispatchedBy}`}
                        </div>
                      </td>

                      <td className="px-4 py-3.5 align-top">
                        <div className="font-medium text-foreground">{row.customerName}</div>
                        <div className="font-mono text-caption text-muted">{row.accountCode}</div>
                      </td>

                      <td className="px-4 py-3.5 align-top whitespace-nowrap">
                        {channelBadge(row.channel)}
                      </td>

                      <td className="px-4 py-3.5 align-top">
                        <div className="font-mono text-caption text-foreground max-w-44 truncate" title={row.recipient}>
                          {row.recipient}
                        </div>
                      </td>

                      <td className="px-4 py-3.5 align-top">
                        {row.invoiceNumber && row.invoiceId && onOpenInvoice ? (
                          <button
                            type="button"
                            onClick={() => onOpenInvoice(row.invoiceId!)}
                            className="mb-0.5 inline-flex cursor-pointer items-center gap-1 font-mono text-caption font-semibold text-primary hover:underline"
                          >
                            {row.invoiceNumber}
                          </button>
                        ) : row.invoiceNumber ? (
                          <div className="mb-0.5 font-mono text-caption font-semibold text-foreground">
                            {row.invoiceNumber}
                          </div>
                        ) : null}
                        <p className="text-caption text-muted line-clamp-2 max-w-md">
                          {row.messageSummary}
                        </p>
                      </td>

                      <td className="px-4 py-3.5 align-top whitespace-nowrap">
                        {statusBadge(row.status)}
                      </td>

                      <td className="px-4 py-3.5 align-top text-right whitespace-nowrap">
                        <a
                          href={rowWaUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => handleRowWhatsAppResend(row)}
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-control border border-[#25D366]/45 bg-[#25D366]/10 px-2.5 py-1.5 text-caption font-semibold text-[#15803d] transition-colors hover:bg-[#25D366] hover:text-white focus-visible:outline-2 focus-visible:outline-[#25D366]"
                          title={`Send through WhatsApp only to ${row.customerName}`}
                        >
                          <MessageSquare className="size-3.5" />
                          <span>WhatsApp</span>
                          <ExternalLink className="size-3 opacity-75" />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Surface>

      {/* WhatsApp-Only Dispatch Composer Modal */}
      <ModalDialog
        open={waModalOpen}
        onClose={() => setWaModalOpen(false)}
        title="Send Notification via WhatsApp Only"
        subtitle="Dispatch water statements, arrears alerts, or custom notices directly through WhatsApp without sending SMS or Email"
        maxWidthClass="max-w-xl"
      >
        {activeComposeConn ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SelectField
                label="Customer account"
                value={activeComposeConn.id}
                onChange={(e) => {
                  const nextConnId = e.target.value;
                  setSelectedConnId(nextConnId);
                  const nextInvs = state.invoices
                    .filter((i) => i.connectionId === nextConnId)
                    .sort((a, b) => b.cycleId.localeCompare(a.cycleId));
                  const nextInv =
                    nextInvs.find((i) => i.totalPayableKsh > i.amountPaidKsh) ?? nextInvs[0];
                  const nextInvId = nextInv?.id ?? '';
                  setSelectedInvoiceId(nextInvId);
                  refreshComposedText(nextConnId, nextInvId, selectedTemplate);
                }}
              >
                {state.connections.map((conn) => (
                  <option key={conn.id} value={conn.id}>
                    {`${conn.customerName} (${conn.accountCode})`}
                  </option>
                ))}
              </SelectField>

              <SelectField
                label="Linked invoice (optional)"
                value={activeComposeInvoice?.id ?? ''}
                onChange={(e) => {
                  const nextInvId = e.target.value;
                  setSelectedInvoiceId(nextInvId);
                  refreshComposedText(activeComposeConn.id, nextInvId, selectedTemplate);
                }}
              >
                {activeComposeInvoices.length === 0 ? (
                  <option value="">No invoices on file</option>
                ) : (
                  activeComposeInvoices.map((inv) => {
                    const bal = Math.max(0, inv.totalPayableKsh - inv.amountPaidKsh);
                    return (
                      <option key={inv.id} value={inv.id}>
                        {`${inv.invoiceNumber} · ${inv.cycleId} (${
                          bal > 0 ? `Due ${formatCents(bal)}` : 'Paid'
                        })`}
                      </option>
                    );
                  })
                )}
              </SelectField>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-border/40 bg-background px-3.5 py-2.5 text-caption">
              <div>
                <span className="text-muted">WhatsApp recipient: </span>
                <span className="font-mono font-semibold text-foreground">
                  {activeComposeConn.phone}
                </span>
                <span className="text-muted">
                  {` (+${formatWhatsAppPhone(activeComposeConn.phone)})`}
                </span>
              </div>
              <span className="rounded-control bg-[#25D366]/14 px-2 py-0.5 font-semibold text-[#15803d]">
                WhatsApp-only delivery
              </span>
            </div>

            <SelectField
              label="Message template"
              value={selectedTemplate}
              onChange={(e) => {
                const tpl = e.target.value as WhatsAppTemplateId;
                setSelectedTemplate(tpl);
                refreshComposedText(
                  activeComposeConn.id,
                  activeComposeInvoice?.id ?? '',
                  tpl
                );
              }}
            >
              <option value="balance">Payment reminder & balance</option>
              <option value="overdue">Urgent overdue arrears notice</option>
              <option value="statement">Cycle water statement summary</option>
              <option value="custom">Custom WhatsApp message</option>
            </SelectField>

            <div className="space-y-1.5">
              <label
                htmlFor="wa-message-body"
                className="block text-label text-foreground"
              >
                WhatsApp message
              </label>
              <textarea
                id="wa-message-body"
                rows={7}
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                className="w-full rounded-control border border-border/55 bg-surface px-3 py-2.5 text-body text-foreground focus-visible:outline-2 focus-visible:outline-primary"
                placeholder="Type your customer water billing message..."
              />
              <p className="text-caption text-muted">
                Opens WhatsApp directly with this message prefilled and logs the WhatsApp dispatch in your ledger history.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
              <Button tone="quiet" onClick={() => setWaModalOpen(false)}>
                Cancel
              </Button>

              {activeComposeInvoice ? (
                <Button
                  tone="quiet"
                  onClick={() => {
                    const invPayments = state.payments.filter(
                      (p) => p.invoiceId === activeComposeInvoice.id
                    );
                    const invReading =
                      state.readings.find((r) => r.id === activeComposeInvoice.readingId) ?? null;
                    downloadCustomerInvoicePdf({
                      invoice: activeComposeInvoice,
                      connection: activeComposeConn,
                      payments: invPayments,
                      reading: invReading,
                      paybill: state.paybill,
                    });
                  }}
                  title="Download customer invoice PDF to attach in WhatsApp"
                >
                  <Download className="size-4 text-primary" />
                  <span>Download PDF</span>
                </Button>
              ) : null}

              <a
                href={composeWaUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleConfirmWhatsAppSend}
                className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-control bg-[#25D366] px-4 text-label font-semibold text-white shadow-xs transition-all hover:brightness-105 focus-visible:outline-2 focus-visible:outline-[#25D366]"
              >
                <MessageSquare className="size-4 fill-current" />
                <span>Send via WhatsApp only</span>
                <ExternalLink className="size-3.5" />
              </a>
            </div>
          </div>
        ) : (
          <p className="text-body text-muted">
            Register at least one customer account to send WhatsApp notifications.
          </p>
        )}
      </ModalDialog>
    </div>
  );
}
