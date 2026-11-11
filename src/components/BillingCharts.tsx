import React, { useState } from 'react';
import { BillingCycleId, SupplyZone } from '../types/billing';
import { formatCentsCompact, formatTenthsM3Plain } from '../lib/billingMath';

export interface CycleChartDatum {
  cycleId: BillingCycleId;
  shortLabel: string;
  billedCents: number;
  collectedCents: number;
  consumptionTenthsM3: number;
  isSelected: boolean;
}

const HALO_STYLE: React.CSSProperties = {
  paintOrder: 'stroke',
  stroke: 'var(--color-surface)',
  strokeWidth: 4,
  strokeLinejoin: 'round',
};

function computeNiceCeiling(maxVal: number): number {
  if (maxVal <= 0) return 100;
  const magnitude = Math.pow(10, Math.floor(Math.log10(maxVal)));
  const normalized = maxVal / magnitude;
  let step = 1;
  if (normalized <= 1.2) step = 1.2;
  else if (normalized <= 1.5) step = 1.5;
  else if (normalized <= 2) step = 2;
  else if (normalized <= 2.5) step = 2.5;
  else if (normalized <= 3) step = 3;
  else if (normalized <= 4) step = 4;
  else if (normalized <= 5) step = 5;
  else if (normalized <= 6) step = 6;
  else if (normalized <= 8) step = 8;
  else step = 10;
  return step * magnitude;
}

