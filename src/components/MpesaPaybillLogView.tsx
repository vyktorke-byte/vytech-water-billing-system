import React, { useEffect, useMemo, useState } from 'react';
import { BillingStoreState, MpesaC2BTransaction, PaybillSettings } from '../types/billing';
import {
  ALTERNATE_PAYBILL_NUMBER,
  DEFAULT_PAYBILL_NAME,
  DEFAULT_PAYBILL_NUMBER,
  formatCents,
  generateMpesaReference,
} from '../lib/billingMath';
import { Button, Field, ModalDialog, Surface } from './ui';
import {
  CheckCircle2,
  Edit3,
  ExternalLink,
  Link2,
  RefreshCw,
  Search,
  Send,
  Smartphone,
} from 'lucide-react';

interface MpesaStatusSnapshot {
  environment: 'sandbox' | 'production';
  defaultShortCode: string;
  supportedShortCodes: string[];
  hasCredentials: boolean;
  responseType: 'Completed' | 'Cancelled';
  validationUrl: string;
  confirmationUrl: string;
  lastRegisteredInfo: {
    registeredAt: string;
    shortCodes: string[];
    validationUrl: string;
    confirmationUrl: string;
  } | null;
}

interface MpesaPaybillLogViewProps {
  state: BillingStoreState;
  onOpenInvoice: (invoiceId: string) => void;
  onUpdatePaybill: (next: PaybillSettings) => void;
  onNotice?: (message: string) => void;
}

