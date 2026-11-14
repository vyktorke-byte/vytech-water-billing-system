import React, { useEffect, useMemo, useState } from 'react';
import {
  BillingStoreState,
  ConnectionStatus,
  TariffCategory,
  WaterConnection,
} from '../types/billing';
import {
  computeLifetimePaymentSummary,
  CYCLES,
  formatCents,
  formatTenthsM3,
  formatTenthsM3Plain,
  parseM3InputToTenths,
} from '../lib/billingMath';
import { Button, Field, ModalDialog, SelectField, Surface } from './ui';
import { ArrowLeft, Edit3, Plus, Search, Trash2, UserPlus } from 'lucide-react';
import { UserHistoricalBillsTable } from './UserHistoricalBillsTable';

interface AccountsViewProps {
  state: BillingStoreState;
  addModalOpen: boolean;
  onAddModalOpenChange: (open: boolean) => void;
  onAddConnection: (
    conn: Omit<WaterConnection, 'id' | 'accountCode' | 'lastReadCycle'> & {
      accountCode?: string;
    }
  ) => void;
  onUpdateConnection: (
    id: string,
    patch: Partial<WaterConnection>
  ) => void;
  onDeleteConnection: (connectionId: string) => void;
  onOpenReadingsForConnection: (connectionId: string) => void;
  onOpenInvoicesForConnection: (invoiceId: string) => void;
}

const HALO_STYLE: React.CSSProperties = {
  paintOrder: 'stroke',
  stroke: 'var(--color-surface)',
  strokeWidth: 3.5,
  strokeLinejoin: 'round',
};

