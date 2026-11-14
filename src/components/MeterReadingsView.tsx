import React, { useEffect, useMemo, useState } from 'react';
import {
  BillingStoreState,
  ConnectionStatus,
} from '../types/billing';
import {
  ACTIVE_CYCLE_ID,
  calculateWaterBill,
  evaluateConsumptionSpike,
  formatCents,
  formatLocalDate,
  formatTenthsM3,
  formatTenthsM3Plain,
  parseM3InputToTenths,
} from '../lib/billingMath';
import { Button, Field, ModalDialog, Surface } from './ui';
import { ArrowLeft, Camera, Search } from 'lucide-react';
import { MeterCameraCapture } from './MeterCameraCapture';

interface MeterReadingsViewProps {
  state: BillingStoreState;
  selectedConnectionId: string | null;
  onSelectConnection: (id: string | null) => void;
  onSubmitReadingAndBill: (opts: {
    connectionId: string;
    currentTenthsM3: number;
    anomalyNote?: string;
    photoUrl?: string;
  }) => void;
  onUpdateReadingPhoto: (readingId: string, photoUrl: string | undefined) => void;
  onOpenInvoice: (invoiceId: string) => void;
}

type ReadingFilter = 'UNBILLED' | 'READ_NOV' | 'SPIKES' | 'ALL';