export function MpesaPaybillLogView({
  state,
  onOpenInvoice,
  onUpdatePaybill,
  onNotice,
}: MpesaPaybillLogViewProps) {
  const effectivePaybill: PaybillSettings = useMemo(
    () => ({
      primaryPaybill: state.paybill?.primaryPaybill?.trim() || DEFAULT_PAYBILL_NUMBER,
      alternatePaybill:
        state.paybill?.alternatePaybill !== undefined
          ? state.paybill.alternatePaybill.trim()
          : ALTERNATE_PAYBILL_NUMBER,
      businessName: state.paybill?.businessName?.trim() || DEFAULT_PAYBILL_NAME,
      accountLabel: state.paybill?.accountLabel?.trim() || 'Account Number',
    }),
    [state.paybill]
  );

  const activeShortCodes = useMemo(
    () =>
      Array.from(
        new Set(
          [effectivePaybill.primaryPaybill, effectivePaybill.alternatePaybill].filter(
            (v): v is string => Boolean(v && v.trim())
          )
        )
      ),
    [effectivePaybill]
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'Completed' | 'Unmatched'>('ALL');
  const [mpesaStatus, setMpesaStatus] = useState<MpesaStatusSnapshot | null>(null);
  const [registering, setRegistering] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'accent' | 'danger'; message: string } | null>(
    null
  );

  // Edit Paybill Details modal state
  const [editPaybillOpen, setEditPaybillOpen] = useState(false);
  const [editPrimary, setEditPrimary] = useState(effectivePaybill.primaryPaybill);
  const [editAlternate, setEditAlternate] = useState(effectivePaybill.alternatePaybill || '');
  const [editBusinessName, setEditBusinessName] = useState(effectivePaybill.businessName);
  const [editAccountLabel, setEditAccountLabel] = useState(effectivePaybill.accountLabel);
  const [editPaybillError, setEditPaybillError] = useState('');

  // Test C2B payment modal state
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testShortCode, setTestShortCode] = useState<string>(effectivePaybill.primaryPaybill);
  const [testBillRef, setTestBillRef] = useState<string>(
    () => state.connections.find((c) => c.accountCode)?.accountCode || 'VW-1048'
  );
  const [testAmount, setTestAmount] = useState<string>('1500');
  const [testMsisdn, setTestMsisdn] = useState<string>('254722345002');
  const [testTransId, setTestTransId] = useState<string>(() => generateMpesaReference());
  const [sendingTest, setSendingTest] = useState(false);

  const loadMpesaStatus = async () => {
    try {
      const res = await fetch('/api/mpesa/status');
      if (!res.ok) return;
      const data = (await res.json()) as MpesaStatusSnapshot;
      setMpesaStatus(data);
    } catch {
      // Ignore network hiccup when checking status
    }
  };

  useEffect(() => {
    void loadMpesaStatus();
  }, []);

  useEffect(() => {
    setTestShortCode(effectivePaybill.primaryPaybill);
  }, [effectivePaybill.primaryPaybill]);

  const transactions: MpesaC2BTransaction[] = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...(state.mpesaTransactions ?? [])]
      .filter((tx) => {
        if (statusFilter !== 'ALL' && tx.status !== statusFilter) return false;
        if (q) {
          const hay = `${tx.transId} ${tx.billRefNumber} ${tx.msisdn} ${tx.customerName} ${
            tx.accountCode ?? ''
          } ${tx.businessShortCode}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }, [state.mpesaTransactions, searchQuery, statusFilter]);

  const summary = useMemo(() => {
    const all = state.mpesaTransactions ?? [];
    let completedCount = 0;
    let unmatchedCount = 0;
    let totalReceivedKsh = 0;
    for (const tx of all) {
      totalReceivedKsh += tx.transAmount;
      if (tx.status === 'Completed') completedCount += 1;
      else if (tx.status === 'Unmatched') unmatchedCount += 1;
    }
    return {
      totalCount: all.length,
      completedCount,
      unmatchedCount,
      totalReceivedKsh,
    };
  }, [state.mpesaTransactions]);

  const handleOpenEditPaybill = () => {
    setEditPrimary(effectivePaybill.primaryPaybill);
    setEditAlternate(effectivePaybill.alternatePaybill || '');
    setEditBusinessName(effectivePaybill.businessName);
    setEditAccountLabel(effectivePaybill.accountLabel);
    setEditPaybillError('');
    setEditPaybillOpen(true);
  };

  const handleSavePaybill = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPrimary = editPrimary.trim();
    const cleanBusiness = editBusinessName.trim();
    const cleanLabel = editAccountLabel.trim();
    if (!cleanPrimary || !cleanBusiness || !cleanLabel) {
      setEditPaybillError('Primary Paybill number, business name, and account label are required.');
      return;
    }
    onUpdatePaybill({
      primaryPaybill: cleanPrimary.slice(0, 20),
      alternatePaybill: editAlternate.trim() ? editAlternate.trim().slice(0, 20) : undefined,
      businessName: cleanBusiness.slice(0, 120),
      accountLabel: cleanLabel.slice(0, 60),
    });
    setEditPaybillOpen(false);
    setFeedback({
      tone: 'accent',
      message: `Updated Paybill configuration to ${cleanPrimary}${
        editAlternate.trim() ? ` / ${editAlternate.trim()}` : ''
      } (${cleanBusiness}).`,
    });
  };

  const handleRegisterUrls = async (registerAll: boolean) => {
    setRegistering(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/mpesa/register-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registerAllSupported: registerAll,
          shortCode: registerAll ? undefined : effectivePaybill.primaryPaybill,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        shortCodes?: string[];
        results?: Array<{ shortCode: string; ok: boolean }>;
      };
      if (!res.ok) {
        setFeedback({
          tone: 'danger',
          message: data.error || 'Could not register C2B URLs with Safaricom.',
        });
        return;
      }
      const list = (data.shortCodes ?? [effectivePaybill.primaryPaybill]).join(', ');
      const msg = `Registered Safaricom C2B Validation & Confirmation URLs for Paybill ${list}.`;
      setFeedback({ tone: 'accent', message: msg });
      onNotice?.(msg);
      await loadMpesaStatus();
    } catch {
      setFeedback({
        tone: 'danger',
        message: 'Failed to reach /api/mpesa/register-urls endpoint.',
      });
    } finally {
      setRegistering(false);
    }
  };

  const handleSendTestCallback = async (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = Math.round(Number(testAmount));
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setFeedback({ tone: 'danger', message: 'Enter a valid KSh payment amount.' });
      return;
    }

    setSendingTest(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/mpesa/confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          TransactionType: 'Pay Bill',
          TransID: testTransId.trim().toUpperCase(),
          TransAmount: numericAmount,
          BusinessShortCode: testShortCode,
          BillRefNumber: testBillRef.trim(),
          MSISDN: testMsisdn.trim(),
        }),
      });
      const data = (await res.json()) as {
        ResultCode?: number | string;
        ResultDesc?: string;
        TransID?: string;
        status?: string;
        matchedAccount?: string | null;
      };
      if (!res.ok || Number(data.ResultCode) !== 0) {
        setFeedback({
          tone: 'danger',
          message: data.ResultDesc || 'C2B confirmation callback rejected.',
        });
        return;
      }

      const msg = data.matchedAccount
        ? `Confirmed M-Pesa C2B ${data.TransID} (${formatCents(numericAmount)}) for ${data.matchedAccount} on Paybill ${testShortCode}.`
        : `Confirmed M-Pesa C2B ${data.TransID} (${formatCents(numericAmount)}) — BillRef "${testBillRef}" logged as Unmatched.`;
      setFeedback({ tone: 'accent', message: msg });
      setTestModalOpen(false);
      setTestTransId(generateMpesaReference());
    } catch {
      setFeedback({
        tone: 'danger',
        message: 'Could not reach /api/mpesa/confirmation webhook.',
      });
    } finally {
      setSendingTest(false);
    }
  };

  const openAccountsForQuickFill = useMemo(() => {
    return state.connections.map((conn) => {
      const unpaid = state.invoices
        .filter((inv) => inv.connectionId === conn.id && inv.amountPaidKsh < inv.totalPayableKsh)
        .reduce((s, inv) => s + Math.max(0, inv.totalPayableKsh - inv.amountPaidKsh), 0);
      return {
        conn,
        unpaid,
      };
    });
  }, [state.connections, state.invoices]);

  return (
    <div className="space-y-5">
      {/* Paybill C2B Summary Strip */}
      <Surface className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex size-8 items-center justify-center rounded-control bg-[#25D366]/15 text-[#25D366]">
                <Smartphone className="size-4" />
              </span>
              <h2 className="text-section font-semibold text-foreground">
                M-Pesa C2B Paybill Configuration &amp; Ledger
              </h2>
              <span className="rounded-control border border-border/45 bg-background px-2 py-0.5 font-mono text-caption font-semibold text-foreground">
                {`Paybill ${activeShortCodes.join(' / ')}`}
              </span>
            </div>
            <p className="text-caption text-muted">
              Business: <strong className="text-foreground">{effectivePaybill.businessName}</strong> · Customer Ref Label: <strong className="text-foreground">{effectivePaybill.accountLabel}</strong>
            </p>
            {mpesaStatus ? (
              <div className="pt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
                <span>
                  Validation: <span className="font-mono text-foreground">{mpesaStatus.validationUrl}</span>
                </span>
                <span>
                  Confirmation: <span className="font-mono text-foreground">{mpesaStatus.confirmationUrl}</span>
                </span>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              tone="quiet"
              size="sm"
              onClick={handleOpenEditPaybill}
              title="Edit Paybill business numbers, name, and account reference label"
            >
              <Edit3 className="size-3.5 text-primary" />
              <span>Edit Paybill</span>
            </Button>

            <Button
              tone="quiet"
              size="sm"
              disabled={registering}
              onClick={() => void handleRegisterUrls(true)}
              title="Register /api/mpesa/validation and /api/mpesa/confirmation URLs with Safaricom Daraja"
            >
              <Link2 className="size-3.5 text-primary" />
              <span>{registering ? 'Registering…' : 'Register C2B URLs'}</span>
            </Button>

            <Button
              tone="primary"
              size="sm"
              onClick={() => {
                const firstUnpaid = openAccountsForQuickFill.find((item) => item.unpaid > 0);
                if (firstUnpaid) {
                  setTestBillRef(firstUnpaid.conn.accountCode);
                  setTestAmount(String(firstUnpaid.unpaid));
                  setTestMsisdn(firstUnpaid.conn.phone);
                }
                setTestTransId(generateMpesaReference());
                setTestModalOpen(true);
              }}
            >
              <Send className="size-3.5" />
              <span>Simulate C2B Payment</span>
            </Button>
          </div>
        </div>

        {/* Counters */}
        <div className="mt-4 grid grid-cols-1 gap-3 border-t border-border/35 pt-4 sm:grid-cols-3">
          <div>
            <div className="text-caption text-muted">C2B Paybill Receipts</div>
            <div className="mt-0.5 text-title font-semibold tabular-nums text-foreground">
              {formatCents(summary.totalReceivedKsh)}
            </div>
          </div>
          <div>
            <div className="text-caption text-muted">Matched & Settled</div>
            <div className="mt-0.5 text-title font-semibold tabular-nums text-accent">
              {`${summary.completedCount} Completed`}
            </div>
          </div>
          <div>
            <div className="text-caption text-muted">Unmatched BillRef</div>
            <div
              className={`mt-0.5 text-title font-semibold tabular-nums ${
                summary.unmatchedCount > 0 ? 'text-warning' : 'text-foreground'
              }`}
            >
              {`${summary.unmatchedCount} Pending review`}
            </div>
          </div>
        </div>

        {feedback ? (
          <div
            role="status"
            className={`mt-4 flex items-center justify-between gap-2 rounded-control border px-3 py-2 text-caption ${
              feedback.tone === 'accent'
                ? 'border-accent/35 bg-accent/10 text-accent'
                : 'border-danger/35 bg-danger/10 text-danger'
            }`}
          >
            <span>{feedback.message}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="cursor-pointer font-semibold hover:underline"
            >
              Dismiss
            </button>
          </div>
        ) : null}
      </Surface>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'ALL', label: `All · ${summary.totalCount}` },
              { id: 'Completed', label: `Completed · ${summary.completedCount}` },
              { id: 'Unmatched', label: `Unmatched · ${summary.unmatchedCount}` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`min-h-9 cursor-pointer rounded-control border px-3 text-caption font-medium transition-colors ${
                statusFilter === tab.id
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border/45 bg-surface text-foreground hover:bg-background'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative min-w-56">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              placeholder="Search TransID, BillRef, MSISDN…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="min-h-10 w-full rounded-control border border-border/55 bg-surface pr-3 pl-9 text-label text-foreground placeholder:text-muted/75 focus-visible:outline-2 focus-visible:outline-primary"
            />
          </div>
          <Button
            tone="quiet"
            size="sm"
            onClick={() => void loadMpesaStatus()}
            title="Refresh C2B registration status"
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* C2B Transaction Feed Table */}
      <Surface>
        {transactions.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <CheckCircle2 className="mx-auto size-8 text-muted/60" />
            <p className="mt-2 text-section text-foreground">
              No M-Pesa C2B Paybill callbacks recorded yet
            </p>
            <p className="mt-1 text-caption text-muted">
              Payments sent to Paybill {activeShortCodes.join(' or ')} appear here in real time as Safaricom dispatches <span className="font-mono">/api/mpesa/confirmation</span>.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border/35 text-caption font-semibold uppercase tracking-wider text-muted">
                  <th className="px-4 py-3">TransID & Time</th>
                  <th className="px-4 py-3">Tenant & Account</th>
                  <th className="px-4 py-3">BillRef / MSISDN</th>
                  <th className="px-4 py-3">Paybill</th>
                  <th className="px-4 py-3 text-right">Amount (KSh)</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Ledger</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30 text-body">
                {transactions.map((tx) => {
                  const primaryInvoiceId = tx.matchedInvoiceIds[0];
                  return (
                    <tr key={tx.id} className="hover:bg-background/60 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-mono font-semibold text-foreground">{tx.transId}</div>
                        <div className="text-caption text-muted">
                          {tx.receivedAt.replace('T', ' ').slice(0, 16)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{tx.customerName}</div>
                        <div className="text-caption font-mono text-muted">
                          {tx.accountCode ?? 'Unmatched account'}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono text-label text-foreground">
                          {tx.billRefNumber}
                        </div>
                        <div className="text-caption font-mono text-muted">{tx.msisdn || '—'}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-label text-foreground">
                        {tx.businessShortCode}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-foreground">
                        {formatCents(tx.transAmount)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-control px-2 py-0.5 text-caption font-semibold ${
                            tx.status === 'Completed'
                              ? 'bg-accent/15 text-accent'
                              : tx.status === 'Unmatched'
                              ? 'bg-warning/15 text-warning'
                              : 'bg-danger/15 text-danger'
                          }`}
                        >
                          {tx.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {primaryInvoiceId ? (
                          <Button
                            tone="quiet"
                            size="sm"
                            onClick={() => onOpenInvoice(primaryInvoiceId)}
                          >
                            <span>Open bill</span>
                            <ExternalLink className="size-3.5" />
                          </Button>
                        ) : (
                          <span className="text-caption text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Surface>

      {/* Edit Paybill Details Modal */}
      <ModalDialog
        open={editPaybillOpen}
        onClose={() => setEditPaybillOpen(false)}
        title="Edit Paybill & Account Reference Settings"
        subtitle="Customize the Paybill shortcode, business name, and account reference label used across invoices, PDFs, SMS & WhatsApp."
      >
        <form onSubmit={handleSavePaybill} className="space-y-4">
          {editPaybillError ? (
            <p role="alert" className="text-caption font-medium text-danger">
              {editPaybillError}
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Primary Paybill / Till Number"
              value={editPrimary}
              onChange={(e) => {
                setEditPrimary(e.target.value);
                setEditPaybillError('');
              }}
              placeholder="e.g. 303030"
              required
            />
            <Field
              label="Alternate / Bank Paybill (optional)"
              value={editAlternate}
              onChange={(e) => {
                setEditAlternate(e.target.value);
                setEditPaybillError('');
              }}
              placeholder="e.g. 247247"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Paybill Business Display Name"
              value={editBusinessName}
              onChange={(e) => {
                setEditBusinessName(e.target.value);
                setEditPaybillError('');
              }}
              placeholder="e.g. MajiTrack Water Billing"
              required
            />
            <Field
              label="Customer Account Reference Label"
              value={editAccountLabel}
              onChange={(e) => {
                setEditAccountLabel(e.target.value);
                setEditPaybillError('');
              }}
              placeholder="e.g. Account Number or House No."
              required
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <Button tone="quiet" onClick={() => setEditPaybillOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" tone="primary">
              Save Paybill Settings
            </Button>
          </div>
        </form>
      </ModalDialog>

      {/* Simulate C2B Callback Modal */}
      <ModalDialog
        open={testModalOpen}
        onClose={() => setTestModalOpen(false)}
        title="Simulate M-Pesa C2B Confirmation"
        subtitle="Dispatch a Safaricom Paybill confirmation payload to /api/mpesa/confirmation"
      >
        <form onSubmit={handleSendTestCallback} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-caption font-medium text-foreground">
                Paybill ShortCode
              </label>
              <select
                value={testShortCode}
                onChange={(e) => setTestShortCode(e.target.value)}
                className="min-h-10 w-full rounded-control border border-border/60 bg-surface px-3 font-mono text-label text-foreground"
              >
                {activeShortCodes.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-caption font-medium text-foreground">
                Tenant BillRefNumber ({effectivePaybill.accountLabel})
              </label>
              <input
                type="text"
                value={testBillRef}
                onChange={(e) => setTestBillRef(e.target.value)}
                placeholder="e.g. VW-1048 or Unit 101"
                required
                className="min-h-10 w-full rounded-control border border-border/60 bg-surface px-3 font-mono text-label text-foreground"
              />
            </div>
          </div>

          {openAccountsForQuickFill.length > 0 ? (
            <div>
              <label className="mb-1 block text-caption text-muted">
                Quick-pick registered tenant account:
              </label>
              <select
                value=""
                onChange={(e) => {
                  const chosen = openAccountsForQuickFill.find((x) => x.conn.id === e.target.value);
                  if (chosen) {
                    setTestBillRef(chosen.conn.accountCode);
                    setTestMsisdn(chosen.conn.phone);
                    if (chosen.unpaid > 0) setTestAmount(String(chosen.unpaid));
                  }
                }}
                className="min-h-10 w-full rounded-control border border-border/55 bg-background px-3 text-caption text-foreground"
              >
                <option value="">Select tenant account to autofill…</option>
                {openAccountsForQuickFill.map(({ conn, unpaid }) => (
                  <option key={conn.id} value={conn.id}>
                    {`${conn.accountCode} · ${conn.customerName} (${conn.premiseAddress})${
                      unpaid > 0 ? ` — Due ${formatCents(unpaid)}` : ' — Settled'
                    }`}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-caption font-medium text-foreground">
                TransAmount (KSh)
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={testAmount}
                onChange={(e) => setTestAmount(e.target.value)}
                required
                className="min-h-10 w-full rounded-control border border-border/60 bg-surface px-3 font-mono text-label text-foreground"
              />
            </div>

            <div>
              <label className="mb-1 block text-caption font-medium text-foreground">
                TransID
              </label>
              <input
                type="text"
                value={testTransId}
                onChange={(e) => setTestTransId(e.target.value.toUpperCase())}
                required
                className="min-h-10 w-full rounded-control border border-border/60 bg-surface px-3 font-mono uppercase text-label text-foreground"
              />
            </div>

            <div>
              <label className="mb-1 block text-caption font-medium text-foreground">
                MSISDN (Phone)
              </label>
              <input
                type="text"
                value={testMsisdn}
                onChange={(e) => setTestMsisdn(e.target.value)}
                required
                className="min-h-10 w-full rounded-control border border-border/60 bg-surface px-3 font-mono text-label text-foreground"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <Button tone="quiet" onClick={() => setTestModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" tone="primary" disabled={sendingTest}>
              <Send className="size-4" />
              <span>{sendingTest ? 'Dispatching…' : 'Send Confirmation Callback'}</span>
            </Button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