export function AccountsView({
  state,
  addModalOpen,
  onAddModalOpenChange,
  onAddConnection,
  onUpdateConnection,
  onDeleteConnection,
  onOpenReadingsForConnection,
  onOpenInvoicesForConnection,
}: AccountsViewProps) {
  const [categoryFilter, setCategoryFilter] = useState<TariffCategory | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(state.connections[0]?.id ?? null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  // Edit connection modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editAccountCode, setEditAccountCode] = useState('');
  const [editName, setEditName] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editCategory, setEditCategory] = useState<TariffCategory>(TariffCategory.Residential);
  const [editStatus, setEditStatus] = useState<ConnectionStatus>(ConnectionStatus.Active);
  const [editMeterSerial, setEditMeterSerial] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editError, setEditError] = useState('');

  // Delete confirmation modal state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Add connection form state
  const [newAccountCode, setNewAccountCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newCategory, setNewCategory] = useState<TariffCategory>(TariffCategory.Residential);
  const [newMeterSerial, setNewMeterSerial] = useState('MTR-84210');
  const [newInitialIndex, setNewInitialIndex] = useState('0.0');
  const [newPhone, setNewPhone] = useState('0712345678');
  const [newEmail, setNewEmail] = useState('');
  const [addError, setAddError] = useState('');

  const filteredConnections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return state.connections.filter((c) => {
      if (categoryFilter !== 'ALL' && c.category !== categoryFilter) return false;
      if (q) {
        const hay = `${c.customerName} ${c.accountCode} ${c.meterSerial} ${c.premiseAddress}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [state.connections, categoryFilter, searchQuery]);

  const countsByCategory = useMemo(() => {
    let res = 0;
    let heavy = 0;
    for (const c of state.connections) {
      if (c.category === TariffCategory.Residential) res += 1;
      else if (c.category === TariffCategory.HeavyClients) heavy += 1;
    }
    return { all: state.connections.length, res, heavy };
  }, [state.connections]);

  const activeConnection = useMemo(() => {
    if (selectedId) {
      const exact = state.connections.find((c) => c.id === selectedId);
      if (exact) return exact;
    }
    return filteredConnections[0] ?? null;
  }, [selectedId, state.connections, filteredConnections]);

  // Sync selectedId if connection list changes or active is removed
  useEffect(() => {
    if (!state.connections.find((c) => c.id === selectedId)) {
      setSelectedId(state.connections[0]?.id ?? null);
    }
  }, [state.connections, selectedId]);

  const latestInvoiceByConn = useMemo(() => {
    const map = new Map<string, (typeof state.invoices)[number]>();
    for (const inv of state.invoices) {
      const prev = map.get(inv.connectionId);
      if (!prev || inv.cycleId > prev.cycleId) {
        map.set(inv.connectionId, inv);
      }
    }
    return map;
  }, [state.invoices]);

  const lifetimeSummary = useMemo(() => computeLifetimePaymentSummary(state), [state]);
  const lifetimeRowByConn = useMemo(
    () => new Map(lifetimeSummary.rows.map((r) => [r.connection.id, r])),
    [lifetimeSummary.rows]
  );
  const activeLifetimeRow = activeConnection
    ? lifetimeRowByConn.get(activeConnection.id) ?? null
    : null;

  const activeCycleBars = useMemo(() => {
    if (!activeConnection) return [];
    const byCycle = new Map<string, number>();
    for (const r of state.readings) {
      if (r.connectionId === activeConnection.id) {
        byCycle.set(r.cycleId, r.consumptionTenthsM3);
      }
    }
    return CYCLES.map((c) => ({
      cycleId: c.id,
      shortLabel: c.shortLabel,
      tenthsM3: byCycle.has(c.id) ? byCycle.get(c.id)! : null,
    }));
  }, [state.readings, activeConnection]);

  // Open Edit Modal with current active connection values
  const handleOpenEdit = () => {
    if (!activeConnection) return;
    setEditAccountCode(activeConnection.accountCode);
    setEditName(activeConnection.customerName);
    setEditAddress(activeConnection.premiseAddress);
    setEditCategory(activeConnection.category);
    setEditStatus(activeConnection.status);
    setEditMeterSerial(activeConnection.meterSerial);
    setEditPhone(activeConnection.phone);
    setEditEmail(activeConnection.email);
    setEditError('');
    setEditModalOpen(true);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConnection) return;
    const cleanAccountCode = editAccountCode.trim().toUpperCase();
    if (!cleanAccountCode || !editName.trim() || !editAddress.trim() || !editMeterSerial.trim()) {
      setEditError('Account reference code, customer name, premise address, and meter serial are required.');
      return;
    }

    const duplicateAccount = state.connections.some(
      (c) =>
        c.id !== activeConnection.id &&
        c.accountCode.toLowerCase() === cleanAccountCode.toLowerCase()
    );
    if (duplicateAccount) {
      setEditError(`Account reference ${cleanAccountCode} is already assigned to another client.`);
      return;
    }

    // Check duplicate meter serial against other connections
    const duplicate = state.connections.some(
      (c) =>
        c.id !== activeConnection.id &&
        c.meterSerial.toLowerCase() === editMeterSerial.trim().toLowerCase()
    );
    if (duplicate) {
      setEditError(`Meter serial ${editMeterSerial.trim()} is already assigned to another client.`);
      return;
    }

    onUpdateConnection(activeConnection.id, {
      accountCode: cleanAccountCode,
      customerName: editName.trim(),
      premiseAddress: editAddress.trim(),
      category: editCategory,
      status: editStatus,
      meterSerial: editMeterSerial.trim().toUpperCase(),
      phone: editPhone.trim() || '0712000000',
      email: editEmail.trim() || 'billing@example.com',
    });

    setEditModalOpen(false);
  };

  const handleDeleteClient = () => {
    if (!activeConnection) return;
    onDeleteConnection(activeConnection.id);
    setDeleteConfirmOpen(false);
    setMobileDetailOpen(false);
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newAddress.trim() || !newMeterSerial.trim()) {
      setAddError('Customer name, premise address, and meter serial are required.');
      return;
    }
    const cleanAccount = newAccountCode.trim().toUpperCase();
    if (cleanAccount) {
      const duplicateAccount = state.connections.some(
        (c) => c.accountCode.toLowerCase() === cleanAccount.toLowerCase()
      );
      if (duplicateAccount) {
        setAddError(`Account reference ${cleanAccount} is already in use.`);
        return;
      }
    }
    const tenths = parseM3InputToTenths(newInitialIndex);
    if (tenths === null) {
      setAddError('Enter a valid non-negative initial meter reading in m³.');
      return;
    }
    const duplicateSerial = state.connections.some(
      (c) => c.meterSerial.toLowerCase() === newMeterSerial.trim().toLowerCase()
    );
    if (duplicateSerial) {
      setAddError(`Meter serial ${newMeterSerial.trim()} is already assigned to another premise.`);
      return;
    }

    onAddConnection({
      accountCode: cleanAccount || undefined,
      customerName: newName.trim(),
      premiseAddress: newAddress.trim(),
      category: newCategory,
      meterSerial: newMeterSerial.trim().toUpperCase(),
      status: ConnectionStatus.Active,
      phone: newPhone.trim() || '0712000000',
      email: newEmail.trim() || 'billing@example.com',
      lastReadingTenthsM3: tenths,
    });

    setNewAccountCode('');
    setNewName('');
    setNewAddress('');
    setNewMeterSerial(`MTR-${Math.floor(84220 + Math.random() * 700)}`);
    setNewInitialIndex('0.0');
    setNewEmail('');
    setAddError('');
    onAddModalOpenChange(false);
  };

  const categoryChips: { id: TariffCategory | 'ALL'; label: string; count: number }[] = [
    { id: 'ALL', label: 'All clients', count: countsByCategory.all },
    { id: TariffCategory.Residential, label: 'Residents (KSh 150/m³)', count: countsByCategory.res },
    { id: TariffCategory.HeavyClients, label: 'Heavy Clients (KSh 180/m³)', count: countsByCategory.heavy },
  ];

  const maxBarTenths = Math.max(
    ...activeCycleBars.map((b) => b.tenthsM3 ?? 0),
    100
  );

  return (
    <div className="space-y-5">
      {/* Filter Controls & Client Registration Trigger */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Filter accounts by tariff class"
          className="flex flex-wrap items-center gap-1.5"
        >
          {categoryChips.map((chip) => {
            const active = categoryFilter === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => setCategoryFilter(chip.id)}
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
              aria-label="Search accounts by customer, code, or meter"
              placeholder="Search VW-... or premise"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="min-h-10 w-full rounded-control border border-border/55 bg-surface pr-3 pl-9 text-label text-foreground placeholder:text-muted/75 focus-visible:outline-2 focus-visible:outline-primary"
            />
          </div>

          <Button tone="primary" size="sm" onClick={() => onAddModalOpenChange(true)}>
            <Plus className="size-4" />
            Add client
          </Button>
        </div>
      </div>

      {/* Lifetime Paid vs Not Paid Summary Strip */}
      <Surface>
        <div className="grid grid-cols-2 divide-x divide-y divide-border/35 sm:grid-cols-4 sm:divide-y-0">
          <div className="px-4 py-3">
            <div className="text-caption text-muted">Paid in full (lifetime)</div>
            <div className="mt-0.5 text-section font-semibold tabular-nums text-accent">
              {`${lifetimeSummary.accountsPaidInFullCount} accounts`}
            </div>
            <div className="text-[11px] text-muted">
              {`${lifetimeSummary.accountsWithAnyPaymentCount} clients have paid`}
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="text-caption text-muted">Not paid / open balance</div>
            <div
              className={`mt-0.5 text-section font-semibold tabular-nums ${
                lifetimeSummary.accountsNotPaidCount > 0 ? 'text-danger' : 'text-foreground'
              }`}
            >
              {`${lifetimeSummary.accountsNotPaidCount} accounts`}
            </div>
            <div className="text-[11px] text-muted">
              {`${lifetimeSummary.totalUnpaidInvoicesLifetime} unpaid bills (${lifetimeSummary.accountsNeverPaidCount} never paid)`}
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="text-caption text-muted">Lifetime cash collected</div>
            <div className="mt-0.5 text-section font-semibold tabular-nums text-foreground">
              {formatCents(lifetimeSummary.totalLifetimeCollectedKsh)}
            </div>
            <div className="text-[11px] text-muted">
              {`${lifetimeSummary.totalPaidInvoicesLifetime} settled bills`}
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="text-caption text-muted">Lifetime unpaid balance</div>
            <div
              className={`mt-0.5 text-section font-semibold tabular-nums ${
                lifetimeSummary.totalLifetimeOutstandingKsh > 0 ? 'text-danger' : 'text-accent'
              }`}
            >
              {formatCents(lifetimeSummary.totalLifetimeOutstandingKsh)}
            </div>
            <div className="text-[11px] text-muted">Cumulative open receivables</div>
          </div>
        </div>
      </Surface>

      {/* Master-Detail */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Surface
          className={`divide-y divide-border/35 lg:col-span-7 ${
            mobileDetailOpen && activeConnection ? 'hidden lg:block' : 'block'
          }`}
        >
          {filteredConnections.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <UserPlus className="mx-auto size-10 text-muted opacity-60 mb-3" />
              <p className="text-section text-foreground">No clients found</p>
              <p className="mt-1 text-caption text-muted">
                {state.connections.length === 0
                  ? 'Your system is currently fresh and clean with 0 records. Add your first water client to get started.'
                  : 'No client records match the selected filters or search query.'}
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                <Button tone="primary" size="sm" onClick={() => onAddModalOpenChange(true)}>
                  <Plus className="size-4" />
                  Add client
                </Button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-border/35 text-caption font-semibold uppercase tracking-wider text-muted">
                    <th className="px-4 py-3">Account & premise</th>
                    <th className="px-4 py-3">Meter & class</th>
                    <th className="px-4 py-3 text-right">Balance (KSh)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30 text-body">
                  {filteredConnections.map((conn) => {
                    const isSelected = activeConnection?.id === conn.id;
                    const latestInv = latestInvoiceByConn.get(conn.id);
                    const openBalanceKsh = latestInv
                      ? Math.max(0, latestInv.totalPayableKsh - latestInv.amountPaidKsh)
                      : 0;

                    return (
                      <tr
                        key={conn.id}
                        onClick={() => {
                          setSelectedId(conn.id);
                          setMobileDetailOpen(true);
                        }}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-primary/6' : 'hover:bg-background/60'
                        }`}
                      >
                        <td className="px-4 py-3.5">
                          <div className="font-medium text-foreground">{conn.customerName}</div>
                          <div className="mt-0.5 text-caption text-muted">
                            <span className="font-mono text-foreground/85">{conn.accountCode}</span>
                            {` · ${conn.premiseAddress}`}
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="text-label text-foreground">
                            <span className="inline-block size-2 rounded-xs bg-accent mr-1.5 align-middle" />
                            {conn.category}
                          </div>
                          <div className="mt-0.5 text-caption text-muted">
                            <span className="font-mono">{conn.meterSerial}</span>
                            {` · `}
                            <span
                              className={
                                conn.status === ConnectionStatus.Suspended
                                  ? 'font-medium text-danger'
                                  : 'text-accent'
                              }
                            >
                              {conn.status}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-right tabular-nums">
                          <div
                            className={`font-medium ${
                              openBalanceKsh > 0 ? 'text-foreground' : 'text-muted'
                            }`}
                          >
                            {formatCents(openBalanceKsh)}
                          </div>
                          <div className="text-caption text-muted">
                            {`Idx ${formatTenthsM3(conn.lastReadingTenthsM3)}`}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Surface>

        {/* Connection Detail Pane */}
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
                  Back to accounts
                </Button>
              </div>

              {/* Customer Header & Edit/Delete triggers */}
              <div className="space-y-2 px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-caption text-muted">
                      {`${activeConnection.accountCode} · ${activeConnection.meterSerial}`}
                    </div>
                    <h2 className="text-section text-foreground">
                      {activeConnection.customerName}
                    </h2>
                    <p className="text-caption text-muted">
                      {activeConnection.premiseAddress}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span
                      className={`text-caption font-medium ${
                        activeConnection.status === ConnectionStatus.Suspended
                          ? 'text-danger'
                          : 'text-accent'
                      }`}
                    >
                      {activeConnection.status}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        tone="quiet"
                        size="sm"
                        onClick={handleOpenEdit}
                        title="Edit client details"
                      >
                        <Edit3 className="size-3.5" />
                        Edit
                      </Button>
                      <Button
                        tone="danger"
                        size="sm"
                        onClick={() => setDeleteConfirmOpen(true)}
                        title="Delete client permanently"
                      >
                        <Trash2 className="size-3.5" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="text-caption text-muted border-t border-border/25 pt-2">
                  <span>{`Tariff: ${activeConnection.category} (${
                    activeConnection.category === TariffCategory.Residential ? 'KSh 150/m³' : 'KSh 180/m³'
                  })`}</span>
                  {' · '}
                  <span>{`Contact: ${activeConnection.phone} · ${activeConnection.email}`}</span>
                </div>
              </div>

              {/* 6-Cycle Consumption Profile SVG */}
              <div className="space-y-2 px-5 py-4">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-caption font-semibold text-muted">
                    6-cycle consumption profile (m³)
                  </h3>
                  <span className="text-caption text-muted">
                    {`Register ${formatTenthsM3(activeConnection.lastReadingTenthsM3)}`}
                  </span>
                </div>

                <svg
                  viewBox="0 0 360 116"
                  role="img"
                  aria-label={`Monthly water consumption bars for ${activeConnection.customerName}`}
                  className="h-auto w-full select-none"
                >
                  <line
                    x1={12}
                    y1={88}
                    x2={348}
                    y2={88}
                    stroke="var(--color-border)"
                    strokeOpacity={0.45}
                    strokeWidth={1}
                  />
                  {activeCycleBars.map((bar, idx) => {
                    const slotW = 336 / 6;
                    const cx = 12 + slotW * idx + slotW / 2;
                    const barW = 28;
                    const hasData = bar.tenthsM3 !== null;
                    const h = hasData
                      ? Math.max(2, ((bar.tenthsM3 ?? 0) / maxBarTenths) * 64)
                      : 0;
                    const y = Math.round((88 - h) * 10) / 10;

                    return (
                      <g key={bar.cycleId}>
                        {hasData ? (
                          <>
                            <rect
                              x={Math.round(cx - barW / 2)}
                              y={y}
                              width={barW}
                              height={Math.round(h * 10) / 10}
                              rx={2}
                              fill="var(--color-primary)"
                              fillOpacity={0.78}
                            />
                            <text
                              x={Math.round(cx)}
                              y={Math.max(14, y - 5)}
                              textAnchor="middle"
                              fill="var(--color-foreground)"
                              fontSize={10}
                              style={HALO_STYLE}
                            >
                              {formatTenthsM3Plain(bar.tenthsM3!)}
                            </text>
                          </>
                        ) : (
                          <text
                            x={Math.round(cx)}
                            y={78}
                            textAnchor="middle"
                            fill="var(--color-muted)"
                            fontSize={9.5}
                            style={HALO_STYLE}
                          >
                            No data
                          </text>
                        )}
                        <text
                          x={Math.round(cx)}
                          y={105}
                          textAnchor="middle"
                          fill="var(--color-muted)"
                          fontSize={10.5}
                          style={HALO_STYLE}
                        >
                          {bar.shortLabel}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>

              {/* Historical Water Bills Table Section */}
              <div className="space-y-3 px-5 py-4">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-caption font-semibold text-muted">
                    Historical water bills
                  </h3>
                  <span className="text-caption text-muted">
                    Date · Amount paid (KSh) · Payment status
                  </span>
                </div>
                {activeLifetimeRow ? (
                  <div className="grid grid-cols-3 divide-x divide-border/35 rounded-control border border-border/35 bg-background/50">
                    <div className="px-3 py-2">
                      <div className="text-[11px] text-muted">Lifetime paid</div>
                      <div className="text-label font-semibold tabular-nums text-accent">
                        {formatCents(activeLifetimeRow.lifetimePaidKsh)}
                      </div>
                    </div>
                    <div className="px-3 py-2">
                      <div className="text-[11px] text-muted">Bills paid</div>
                      <div className="text-label font-semibold tabular-nums text-foreground">
                        {`${activeLifetimeRow.paidBillsCount} / ${activeLifetimeRow.totalBillsCount}`}
                      </div>
                    </div>
                    <div className="px-3 py-2">
                      <div className="text-[11px] text-muted">Unpaid bills</div>
                      <div
                        className={`text-label font-semibold tabular-nums ${
                          activeLifetimeRow.unpaidBillsCount > 0 ? 'text-danger' : 'text-accent'
                        }`}
                      >
                        {`${activeLifetimeRow.unpaidBillsCount} (${formatCents(
                          activeLifetimeRow.currentBalanceKsh
                        )})`}
                      </div>
                    </div>
                  </div>
                ) : null}
                <UserHistoricalBillsTable
                  connection={activeConnection}
                  invoices={state.invoices}
                  payments={state.payments}
                  onViewInvoice={onOpenInvoicesForConnection}
                />
              </div>

              {/* Editable Service Parameters */}
              <div className="px-5 py-4 max-w-xs">
                <SelectField
                  label="Tariff classification"
                  value={activeConnection.category}
                  onChange={(e) =>
                    onUpdateConnection(activeConnection.id, {
                      category: e.target.value as TariffCategory,
                    })
                  }
                >
                  <option value={TariffCategory.Residential}>
                    Residents (KSh 150/m³)
                  </option>
                  <option value={TariffCategory.HeavyClients}>
                    Heavy Clients (KSh 180/m³)
                  </option>
                </SelectField>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    tone="quiet"
                    size="sm"
                    onClick={() => onOpenReadingsForConnection(activeConnection.id)}
                  >
                    Meter readings
                  </Button>
                  {latestInvoiceByConn.get(activeConnection.id) ? (
                    <Button
                      tone="quiet"
                      size="sm"
                      onClick={() =>
                        onOpenInvoicesForConnection(
                          latestInvoiceByConn.get(activeConnection.id)!.id
                        )
                      }
                    >
                      Latest bill
                    </Button>
                  ) : null}
                </div>

                <Button
                  tone={
                    activeConnection.status === ConnectionStatus.Active ? 'danger' : 'accent'
                  }
                  size="sm"
                  onClick={() =>
                    onUpdateConnection(activeConnection.id, {
                      status:
                        activeConnection.status === ConnectionStatus.Active
                          ? ConnectionStatus.Suspended
                          : ConnectionStatus.Active,
                    })
                  }
                >
                  {activeConnection.status === ConnectionStatus.Active
                    ? 'Suspend valve'
                    : 'Restore supply'}
                </Button>
              </div>
            </Surface>
          ) : (
            <Surface className="p-8 text-center text-muted">
              <p>Select a client from the table to view details.</p>
            </Surface>
          )}
        </div>
      </div>

      {/* Edit Client Modal */}
      <ModalDialog
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title="Edit Client Account"
        subtitle={activeConnection ? `${activeConnection.accountCode} · ${activeConnection.customerName}` : undefined}
        maxWidthClass="max-w-xl"
      >
        <form onSubmit={handleEditSubmit} className="space-y-4">
          {editError ? (
            <p role="alert" className="text-caption font-medium text-danger">
              {editError}
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Paybill Account Ref (Code)"
              value={editAccountCode}
              onChange={(e) => {
                setEditAccountCode(e.target.value.toUpperCase());
                setEditError('');
              }}
              placeholder="e.g. VW-1048 or HSE-101"
              required
            />
            <Field
              label="Customer or business name"
              value={editName}
              onChange={(e) => {
                setEditName(e.target.value);
                setEditError('');
              }}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field
              label="Premise street address"
              value={editAddress}
              onChange={(e) => {
                setEditAddress(e.target.value);
                setEditError('');
              }}
              required
            />
            <SelectField
              label="Tariff class"
              value={editCategory}
              onChange={(e) => setEditCategory(e.target.value as TariffCategory)}
            >
              <option value={TariffCategory.Residential}>Residents (KSh 150/m³)</option>
              <option value={TariffCategory.HeavyClients}>Heavy Clients (KSh 180/m³)</option>
            </SelectField>
            <SelectField
              label="Supply status"
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value as ConnectionStatus)}
            >
              <option value={ConnectionStatus.Active}>Active</option>
              <option value={ConnectionStatus.Suspended}>Suspended</option>
            </SelectField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field
              label="Meter serial number"
              value={editMeterSerial}
              onChange={(e) => {
                setEditMeterSerial(e.target.value);
                setEditError('');
              }}
              required
            />
            <Field
              label="Contact phone"
              type="tel"
              value={editPhone}
              onChange={(e) => setEditPhone(e.target.value)}
            />
            <Field
              label="Billing email"
              type="email"
              value={editEmail}
              onChange={(e) => setEditEmail(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
            <Button tone="quiet" onClick={() => setEditModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" tone="primary">
              Save changes
            </Button>
          </div>
        </form>
      </ModalDialog>

      {/* Delete Permanent Confirmation Modal */}
      <ModalDialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title="Permanently Delete Client?"
        subtitle="This action will delete the client account and remove their registered meter readings, invoices, and payment history."
        maxWidthClass="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-body text-foreground">
            Are you sure you want to permanently remove client{' '}
            <strong className="text-danger">{activeConnection?.customerName}</strong> ({activeConnection?.accountCode})?
          </p>
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <Button tone="quiet" onClick={() => setDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button tone="danger" onClick={handleDeleteClient}>
              <Trash2 className="size-4" />
              Delete permanently
            </Button>
          </div>
        </div>
      </ModalDialog>

      {/* Add Connection Modal */}
      <ModalDialog
        open={addModalOpen}
        onClose={() => onAddModalOpenChange(false)}
        title="Register new water client"
        subtitle="Assign a physical meter serial and tariff rate class."
        maxWidthClass="max-w-xl"
      >
        <form onSubmit={handleAddSubmit} className="space-y-4">
          {addError ? (
            <p role="alert" className="text-caption font-medium text-danger">
              {addError}
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Customer or business name"
              placeholder="e.g. Samuel Mutua"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setAddError('');
              }}
              autoFocus
              required
            />
            <Field
              label="Premise street address"
              placeholder="e.g. 92 Summit Rd"
              value={newAddress}
              onChange={(e) => {
                setNewAddress(e.target.value);
                setAddError('');
              }}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Paybill Account Ref (optional)"
              placeholder="Auto-generated e.g. VW-1150"
              value={newAccountCode}
              onChange={(e) => {
                setNewAccountCode(e.target.value.toUpperCase());
                setAddError('');
              }}
            />
            <SelectField
              label="Tariff class"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value as TariffCategory)}
            >
              <option value={TariffCategory.Residential}>Residents (KSh 150/m³)</option>
              <option value={TariffCategory.HeavyClients}>Heavy Clients (KSh 180/m³)</option>
            </SelectField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Meter serial number"
              value={newMeterSerial}
              onChange={(e) => {
                setNewMeterSerial(e.target.value);
                setAddError('');
              }}
              required
            />
            <Field
              label="Initial register index (m³)"
              type="number"
              step="0.1"
              min="0"
              value={newInitialIndex}
              onChange={(e) => {
                setNewInitialIndex(e.target.value);
                setAddError('');
              }}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Contact phone (M-Pesa / SMS)"
              type="tel"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
            />
            <Field
              label="Billing email"
              type="email"
              placeholder="client@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
            <Button tone="quiet" onClick={() => onAddModalOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" tone="primary">
              Save client
            </Button>
          </div>
        </form>
      </ModalDialog>

    </div>
  );
}

