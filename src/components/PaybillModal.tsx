import React, { useEffect, useMemo, useState } from 'react';
import { PaybillSettings, PaymentMethod, WaterConnection, WaterInvoice } from '../types/billing';
import {
  ALTERNATE_PAYBILL_NUMBER,
  DEFAULT_PAYBILL_NAME,
  DEFAULT_PAYBILL_NUMBER,
  formatCents,
  formatLocalDate,
  generateMpesaReference,
  parseUsdInputToCents,
} from '../lib/billingMath';
import { Button, ModalDialog } from './ui';
import { CheckCircle2, Copy, Edit3, Send, Smartphone, Sparkles } from 'lucide-react';

export interface PaybillModalProps {
  open: boolean;
  onClose: () => void;
  invoice: WaterInvoice | null;
  connection: WaterConnection | null;
  paybill?: PaybillSettings;
  onUpdatePaybill?: (next: PaybillSettings) => void;
  onRecordPayment: (opts: {
    invoiceId: string;
    amountCents: number;
    method: PaymentMethod;
    reference: string;
  }) => void;
}

export function PaybillModal({
  open,
  onClose,
  invoice,
  connection,
  paybill,
  onUpdatePaybill,
  onRecordPayment,
}: PaybillModalProps) {
  const effectivePaybill: PaybillSettings = useMemo(
    () => ({
      primaryPaybill: paybill?.primaryPaybill?.trim() || DEFAULT_PAYBILL_NUMBER,
      alternatePaybill:
        paybill?.alternatePaybill !== undefined
          ? paybill.alternatePaybill.trim()
          : ALTERNATE_PAYBILL_NUMBER,
      businessName: paybill?.businessName?.trim() || DEFAULT_PAYBILL_NAME,
      accountLabel: paybill?.accountLabel?.trim() || 'Account Number',
    }),
    [paybill]
  );

  const shortCodes = useMemo(() => {
    return Array.from(
      new Set(
        [effectivePaybill.primaryPaybill, effectivePaybill.alternatePaybill].filter(
          (v): v is string => Boolean(v && v.trim())
        )
      )
    );
  }, [effectivePaybill]);

  const [selectedShortCode, setSelectedShortCode] = useState<string>(
    effectivePaybill.primaryPaybill
  );
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [mpesaCodeInput, setMpesaCodeInput] = useState(() => generateMpesaReference());
  const [phoneNumberInput, setPhoneNumberInput] = useState(connection?.phone || '0700000000');
  const [amountInput, setAmountInput] = useState(() => {
    if (!invoice) return '0';
    return Math.max(0, invoice.totalPayableKsh - invoice.amountPaidKsh).toFixed(0);
  });
  const [errorMsg, setErrorMsg] = useState('');
  const [confirmedMessage, setConfirmedMessage] = useState('');
  const [submittingCallback, setSubmittingCallback] = useState(false);

  // Inline Edit Paybill panel state
  const [editingPaybill, setEditingPaybill] = useState(false);
  const [editPrimary, setEditPrimary] = useState(effectivePaybill.primaryPaybill);
  const [editAlternate, setEditAlternate] = useState(effectivePaybill.alternatePaybill || '');
  const [editBusinessName, setEditBusinessName] = useState(effectivePaybill.businessName);
  const [editAccountLabel, setEditAccountLabel] = useState(effectivePaybill.accountLabel);

  const balanceKsh = invoice ? Math.max(0, invoice.totalPayableKsh - invoice.amountPaidKsh) : 0;

  useEffect(() => {
    if (open && invoice && connection) {
      setAmountInput(Math.max(0, invoice.totalPayableKsh - invoice.amountPaidKsh).toFixed(0));
      setPhoneNumberInput(connection.phone || '0700000000');
      setMpesaCodeInput(generateMpesaReference());
      setSelectedShortCode(effectivePaybill.primaryPaybill);
      setEditPrimary(effectivePaybill.primaryPaybill);
      setEditAlternate(effectivePaybill.alternatePaybill || '');
      setEditBusinessName(effectivePaybill.businessName);
      setEditAccountLabel(effectivePaybill.accountLabel);
      setEditingPaybill(false);
      setErrorMsg('');
      setConfirmedMessage('');
    }
  }, [open, invoice, connection, effectivePaybill]);

  if (!invoice || !connection) return null;

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(label);
      setTimeout(() => setCopiedField(null), 2000);
    });
  };

  const handleAutoGenerateCode = () => {
    setMpesaCodeInput(generateMpesaReference());
    setErrorMsg('');
  };

  const handleSavePaybillSettings = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPrimary = editPrimary.trim();
    if (!cleanPrimary) {
      setErrorMsg('Primary Paybill / Till number is required.');
      return;
    }
    const next: PaybillSettings = {
      primaryPaybill: cleanPrimary.slice(0, 20),
      alternatePaybill: editAlternate.trim() ? editAlternate.trim().slice(0, 20) : undefined,
      businessName: editBusinessName.trim().slice(0, 120) || DEFAULT_PAYBILL_NAME,
      accountLabel: editAccountLabel.trim().slice(0, 60) || 'Account Number',
    };
    onUpdatePaybill?.(next);
    setSelectedShortCode(next.primaryPaybill);
    setEditingPaybill(false);
    setErrorMsg('');
  };

  const handleSubmitPaybillPayment = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseUsdInputToCents(amountInput);
    if (amount === null || amount <= 0) {
      setErrorMsg('Please enter a valid payment amount greater than KSh 0.');
      return;
    }
    if (amount > balanceKsh) {
      setErrorMsg(`Amount cannot exceed the remaining balance of ${formatCents(balanceKsh)}.`);
      return;
    }

    const cleanCode = mpesaCodeInput.trim().toUpperCase();
    if (!cleanCode || cleanCode.length < 6) {
      setErrorMsg('Enter a valid M-Pesa transaction reference (at least 6 alphanumeric characters).');
      return;
    }

    onRecordPayment({
      invoiceId: invoice.id,
      amountCents: amount,
      method: PaymentMethod.MpesaPaybill,
      reference: cleanCode,
    });

    setConfirmedMessage(`Payment ${cleanCode} (${formatCents(amount)}) credited to ${connection.customerName}.`);
    setTimeout(() => {
      setConfirmedMessage('');
      onClose();
    }, 1200);
  };

  const handleDispatchLiveWebhook = async () => {
    const amount = parseUsdInputToCents(amountInput);
    if (amount === null || amount <= 0) {
      setErrorMsg('Enter a valid KSh amount greater than 0 before sending a C2B callback.');
      return;
    }

    const cleanCode = mpesaCodeInput.trim().toUpperCase();
    if (!cleanCode || cleanCode.length < 6) {
      setErrorMsg('Enter a valid M-Pesa transaction code (min 6 characters).');
      return;
    }

    setSubmittingCallback(true);
    setErrorMsg('');
    try {
      const response = await fetch('/api/mpesa/confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          TransactionType: 'Pay Bill',
          TransID: cleanCode,
          TransAmount: amount,
          BusinessShortCode: selectedShortCode,
          BillRefNumber: connection.accountCode,
          MSISDN: phoneNumberInput.trim() || connection.phone,
        }),
      });
      const data = (await response.json()) as {
        ResultCode?: number | string;
        ResultDesc?: string;
        TransID?: string;
        matchedAccount?: string | null;
      };
      if (!response.ok || Number(data.ResultCode) !== 0) {
        setErrorMsg(data.ResultDesc || 'C2B confirmation callback failed.');
        return;
      }
      setConfirmedMessage(
        `C2B webhook ${data.TransID || cleanCode} received for Paybill ${selectedShortCode} (${
          data.matchedAccount || connection.accountCode
        }). Updating ledger…`
      );
      setTimeout(() => {
        setConfirmedMessage('');
        onClose();
      }, 1300);
    } catch {
      setErrorMsg('Could not reach /api/mpesa/confirmation endpoint.');
    } finally {
      setSubmittingCallback(false);
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Lipa na M-Pesa Paybill"
      subtitle={`${invoice.invoiceNumber} · ${connection.customerName} (${connection.accountCode})`}
      maxWidthClass="max-w-xl"
    >
      <div className="space-y-5">
        {/* Safaricom M-Pesa Brand Header */}
        <div className="rounded-control border border-[#25D366]/40 bg-[#25D366]/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-control bg-[#25D366] font-bold text-white shadow-xs">
                M
              </span>
              <div>
                <h3 className="text-section font-bold text-foreground">
                  Lipa na M-Pesa (C2B Paybill)
                </h3>
                <p className="text-[11px] text-muted">
                  Paybill {shortCodes.join(' / ')} · {effectivePaybill.businessName}
                </p>
              </div>
            </div>

            <div className="text-right">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted block">
                Total Due
              </span>
              <span className="font-mono text-title font-bold text-foreground">
                {formatCents(balanceKsh)}
              </span>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium text-muted">Paybill:</span>
              {shortCodes.map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setSelectedShortCode(code)}
                  className={`cursor-pointer rounded-control border px-2.5 py-1 font-mono text-caption font-semibold transition-colors ${
                    selectedShortCode === code
                      ? 'border-[#25D366] bg-[#25D366] text-white'
                      : 'border-border/50 bg-surface text-foreground hover:bg-background'
                  }`}
                >
                  {code}
                </button>
              ))}
            </div>

            {onUpdatePaybill ? (
              <button
                type="button"
                onClick={() => setEditingPaybill((v) => !v)}
                className="inline-flex cursor-pointer items-center gap-1 rounded-control border border-border/55 bg-surface px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-background"
              >
                <Edit3 className="size-3 text-primary" />
                <span>{editingPaybill ? 'Close Paybill Editor' : 'Edit Paybill Details'}</span>
              </button>
            ) : null}
          </div>

          {editingPaybill && onUpdatePaybill ? (
            <form
              onSubmit={handleSavePaybillSettings}
              className="mt-3 grid grid-cols-1 gap-2.5 rounded-control border border-border/50 bg-surface p-3 sm:grid-cols-2"
            >
              <div>
                <label className="mb-1 block text-[11px] font-medium text-foreground">
                  Primary Paybill / Till No.
                </label>
                <input
                  type="text"
                  value={editPrimary}
                  onChange={(e) => setEditPrimary(e.target.value)}
                  required
                  className="min-h-9 w-full rounded-control border border-border/60 bg-background px-2.5 font-mono text-caption text-foreground"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-foreground">
                  Alternate Paybill (optional)
                </label>
                <input
                  type="text"
                  value={editAlternate}
                  onChange={(e) => setEditAlternate(e.target.value)}
                  placeholder="e.g. 247247"
                  className="min-h-9 w-full rounded-control border border-border/60 bg-background px-2.5 font-mono text-caption text-foreground"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-foreground">
                  Paybill Business Name
                </label>
                <input
                  type="text"
                  value={editBusinessName}
                  onChange={(e) => setEditBusinessName(e.target.value)}
                  required
                  className="min-h-9 w-full rounded-control border border-border/60 bg-background px-2.5 text-caption text-foreground"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-foreground">
                  Account Reference Label
                </label>
                <input
                  type="text"
                  value={editAccountLabel}
                  onChange={(e) => setEditAccountLabel(e.target.value)}
                  required
                  className="min-h-9 w-full rounded-control border border-border/60 bg-background px-2.5 text-caption text-foreground"
                />
              </div>
              <div className="flex justify-end gap-2 sm:col-span-2 pt-1">
                <Button tone="quiet" size="sm" onClick={() => setEditingPaybill(false)}>
                  Cancel
                </Button>
                <Button type="submit" tone="primary" size="sm">
                  Save Paybill Settings
                </Button>
              </div>
            </form>
          ) : null}
        </div>

        {/* 3 Core Paybill Credentials with 1-Click Copy */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-caption">
          <div className="rounded-control border border-border/45 bg-surface-muted/30 p-3 flex flex-col justify-between">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted block">
                Business Number
              </span>
              <div className="font-mono text-title font-bold text-foreground mt-0.5">
                {selectedShortCode}
              </div>
              <span className="text-[11px] text-muted block mt-0.5 truncate">
                {effectivePaybill.businessName}
              </span>
            </div>
            <button
              type="button"
              onClick={() => handleCopy(selectedShortCode, 'business')}
              className="mt-2.5 inline-flex items-center justify-center gap-1 rounded-control border border-border/55 bg-surface px-2 py-1 text-[11px] font-medium text-foreground hover:bg-background transition-colors cursor-pointer"
            >
              {copiedField === 'business' ? (
                <CheckCircle2 className="size-3 text-accent" />
              ) : (
                <Copy className="size-3" />
              )}
              <span>{copiedField === 'business' ? 'Copied!' : 'Copy Paybill'}</span>
            </button>
          </div>

          <div className="rounded-control border border-border/45 bg-surface-muted/30 p-3 flex flex-col justify-between">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted block">
                {effectivePaybill.accountLabel}
              </span>
              <div className="font-mono text-title font-bold text-foreground mt-0.5">
                {connection.accountCode}
              </div>
              <span className="text-[11px] text-muted block mt-0.5 truncate">
                {connection.customerName}
              </span>
            </div>
            <button
              type="button"
              onClick={() => handleCopy(connection.accountCode, 'account')}
              className="mt-2.5 inline-flex items-center justify-center gap-1 rounded-control border border-border/55 bg-surface px-2 py-1 text-[11px] font-medium text-foreground hover:bg-background transition-colors cursor-pointer"
            >
              {copiedField === 'account' ? (
                <CheckCircle2 className="size-3 text-accent" />
              ) : (
                <Copy className="size-3" />
              )}
              <span>{copiedField === 'account' ? 'Copied!' : 'Copy Account'}</span>
            </button>
          </div>

          <div className="rounded-control border border-border/45 bg-surface-muted/30 p-3 flex flex-col justify-between">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted block">
                Exact Amount (KSh)
              </span>
              <div className="font-mono text-title font-bold text-accent mt-0.5">
                {formatCents(balanceKsh)}
              </div>
              <span className="text-[11px] text-muted block mt-0.5">
                Due {formatLocalDate(invoice.dueDate)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => handleCopy(String(balanceKsh), 'amount')}
              className="mt-2.5 inline-flex items-center justify-center gap-1 rounded-control border border-border/55 bg-surface px-2 py-1 text-[11px] font-medium text-foreground hover:bg-background transition-colors cursor-pointer"
            >
              {copiedField === 'amount' ? (
                <CheckCircle2 className="size-3 text-accent" />
              ) : (
                <Copy className="size-3" />
              )}
              <span>{copiedField === 'amount' ? 'Copied!' : 'Copy Amount'}</span>
            </button>
          </div>
        </div>

        {/* Step-by-Step Mobile Phone Instructions */}
        <div className="rounded-control border border-border/35 bg-surface p-3.5 space-y-2 text-caption">
          <div className="font-semibold text-foreground flex items-center gap-1.5">
            <Smartphone className="size-4 text-primary" />
            <span>How to pay on your phone (M-Pesa SIM Toolkit / App):</span>
          </div>
          <ol className="list-decimal list-inside space-y-1 text-muted pl-1">
            <li>Open M-Pesa menu and select <strong>Lipa na M-Pesa</strong> → <strong>Pay Bill</strong></li>
            <li>Enter Business No: <strong className="font-mono text-foreground">{selectedShortCode}</strong></li>
            <li>Enter {effectivePaybill.accountLabel}: <strong className="font-mono text-foreground">{connection.accountCode}</strong></li>
            <li>Enter Amount: <strong className="font-mono text-foreground">KSh {balanceKsh.toLocaleString('en-KE')}</strong></li>
            <li>Enter M-Pesa PIN — Safaricom confirms automatically in real time</li>
          </ol>
        </div>

        {/* Verification & Live C2B Callback Form */}
        <form onSubmit={handleSubmitPaybillPayment} className="rounded-control border border-border/45 bg-surface-muted/20 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-label font-semibold text-foreground">
              Verify or Test M-Pesa C2B Paybill Payment
            </span>
            <span className="text-[11px] text-muted">
              Auto-settles bill & logs receipt
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-caption font-medium text-foreground">
                Amount (KSh)
              </label>
              <input
                type="number"
                step="1"
                min="1"
                max={balanceKsh > 0 ? balanceKsh.toFixed(0) : undefined}
                value={amountInput}
                onChange={(e) => {
                  setAmountInput(e.target.value);
                  setErrorMsg('');
                }}
                required
                className="min-h-10 w-full rounded-control border border-border/60 bg-surface px-3 font-mono text-label text-foreground focus-visible:outline-2 focus-visible:outline-primary"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-caption font-medium text-foreground">
                  M-Pesa Code
                </label>
                <button
                  type="button"
                  onClick={handleAutoGenerateCode}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline cursor-pointer"
                  title="Generate sample Safaricom transaction code"
                >
                  <Sparkles className="size-3" />
                  <span>New</span>
                </button>
              </div>
              <input
                type="text"
                value={mpesaCodeInput}
                onChange={(e) => {
                  setMpesaCodeInput(e.target.value.toUpperCase());
                  setErrorMsg('');
                }}
                placeholder="e.g. QKB74HD91X"
                required
                className="min-h-10 w-full rounded-control border border-border/60 bg-surface px-3 font-mono uppercase text-label text-foreground focus-visible:outline-2 focus-visible:outline-primary"
              />
            </div>

            <div>
              <label className="mb-1 block text-caption font-medium text-foreground">
                MSISDN (Phone)
              </label>
              <input
                type="text"
                value={phoneNumberInput}
                onChange={(e) => {
                  setPhoneNumberInput(e.target.value);
                  setErrorMsg('');
                }}
                placeholder="2547..."
                className="min-h-10 w-full rounded-control border border-border/60 bg-surface px-3 font-mono text-label text-foreground focus-visible:outline-2 focus-visible:outline-primary"
              />
            </div>
          </div>

          {errorMsg ? (
            <p className="text-caption font-medium text-danger">{errorMsg}</p>
          ) : null}

          {confirmedMessage ? (
            <div className="rounded-control bg-accent/15 p-2.5 text-caption font-medium text-accent flex items-center gap-2">
              <CheckCircle2 className="size-4 shrink-0" />
              <span>{confirmedMessage}</span>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2">
            <Button tone="quiet" size="sm" onClick={onClose}>
              Cancel
            </Button>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                tone="quiet"
                size="sm"
                disabled={submittingCallback || Boolean(confirmedMessage)}
                onClick={() => void handleDispatchLiveWebhook()}
                title="Send live POST to /api/mpesa/confirmation and reflect via real-time stream"
              >
                <Send className="size-3.5 text-primary" />
                <span>{submittingCallback ? 'Sending C2B…' : 'Send Live C2B Callback'}</span>
              </Button>

              <Button
                type="submit"
                tone="primary"
                disabled={submittingCallback || Boolean(confirmedMessage)}
              >
                <CheckCircle2 className="size-4" />
                <span>Confirm & Credit</span>
              </Button>
            </div>
          </div>
        </form>
      </div>
    </ModalDialog>
  );
}