export function MeterReadingsView({
  state,
  selectedConnectionId,
  onSelectConnection,
  onSubmitReadingAndBill,
  onUpdateReadingPhoto,
  onOpenInvoice,
}: MeterReadingsViewProps) {
  const [filterMode, setFilterMode] = useState<ReadingFilter>('UNBILLED');
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  // Reading form inputs
  const [readingInput, setReadingInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [viewingHistoryPhoto, setViewingHistoryPhoto] = useState<string | null>(null);

  const novReadingByConn = useMemo(() => {
    const map = new Map<string, (typeof state.readings)[number]>();
    for (const r of state.readings) {
      if (r.cycleId === ACTIVE_CYCLE_ID) {
        map.set(r.connectionId, r);
      }
    }
    return map;
  }, [state.readings]);

  // If external navigation selected a connection that already has a Nov reading, switch filter to ALL so it's visible
  useEffect(() => {
    if (selectedConnectionId && novReadingByConn.has(selectedConnectionId) && filterMode === 'UNBILLED') {
      setFilterMode('ALL');
    }
  }, [selectedConnectionId, novReadingByConn, filterMode]);

  const counts = useMemo(() => {
    let unbilled = 0;
    let readNov = 0;
    let spikes = 0;
    for (const c of state.connections) {
      const novR = novReadingByConn.get(c.id);
      if (!novR && c.status === ConnectionStatus.Active) unbilled += 1;
      if (novR) {
        readNov += 1;
        if (novR.isSpikeFlagged) spikes += 1;
      }
    }
    return {
      unbilled,
      readNov,
      spikes,
      all: state.connections.length,
    };
  }, [state.connections, novReadingByConn]);

  const filteredConnections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return state.connections.filter((c) => {
      const novR = novReadingByConn.get(c.id);
      if (filterMode === 'UNBILLED' && (novR || c.status !== ConnectionStatus.Active)) return false;
      if (filterMode === 'READ_NOV' && !novR) return false;
      if (filterMode === 'SPIKES' && !novR?.isSpikeFlagged) return false;
      if (q) {
        const hay = `${c.customerName} ${c.accountCode} ${c.meterSerial} ${c.premiseAddress}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [state.connections, filterMode, searchQuery, novReadingByConn]);

  const activeConnection = useMemo(() => {
    if (selectedConnectionId) {
      const exact = state.connections.find((c) => c.id === selectedConnectionId);
      if (exact) return exact;
    }
    return filteredConnections[0] ?? state.connections[0] ?? null;
  }, [selectedConnectionId, state.connections, filteredConnections]);

  const activePriorReadings = useMemo(() => {
    if (!activeConnection) return [];
    return state.readings
      .filter((r) => r.connectionId === activeConnection.id && r.cycleId !== ACTIVE_CYCLE_ID)
      .sort((a, b) => b.cycleId.localeCompare(a.cycleId));
  }, [state.readings, activeConnection]);

  const activeAllReadings = useMemo(() => {
    if (!activeConnection) return [];
    return state.readings
      .filter((r) => r.connectionId === activeConnection.id)
      .sort((a, b) => b.cycleId.localeCompare(a.cycleId));
  }, [state.readings, activeConnection]);

  const trailingAvgTenths = useMemo(() => {
    if (activePriorReadings.length === 0) return 150;
    const recent = activePriorReadings.slice(0, 3);
    return Math.round(recent.reduce((s, r) => s + r.consumptionTenthsM3, 0) / recent.length);
  }, [activePriorReadings]);

  // Pre-populate suggested current index when switching unbilled connection
  useEffect(() => {
    if (!activeConnection) return;
    const novR = novReadingByConn.get(activeConnection.id);
    if (!novR) {
      const suggested = activeConnection.lastReadingTenthsM3 + trailingAvgTenths;
      setReadingInput(formatTenthsM3Plain(suggested).replace(/,/g, ''));
      setNoteInput('');
      setPhotoUrl(null);
      setFormError('');
    }
  }, [activeConnection, novReadingByConn, trailingAvgTenths]);

  const activeNovReading = activeConnection ? novReadingByConn.get(activeConnection.id) ?? null : null;

  const activeNovInvoice = useMemo(() => {
    if (!activeConnection) return null;
    return (
      state.invoices.find(
        (i) => i.connectionId === activeConnection.id && i.cycleId === ACTIVE_CYCLE_ID
      ) ?? null
    );
  }, [state.invoices, activeConnection]);

  // Unpaid arrears from latest prior invoice before Nov 2026
  const priorUnpaidArrearsCents = useMemo(() => {
    if (!activeConnection) return 0;
    const priorInvs = state.invoices
      .filter((i) => i.connectionId === activeConnection.id && i.cycleId < ACTIVE_CYCLE_ID)
      .sort((a, b) => b.cycleId.localeCompare(a.cycleId));
    const latestPrior = priorInvs[0];
    if (!latestPrior) return 0;
    return Math.max(0, latestPrior.totalPayableKsh - latestPrior.amountPaidKsh);
  }, [state.invoices, activeConnection]);

  // Live preview of bill as meter index is typed
  const livePreview = useMemo(() => {
    if (!activeConnection || activeNovReading) return null;
    const parsedTenths = parseM3InputToTenths(readingInput);
    if (parsedTenths === null) {
      return { valid: false as const, reason: 'Enter a valid numeric meter index in m³.' };
    }
    if (parsedTenths < activeConnection.lastReadingTenthsM3) {
      return {
        valid: false as const,
        reason: `Index cannot be below previous reading (${formatTenthsM3(
          activeConnection.lastReadingTenthsM3
        )}).`,
      };
    }
    const consumptionTenths = parsedTenths - activeConnection.lastReadingTenthsM3;
    const schedule = state.tariffs[activeConnection.category] ?? {
      category: activeConnection.category,
      ratePerM3: activeConnection.category === 'Residents' ? 150 : 180,
      seweragePercent: 0,
    };
    const bill = calculateWaterBill(consumptionTenths, schedule);
    const spike = evaluateConsumptionSpike(consumptionTenths, activePriorReadings);
    return {
      valid: true as const,
      currentTenthsM3: parsedTenths,
      consumptionTenthsM3: consumptionTenths,
      bill,
      spike,
    };
  }, [activeConnection, activeNovReading, readingInput, state.tariffs, activePriorReadings]);

  const handlePostReading = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConnection) return;
    if (!livePreview || !livePreview.valid) {
      setFormError(livePreview?.reason ?? 'Check the meter reading value.');
      return;
    }
    onSubmitReadingAndBill({
      connectionId: activeConnection.id,
      currentTenthsM3: livePreview.currentTenthsM3,
      anomalyNote: noteInput.trim() || undefined,
      photoUrl: photoUrl || undefined,
    });
    setPhotoUrl(null);
  };

  const filterChips: { id: ReadingFilter; label: string; count: number }[] = [
    { id: 'UNBILLED', label: 'Awaiting Nov reading', count: counts.unbilled },
    { id: 'READ_NOV', label: 'Read & billed', count: counts.readNov },
    { id: 'SPIKES', label: 'High-usage spikes', count: counts.spikes },
    { id: 'ALL', label: 'All meters', count: counts.all },
  ];

  return (
    <div className="space-y-5">
      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Filter meters by reading state"
          className="flex flex-wrap items-center gap-1.5"
        >
          {filterChips.map((chip) => {
            const active = filterMode === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => setFilterMode(chip.id)}
                className={`min-h-9 cursor-pointer whitespace-nowrap rounded-control border px-3 text-caption font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border/45 bg-surface text-foreground hover:bg-background'
                }`}
              >
                {`${chip.label} · ${chip.count}`}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-52 flex-1 sm:flex-initial">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              aria-label="Search meters by serial, customer, or address"
              placeholder="Search MTR-... or customer"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="min-h-10 w-full rounded-control border border-border/55 bg-surface pr-3 pl-9 text-label text-foreground placeholder:text-muted/75 focus-visible:outline-2 focus-visible:outline-primary"
            />
          </div>
        </div>
      </div>

      {/* Master-Detail */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Surface
          className={`divide-y divide-border/35 lg:col-span-7 ${
            mobileDetailOpen && activeConnection ? 'hidden lg:block' : 'block'
          }`}
        >
          {filteredConnections.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-section text-foreground">
                {filterMode === 'UNBILLED'
                  ? 'Every active meter has been read for November 2026'
                  : 'No meters match this filter'}
              </p>
              <p className="mt-1 text-caption text-muted">
                Switch to Read & billed or All meters to inspect recorded meter indices, capture dial photos, and check spikes.
              </p>
              <div className="mt-4">
                <Button tone="quiet" size="sm" onClick={() => setFilterMode('ALL')}>
                  View all meters
                </Button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-border/35 text-caption font-semibold uppercase tracking-wider text-muted">
                    <th className="px-4 py-3">Meter & connection</th>
                    <th className="px-4 py-3 text-right">Prev index (m³)</th>
                    <th className="px-4 py-3 text-right">Nov 2026 consumption</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30 text-body">
                  {filteredConnections.map((conn) => {
                    const novR = novReadingByConn.get(conn.id);
                    const isSelected = activeConnection?.id === conn.id;
                    const prevTenths = novR ? novR.previousTenthsM3 : conn.lastReadingTenthsM3;

                    return (
                      <tr
                        key={conn.id}
                        onClick={() => {
                          onSelectConnection(conn.id);
                          setMobileDetailOpen(true);
                        }}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-primary/6' : 'hover:bg-background/60'
                        }`}
                      >
                        <td className="px-4 py-3.5">
                          <div className="font-medium text-foreground">{conn.customerName}</div>
                          <div className="mt-0.5 text-caption text-muted">
                            <span className="font-mono text-foreground/85">{conn.meterSerial}</span>
                            {` · ${conn.category}`}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-right tabular-nums text-foreground">
                          {formatTenthsM3(prevTenths)}
                        </td>
                        <td className="px-4 py-3.5 text-right tabular-nums">
                          {novR ? (
                            <div>
                              <span
                                className={
                                  novR.isSpikeFlagged
                                    ? 'font-medium text-danger'
                                    : 'font-medium text-foreground'
                                }
                              >
                                {formatTenthsM3(novR.consumptionTenthsM3)}
                              </span>
                              <div className="flex items-center justify-end gap-1 text-caption text-muted">
                                <span>{novR.isSpikeFlagged ? 'Spike flagged' : 'Billed'}</span>
                                {novR.photoUrl ? (
                                  <span
                                    className="inline-flex items-center gap-0.5 text-primary"
                                    title="Dial photo attached"
                                  >
                                    · <Camera className="size-3" />
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          ) : (
                            <span className="text-caption font-medium text-warning">
                              Needs reading
                            </span>
                          )}
                        </td>
                        <td
                          className="px-4 py-3.5 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            tone={novR ? 'ghost' : 'quiet'}
                            size="sm"
                            onClick={() => {
                              onSelectConnection(conn.id);
                              setMobileDetailOpen(true);
                            }}
                          >
                            {novR ? 'Inspect' : 'Enter read'}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Surface>

        {/* Right Detail / Reading Entry Panel */}
        <div
          className={`lg:col-span-5 lg:sticky lg:top-6 lg:self-start ${
            mobileDetailOpen && activeConnection ? 'block' : 'hidden lg:block'
          }`}
        >
          {activeConnection ? (
            <Surface className="divide-y divide-border/35">
              <div className="flex items-center justify-between px-5 py-3 lg:hidden">
                <Button tone="ghost" size="sm" onClick={() => setMobileDetailOpen(false)}>
                  <ArrowLeft className="size-4" />
                  Back to meters
                </Button>
              </div>

              <div className="space-y-1 px-5 py-4">
                <div className="font-mono text-caption text-muted">
                  {`${activeConnection.meterSerial} · ${activeConnection.accountCode}`}
                </div>
                <h2 className="text-section text-foreground">{activeConnection.customerName}</h2>
                <p className="text-caption text-muted">
                  {`${activeConnection.premiseAddress} · ${activeConnection.category}`}
                </p>
              </div>

              {!activeNovReading ? (
                <form onSubmit={handlePostReading} className="divide-y divide-border/35">
                  <div className="space-y-4 px-5 py-4">
                    <div className="grid grid-cols-2 divide-x divide-border/35">
                      <div className="pr-3">
                        <div className="text-caption text-muted">Previous Oct index</div>
                        <div className="mt-0.5 text-label font-semibold tabular-nums text-foreground">
                          {formatTenthsM3(activeConnection.lastReadingTenthsM3)}
                        </div>
                      </div>
                      <div className="pl-3">
                        <div className="text-caption text-muted">3-cycle mean usage</div>
                        <div className="mt-0.5 text-label tabular-nums text-foreground">
                          {formatTenthsM3(trailingAvgTenths)}
                        </div>
                      </div>
                    </div>

                    <Field
                      label="Current Nov 2026 meter index (m³)"
                      type="number"
                      step="0.1"
                      min={(activeConnection.lastReadingTenthsM3 / 10).toFixed(1)}
                      value={readingInput}
                      onChange={(e) => {
                        setReadingInput(e.target.value);
                        setFormError('');
                      }}
                      error={
                        formError ||
                        (livePreview && !livePreview.valid ? livePreview.reason : undefined)
                      }
                      hint="Record cumulative register reading to 0.1 m³ (100 liters)."
                      required
                    />

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        tone="quiet"
                        size="sm"
                        onClick={() => {
                          const v = activeConnection.lastReadingTenthsM3 + trailingAvgTenths;
                          setReadingInput((v / 10).toFixed(1));
                          setFormError('');
                        }}
                      >
                        {`Use 3-mo avg (+${formatTenthsM3(trailingAvgTenths)})`}
                      </Button>
                      <Button
                        tone="quiet"
                        size="sm"
                        onClick={() => {
                          setReadingInput((activeConnection.lastReadingTenthsM3 / 10).toFixed(1));
                          setNoteInput('Zero consumption verified at meter box');
                          setFormError('');
                        }}
                      >
                        Zero-read (0.0 m³)
                      </Button>
                    </div>

                    <Field
                      label="Field reader note (optional)"
                      type="text"
                      placeholder="e.g. Gate valve dampness, customer confirmed pool fill"
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                    />

                    {/* Camera Access & Meter Dial Photo Capture */}
                    <div className="border-t border-border/30 pt-3">
                      <MeterCameraCapture
                        photoUrl={photoUrl}
                        onPhotoCaptured={setPhotoUrl}
                        onPhotoCleared={() => setPhotoUrl(null)}
                        meterSerial={activeConnection.meterSerial}
                        premise={activeConnection.premiseAddress}
                      />
                    </div>
                  </div>

                  {/* Live Bill Calculation Preview */}
                  {livePreview && livePreview.valid ? (
                    <div className="space-y-2.5 px-5 py-4 text-label">
                      <div className="flex items-center justify-between">
                        <span className="text-caption font-semibold text-muted">
                          Instant bill preview
                        </span>
                        <span className="font-semibold tabular-nums text-foreground">
                          {`Net ${formatTenthsM3(livePreview.consumptionTenthsM3)}`}
                        </span>
                      </div>

                      {livePreview.spike.isSpike && livePreview.spike.ratio ? (
                        <p role="status" className="text-caption font-medium text-danger">
                          {`Spike alert: ${livePreview.spike.ratio.toFixed(
                            1
                          )}× trailing average (${formatTenthsM3(
                            livePreview.spike.trailingMeanTenthsM3 ?? 0
                          )}). Reading will be flagged for leak review.`}
                        </p>
                      ) : null}

                      <div className="space-y-1 text-caption">
                        <div className="flex justify-between gap-2 text-muted">
                          <span>{`${activeConnection.category} rate (${formatTenthsM3(
                            livePreview.consumptionTenthsM3
                          )} × KSh ${livePreview.bill.ratePerM3}/m³)`}</span>
                          <span className="tabular-nums text-foreground">
                            {formatCents(livePreview.bill.volumetricKsh)}
                          </span>
                        </div>
                        {livePreview.bill.sewerageKsh > 0 && (
                          <div className="flex justify-between gap-2 text-muted">
                            <span>Sewerage levy</span>
                            <span className="tabular-nums text-foreground">
                              {formatCents(livePreview.bill.sewerageKsh)}
                            </span>
                          </div>
                        )}
                        {priorUnpaidArrearsCents > 0 ? (
                          <div className="flex justify-between gap-2 text-warning">
                            <span>Unpaid prior arrears carried forward</span>
                            <span className="tabular-nums">{formatCents(priorUnpaidArrearsCents)}</span>
                          </div>
                        ) : null}
                      </div>

                      <div className="flex items-baseline justify-between border-t border-border/35 pt-2">
                        <span className="font-medium text-foreground">Total invoice to issue</span>
                        <span className="text-section font-semibold tabular-nums text-foreground">
                          {formatCents(
                            livePreview.bill.cycleChargesKsh + priorUnpaidArrearsCents
                          )}
                        </span>
                      </div>
                    </div>
                  ) : null}

                  <div className="px-5 py-4">
                    <Button
                      type="submit"
                      tone="primary"
                      disabled={!livePreview || !livePreview.valid}
                      className="w-full"
                    >
                      Post reading & issue Nov bill
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="divide-y divide-border/35">
                  <div className="space-y-3 px-5 py-4">
                    <div className="flex items-center justify-between">
                      <span className="text-caption font-medium text-accent">
                        November 2026 reading posted
                      </span>
                      <span className="text-caption text-muted">
                        {`Read ${formatLocalDate(activeNovReading.readDate)} by ${activeNovReading.readerInitials}`}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 divide-x divide-border/35 pt-1">
                      <div className="pr-2">
                        <div className="text-caption text-muted">Prev</div>
                        <div className="text-label tabular-nums text-foreground">
                          {formatTenthsM3(activeNovReading.previousTenthsM3)}
                        </div>
                      </div>
                      <div className="px-2">
                        <div className="text-caption text-muted">Current</div>
                        <div className="text-label tabular-nums text-foreground">
                          {formatTenthsM3(activeNovReading.currentTenthsM3)}
                        </div>
                      </div>
                      <div className="pl-2">
                        <div className="text-caption text-muted">Usage</div>
                        <div
                          className={`text-label font-semibold tabular-nums ${
                            activeNovReading.isSpikeFlagged ? 'text-danger' : 'text-foreground'
                          }`}
                        >
                          {formatTenthsM3(activeNovReading.consumptionTenthsM3)}
                        </div>
                      </div>
                    </div>

                    {activeNovReading.anomalyNote ? (
                      <p className="pt-1 text-caption text-warning">
                        {`Reader note: ${activeNovReading.anomalyNote}`}
                      </p>
                    ) : null}

                    {/* Take / Attach / Retake Meter Dial Photo on Existing Reading */}
                    <div className="border-t border-border/30 pt-3">
                      <MeterCameraCapture
                        photoUrl={activeNovReading.photoUrl ?? null}
                        onPhotoCaptured={(capturedUrl) =>
                          onUpdateReadingPhoto(activeNovReading.id, capturedUrl)
                        }
                        onPhotoCleared={() => onUpdateReadingPhoto(activeNovReading.id, undefined)}
                        meterSerial={activeConnection.meterSerial}
                        premise={activeConnection.premiseAddress}
                        title="Nov 2026 Meter Dial Photo"
                      />
                    </div>

                    {activeNovInvoice ? (
                      <div className="pt-1">
                        <Button
                          tone="quiet"
                          size="sm"
                          onClick={() => onOpenInvoice(activeNovInvoice.id)}
                        >
                          {`Open ${activeNovInvoice.invoiceNumber} (${formatCents(
                            activeNovInvoice.cycleChargesKsh
                          )})`}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}

              {/* Historical Meter Register Log */}
              <div className="space-y-2 px-5 py-4">
                <h3 className="text-caption font-semibold text-muted">
                  6-cycle meter register history
                </h3>
                <div className="divide-y divide-border/25">
                  {activeAllReadings.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between gap-2 py-2 text-caption"
                    >
                      <span className="text-muted flex items-center gap-1.5">
                        <span className="font-medium text-foreground">{r.cycleId}</span>
                        {` · ${formatTenthsM3Plain(r.previousTenthsM3)} → ${formatTenthsM3Plain(
                          r.currentTenthsM3
                        )} m³`}
                        {r.photoUrl ? (
                          <button
                            type="button"
                            onClick={() => setViewingHistoryPhoto(r.photoUrl!)}
                            className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-primary hover:underline ml-1"
                            title="View attached meter dial photo for this reading"
                          >
                            <Camera className="size-3" />
                            <span>Photo</span>
                          </button>
                        ) : null}
                      </span>
                      <span
                        className={`tabular-nums font-medium ${
                          r.isSpikeFlagged ? 'text-danger' : 'text-foreground'
                        }`}
                      >
                        {formatTenthsM3(r.consumptionTenthsM3)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Surface>
          ) : null}
        </div>
      </div>

      {/* Meter Photo Full View Modal */}
      {viewingHistoryPhoto ? (
        <ModalDialog
          open={Boolean(viewingHistoryPhoto)}
          onClose={() => setViewingHistoryPhoto(null)}
          title="Verified Meter Dial Photo"
          subtitle={activeConnection ? `${activeConnection.customerName} · Meter ${activeConnection.meterSerial}` : 'Register Proof'}
          maxWidthClass="max-w-2xl"
        >
          <div className="space-y-4">
            <div className="overflow-hidden rounded-control border border-border/50 bg-black flex items-center justify-center max-h-[70vh]">
              <img
                src={viewingHistoryPhoto}
                alt="Meter Dial Reading"
                className="max-h-[70vh] w-auto object-contain"
              />
            </div>
            <div className="flex items-center justify-between text-caption text-muted">
              <span>MajiTrack Water Billing · Official cumulative register verification photo</span>
              <Button tone="quiet" size="sm" onClick={() => setViewingHistoryPhoto(null)}>
                Close
              </Button>
            </div>
          </div>
        </ModalDialog>
      ) : null}
    </div>
  );
}