export function CycleTrendChart({
  data,
  onSelectCycle,
}: {
  data: CycleChartDatum[];
  onSelectCycle?: (cycleId: BillingCycleId) => void;
}) {
  const [metricMode, setMetricMode] = useState<'revenue' | 'volume'>('revenue');

  const W = 660;
  const H = 264;
  const padLeft = 72;
  const padRight = 18;
  const padTop = 20;
  const padBottom = 40;
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;
  const baselineY = padTop + plotH;

  const rawMax =
    metricMode === 'revenue'
      ? Math.max(...data.map((d) => Math.max(d.billedCents, d.collectedCents)), 10_000)
      : Math.max(...data.map((d) => d.consumptionTenthsM3), 1000);

  const ceiling = computeNiceCeiling(rawMax * 1.08);
  const tickCount = 4;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => (ceiling * i) / tickCount);

  const slotW = plotW / Math.max(data.length, 1);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-section text-foreground">Monthly billing & collection history</h2>
          <p className="text-caption text-muted">
            {metricMode === 'revenue'
              ? 'Cycle charges billed vs payments posted (KSh) · 1-month interval'
              : 'Metered potable water delivered across connections (m³) · 1-month interval'}
          </p>
        </div>

        <div
          role="group"
          aria-label="Chart metric"
          className="inline-flex flex-wrap rounded-control border border-border/45 bg-background p-0.5"
        >
          <button
            type="button"
            onClick={() => setMetricMode('revenue')}
            className={`min-h-8 cursor-pointer whitespace-nowrap rounded-control px-3 text-caption font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
              metricMode === 'revenue'
                ? 'bg-surface text-foreground shadow-surface'
                : 'text-muted hover:text-foreground'
            }`}
          >
            Revenue (KSh)
          </button>
          <button
            type="button"
            onClick={() => setMetricMode('volume')}
            className={`min-h-8 cursor-pointer whitespace-nowrap rounded-control px-3 text-caption font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
              metricMode === 'volume'
                ? 'bg-surface text-foreground shadow-surface'
                : 'text-muted hover:text-foreground'
            }`}
          >
            Volume (m³)
          </button>
        </div>
      </div>

      {metricMode === 'revenue' ? (
        <div className="flex flex-wrap items-center gap-5 text-caption text-muted">
          <span className="inline-flex items-center gap-2">
            <span className="inline-block size-2.5 rounded-xs bg-primary/30 ring-1 ring-primary/60" />
            Cycle billed (KSh)
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="inline-block size-2.5 rounded-xs bg-accent" />
            Payments collected (KSh)
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-5 text-caption text-muted">
          <span className="inline-flex items-center gap-2">
            <span className="inline-block size-2.5 rounded-xs bg-primary" />
            Metered consumption (m³)
          </span>
        </div>
      )}

      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={
          metricMode === 'revenue'
            ? 'Bar chart comparing monthly billed water charges and collected payments in Kenyan Shillings from June 2026 to November 2026'
            : 'Bar chart of monthly metered water consumption in cubic meters from June 2026 to November 2026'
        }
        className="h-auto w-full select-none"
      >
        {/* Horizontal gridlines and Y-axis ticks */}
        {ticks.map((tickVal, idx) => {
          const y = Math.round((baselineY - (tickVal / ceiling) * plotH) * 10) / 10;
          const label =
            metricMode === 'revenue'
              ? formatCentsCompact(tickVal)
              : `${formatTenthsM3Plain(tickVal)} m³`;
          return (
            <g key={idx}>
              <line
                x1={padLeft}
                y1={y}
                x2={W - padRight}
                y2={y}
                stroke="var(--color-border)"
                strokeOpacity={idx === 0 ? 0.55 : 0.2}
                strokeWidth={1}
              />
              <text
                x={padLeft - 10}
                y={y + 4}
                textAnchor="end"
                fill="var(--color-muted)"
                fontSize={11.5}
                style={HALO_STYLE}
              >
                {label}
              </text>
            </g>
          );
        })}

        {/* Bars per monthly cycle */}
        {data.map((d, idx) => {
          const centerX = padLeft + slotW * idx + slotW / 2;
          const labelY = baselineY + 22;

          if (metricMode === 'revenue') {
            const barW = 22;
            const gap = 4;
            const billedH = Math.max(0, (d.billedCents / ceiling) * plotH);
            const collectedH = Math.max(0, (d.collectedCents / ceiling) * plotH);
            const billedX = Math.round(centerX - barW - gap / 2);
            const collectedX = Math.round(centerX + gap / 2);
            const billedY = Math.round((baselineY - billedH) * 10) / 10;
            const collectedY = Math.round((baselineY - collectedH) * 10) / 10;

            return (
              <g
                key={d.cycleId}
                onClick={() => onSelectCycle?.(d.cycleId)}
                className={onSelectCycle ? 'cursor-pointer' : undefined}
              >
                {d.isSelected ? (
                  <rect
                    x={Math.round(padLeft + slotW * idx + 8)}
                    y={padTop}
                    width={Math.round(slotW - 16)}
                    height={plotH}
                    rx={4}
                    fill="var(--color-primary)"
                    fillOpacity={0.045}
                  />
                ) : null}

                <rect
                  x={billedX}
                  y={billedY}
                  width={barW}
                  height={Math.round(billedH * 10) / 10}
                  rx={2}
                  fill="var(--color-primary)"
                  fillOpacity={0.25}
                  stroke="var(--color-primary)"
                  strokeOpacity={0.55}
                  strokeWidth={1}
                >
                  <title>{`${d.shortLabel} billed: ${formatCentsCompact(d.billedCents)}`}</title>
                </rect>

                <rect
                  x={collectedX}
                  y={collectedY}
                  width={barW}
                  height={Math.round(collectedH * 10) / 10}
                  rx={2}
                  fill="var(--color-accent)"
                >
                  <title>{`${d.shortLabel} collected: ${formatCentsCompact(d.collectedCents)}`}</title>
                </rect>

                <text
                  x={Math.round(centerX)}
                  y={labelY}
                  textAnchor="middle"
                  fill={d.isSelected ? 'var(--color-foreground)' : 'var(--color-muted)'}
                  fontWeight={d.isSelected ? 600 : 400}
                  fontSize={12}
                  style={HALO_STYLE}
                >
                  {d.shortLabel}
                </text>
              </g>
            );
          }

          const singleW = 34;
          const volH = Math.max(0, (d.consumptionTenthsM3 / ceiling) * plotH);
          const volX = Math.round(centerX - singleW / 2);
          const volY = Math.round((baselineY - volH) * 10) / 10;

          return (
            <g
              key={d.cycleId}
              onClick={() => onSelectCycle?.(d.cycleId)}
              className={onSelectCycle ? 'cursor-pointer' : undefined}
            >
              {d.isSelected ? (
                <rect
                  x={Math.round(padLeft + slotW * idx + 8)}
                  y={padTop}
                  width={Math.round(slotW - 16)}
                  height={plotH}
                  rx={4}
                  fill="var(--color-primary)"
                  fillOpacity={0.045}
                />
              ) : null}

              <rect
                x={volX}
                y={volY}
                width={singleW}
                height={Math.round(volH * 10) / 10}
                rx={2}
                fill={d.isSelected ? 'var(--color-primary)' : 'var(--color-primary)'}
                fillOpacity={d.isSelected ? 0.92 : 0.68}
              >
                <title>{`${d.shortLabel} delivered: ${formatTenthsM3Plain(d.consumptionTenthsM3)} m³`}</title>
              </rect>

              <text
                x={Math.round(centerX)}
                y={labelY}
                textAnchor="middle"
                fill={d.isSelected ? 'var(--color-foreground)' : 'var(--color-muted)'}
                fontWeight={d.isSelected ? 600 : 400}
                fontSize={12}
                style={HALO_STYLE}
              >
                {d.shortLabel}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export interface ZoneSummaryNode {
  zone: SupplyZone;
  connectionsCount: number;
  consumptionTenthsM3: number;
  billedCents: number;
  collectedCents: number;
  overdueCount: number;
}

interface SchematicCoord {
  zone: SupplyZone;
  cx: number;
  cy: number;
  labelX: number;
  labelY: number;
  subY: number;
  anchor: 'start' | 'middle' | 'end';
}

const ZONE_COORDS: SchematicCoord[] = [
  {
    zone: SupplyZone.OldBuilding,
    cx: 210,
    cy: 54,
    labelX: 228,
    labelY: 50,
    subY: 66,
    anchor: 'start',
  },
  {
    zone: SupplyZone.NewBuilding,
    cx: 210,
    cy: 164,
    labelX: 228,
    labelY: 160,
    subY: 176,
    anchor: 'start',
  },
  {
    zone: SupplyZone.HeavyConsumer,
    cx: 440,
    cy: 109,
    labelX: 458,
    labelY: 105,
    subY: 121,
    anchor: 'start',
  },
];

// Verify non-overlapping label & node bounding boxes at module initialization (Section 5 requirement)
(function verifySchematicNonOverlap() {
  const boxes = ZONE_COORDS.map((n) => ({
    x1: n.cx - 12,
    y1: n.cy - 16,
    x2: n.labelX + 145,
    y2: n.subY + 8,
  }));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlaps = a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
      if (overlaps) {
        console.error('Schematic zone bounding boxes overlap:', i, j);
      }
    }
  }
})();

export function ZoneNetworkMap({
  zones,
  onSelectZone,
}: {
  zones: ZoneSummaryNode[];
  onSelectZone: (zone: SupplyZone) => void;
}) {
  const byZone = new Map(zones.map((z) => [z.zone, z]));

  return (
    <svg
      viewBox="0 0 620 218"
      role="img"
      aria-label="District metered area supply trunk schematic showing Reservoir intake feeding Old Building, New Building, and Heavy Consumer zones"
      className="h-auto w-full select-none"
    >
      {/* Main trunk lines */}
      <path
        d="M 62 109 L 155 109 M 155 54 L 155 164 M 155 54 L 210 54 M 155 164 L 210 164 M 155 109 L 440 109"
        fill="none"
        stroke="var(--color-border)"
        strokeOpacity={0.65}
        strokeWidth={2.25}
        strokeLinecap="round"
      />

      {/* Reservoir source node */}
      <rect
        x={28}
        y={91}
        width={34}
        height={36}
        rx={5}
        fill="var(--color-primary)"
      />
      <text
        x={45}
        y={113}
        textAnchor="middle"
        fill="var(--color-primary-foreground)"
        fontSize={10.5}
        fontWeight={600}
      >
        WTP
      </text>
      <text
        x={45}
        y={146}
        textAnchor="middle"
        fill="var(--color-muted)"
        fontSize={11}
        style={HALO_STYLE}
      >
        Intake main
      </text>

      {/* District Metered Area nodes */}
      {ZONE_COORDS.map((coord) => {
        const summary = byZone.get(coord.zone);
        const m3Text = summary ? `${formatTenthsM3Plain(summary.consumptionTenthsM3)} m³` : '0.0 m³';
        const hasOverdue = (summary?.overdueCount ?? 0) > 0;

        return (
          <g
            key={coord.zone}
            onClick={() => onSelectZone(coord.zone)}
            className="cursor-pointer"
          >
            <circle
              cx={coord.cx}
              cy={coord.cy}
              r={9.5}
              fill="var(--color-surface)"
              stroke={hasOverdue ? 'var(--color-warning)' : 'var(--color-accent)'}
              strokeWidth={3}
            />
            <circle
              cx={coord.cx}
              cy={coord.cy}
              r={3.5}
              fill={hasOverdue ? 'var(--color-warning)' : 'var(--color-accent)'}
            />
            <text
              x={coord.labelX}
              y={coord.labelY}
              textAnchor={coord.anchor}
              fill="var(--color-foreground)"
              fontSize={12.5}
              fontWeight={600}
              style={HALO_STYLE}
            >
              {coord.zone}
            </text>
            <text
              x={coord.labelX}
              y={coord.subY}
              textAnchor={coord.anchor}
              fill="var(--color-muted)"
              fontSize={11.5}
              style={HALO_STYLE}
            >
              {`${m3Text} · ${summary?.connectionsCount ?? 0} meters`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
