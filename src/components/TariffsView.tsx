import React, { useMemo, useState } from 'react';
import { TariffCategory, TariffSchedule } from '../types/billing';
import {
  calculateWaterBill,
  formatCents,
  formatTenthsM3,
  parseM3InputToTenths,
  parseUsdInputToCents,
} from '../lib/billingMath';
import { Button, Field, Surface } from './ui';

interface TariffsViewProps {
  tariffs: Record<TariffCategory, TariffSchedule>;
  onUpdateTariff: (category: TariffCategory, updated: TariffSchedule) => void;
  onResetDefaultTariffs: () => void;
}

export function TariffsView({
  tariffs,
  onUpdateTariff,
  onResetDefaultTariffs,
}: TariffsViewProps) {
  const [selectedClass, setSelectedClass] = useState<TariffCategory>(TariffCategory.Residential);

  // Interactive Bill Simulator state
  const [simVolumeInput, setSimVolumeInput] = useState('24.0');

  const activeSchedule = tariffs[selectedClass] ?? {
    category: selectedClass,
    ratePerM3: selectedClass === TariffCategory.Residential ? 150 : 180,
    seweragePercent: 0,
  };

  const simTenths = useMemo(() => {
    const parsed = parseM3InputToTenths(simVolumeInput);
    return parsed !== null ? parsed : 0;
  }, [simVolumeInput]);

  const simBreakdown = useMemo(() => {
    return calculateWaterBill(simTenths, activeSchedule);
  }, [simTenths, activeSchedule]);

  const handleRateChange = (rawKsh: string) => {
    const parsedKsh = parseUsdInputToCents(rawKsh);
    if (parsedKsh === null || parsedKsh < 0 || parsedKsh > 100_000) return;
    onUpdateTariff(selectedClass, {
      ...activeSchedule,
      ratePerM3: parsedKsh,
    });
  };

  const handleSewerageChange = (rawPct: string) => {
    const pct = Number(rawPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return;
    onUpdateTariff(selectedClass, {
      ...activeSchedule,
      seweragePercent: Math.round(pct),
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Select tariff class"
          className="flex flex-wrap items-center gap-1.5"
        >
          {Object.values(TariffCategory).map((cat) => {
            const active = selectedClass === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedClass(cat)}
                className={`min-h-9 cursor-pointer whitespace-nowrap rounded-control border px-3.5 text-caption font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border/45 bg-surface text-foreground hover:bg-background'
                }`}
              >
                {`${cat} (${cat === TariffCategory.Residential ? 'KSh 150/m³' : 'KSh 180/m³'})`}
              </button>
            );
          })}
        </div>

        <Button tone="quiet" size="sm" onClick={onResetDefaultTariffs}>
          Restore standard rates (KSh 150 / KSh 180)
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Editable Schedule */}
        <Surface className="divide-y divide-border/35 lg:col-span-7">
          <div className="px-5 py-4">
            <h2 className="text-section text-foreground">
              {`${selectedClass} water tariff rate`}
            </h2>
            <p className="text-caption text-muted">
              Unit water rate per cubic meter in Kenyan Shillings (KSh).
            </p>
          </div>

          <div className="space-y-4 px-5 py-5">
            <div className="max-w-xs">
              <Field
                label={`Rate per m³ (KSh)`}
                type="number"
                step="1"
                min="0"
                value={String(activeSchedule.ratePerM3)}
                onChange={(e) => handleRateChange(e.target.value)}
                hint={
                  selectedClass === TariffCategory.Residential
                    ? 'Default KSh 150 per cubic meter for household residents.'
                    : 'Default KSh 180 per cubic meter for heavy commercial/industrial clients.'
                }
                required
              />
            </div>

            <div className="max-w-xs border-t border-border/35 pt-4">
              <Field
                label="Sewerage surcharge (%)"
                type="number"
                step="1"
                min="0"
                max="100"
                value={String(activeSchedule.seweragePercent || 0)}
                onChange={(e) => handleSewerageChange(e.target.value)}
                hint="Optional surcharge applied on total water consumed (0% if none)."
              />
            </div>
          </div>
        </Surface>

        {/* Side-by-Side Live Bill Simulator */}
        <Surface className="divide-y divide-border/35 lg:col-span-5 lg:sticky lg:top-6 lg:self-start">
          <div className="px-5 py-4">
            <h2 className="text-section text-foreground">Water bill calculator</h2>
            <p className="text-caption text-muted">
              {`Estimate monthly consumption for ${selectedClass} at KSh ${activeSchedule.ratePerM3}/m³`}
            </p>
          </div>

          <div className="space-y-4 px-5 py-4">
            <Field
              label="Monthly consumption (m³)"
              type="number"
              step="0.5"
              min="0"
              max="10000"
              value={simVolumeInput}
              onChange={(e) => setSimVolumeInput(e.target.value)}
            />

            <div className="space-y-1">
              <div className="flex justify-between text-caption text-muted">
                <span>Quick volume presets</span>
                <span className="tabular-nums">{`${(simTenths * 100).toLocaleString()} liters`}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {['0.0', '10.0', '18.5', '24.0', '50.0', '100.0'].map((preset) => (
                  <Button
                    key={preset}
                    tone="quiet"
                    size="sm"
                    onClick={() => setSimVolumeInput(preset)}
                  >
                    {`${preset} m³`}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2.5 px-5 py-4 text-label">
            <div className="text-caption font-semibold text-muted">
              Computed bill statement
            </div>

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-caption text-muted">
                  {`Volumetric charge (${formatTenthsM3(simBreakdown.consumptionTenthsM3)} × KSh ${
                    activeSchedule.ratePerM3
                  }/m³)`}
                </span>
                <span className="tabular-nums font-medium text-foreground">
                  {formatCents(simBreakdown.volumetricKsh)}
                </span>
              </div>

              {simBreakdown.sewerageKsh > 0 && (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-caption text-muted">
                    {`Sewerage levy (${activeSchedule.seweragePercent}%)`}
                  </span>
                  <span className="tabular-nums text-foreground">
                    {formatCents(simBreakdown.sewerageKsh)}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-baseline justify-between border-t border-border/35 pt-3">
              <div>
                <div className="font-semibold text-foreground">Total bill</div>
                <div className="text-caption text-muted">
                  {`${formatTenthsM3(simBreakdown.consumptionTenthsM3)} metered volume`}
                </div>
              </div>
              <span className="text-title font-semibold tabular-nums text-foreground">
                {formatCents(simBreakdown.cycleChargesKsh)}
              </span>
            </div>
          </div>
        </Surface>
      </div>
    </div>
  );
}
