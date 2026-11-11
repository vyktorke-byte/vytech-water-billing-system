import React, { useEffect, useMemo, useState } from 'react';
import {
  BillingStoreState,
  ConnectionStatus,
  SupplyZone,
  TariffCategory,
  WaterConnection,
} from '../types/billing';
import {
  CYCLES,
  formatCents,
  formatTenthsM3,
  formatTenthsM3Plain,
  parseM3InputToTenths,
} from '../lib/billingMath';
import { Button, Field, ModalDialog, SelectField, Surface } from './ui';
import { ArrowLeft, Building2, Edit3, Plus, Search, Trash2, UserPlus, Zap } from 'lucide-react';
import { UserHistoricalBillsTable } from './UserHistoricalBillsTable';

interface AccountsViewProps {
  state: BillingStoreState;
  addModalOpen: boolean;
  onAddModalOpenChange: (open: boolean) => void;
  onAddConnection: (conn: Omit<WaterConnection, 'id' | 'accountCode' | 'lastReadCycle'>) => void;
  onBatchAddConnections?: (conns: Omit<WaterConnection, 'id' | 'accountCode' | 'lastReadCycle'>[]) => void;
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
  onBatchAddConnections,
  onUpdateConnection,
  onDeleteConnection,
  onOpenReadingsForConnection,
  onOpenInvoicesForConnection,
}: AccountsViewProps) {
  const [categoryFilter, setCategoryFilter] = useState<TariffCategory | 'ALL'>('ALL');
  const [zoneFilter, setZoneFilter] = useState<SupplyZone | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(state.connections[0]?.id ?? null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  // Edit connection modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editZone, setEditZone] = useState<SupplyZone>(SupplyZone.OldBuilding);
  const [editCategory, setEditCategory] = useState<TariffCategory>(TariffCategory.Residential);
  const [editMeterSerial, setEditMeterSerial] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editError, setEditError] = useState('');

  // Delete confirmation modal state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Add connection form state
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newZone, setNewZone] = useState<SupplyZone>(SupplyZone.OldBuilding);
  const [newCategory, setNewCategory] = useState<TariffCategory>(TariffCategory.Residential);
  const [newMeterSerial, setNewMeterSerial] = useState('MTR-84210');
  const [newInitialIndex, setNewInitialIndex] = useState('0.0');
  const [newPhone, setNewPhone] = useState('0712345678');
  const [newEmail, setNewEmail] = useState('');
  const [addError, setAddError] = useState('');

  // Batch generate New Building rooms state
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchFloorCount, setBatchFloorCount] = useState<number>(5);
  const [batchRoomsPerFloor, setBatchRoomsPerFloor] = useState<number>(10);
  const [batchTargetFloor, setBatchTargetFloor] = useState<string>('all'); // 'all' or '1'
  const [batchCategory, setBatchCategory] = useState<TariffCategory>(TariffCategory.Residential);
  const [batchMeterPrefix, setBatchMeterPrefix] = useState<string>('NB-');
  const [batchInitialIndex, setBatchInitialIndex] = useState<string>('0.0');
  const [batchError, setBatchError] = useState('');

  // Batch generate Old Building rooms state (F1: A1, A6; F2: B1-B12, C1-C12, D1-D12, E1-E5)
  const [oldBatchModalOpen, setOldBatchModalOpen] = useState(false);
  const [oldBatchCategory, setOldBatchCategory] = useState<TariffCategory>(TariffCategory.Residential);
  const [oldBatchMeterPrefix, setOldBatchMeterPrefix] = useState<string>('OB-');
  const [oldBatchInitialIndex, setOldBatchInitialIndex] = useState<string>('0.0');
  const [oldBatchFloorFilter, setOldBatchFloorFilter] = useState<'all' | 'F1' | 'F2'>('all');
  const [oldBatchError, setOldBatchError] = useState('');

  // Batch generate Heavy Consumer meters (F1 to F10)
  const [heavyBatchModalOpen, setHeavyBatchModalOpen] = useState(false);
  const [heavyBatchCount, setHeavyBatchCount] = useState<number>(10); // 10 meters (F1 to F10)
  const [heavyBatchCategory, setHeavyBatchCategory] = useState<TariffCategory>(TariffCategory.HeavyClients);
  const [heavyBatchMeterPrefix, setHeavyBatchMeterPrefix] = useState<string>('HM-');
  const [heavyBatchInitialIndex, setHeavyBatchInitialIndex] = useState<string>('0.0');
  const [heavyBatchError, setHeavyBatchError] = useState('');

  const filteredConnections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return state.connections.filter((c) => {
      if (categoryFilter !== 'ALL' && c.category !== categoryFilter) return false;
      if (zoneFilter !== 'ALL' && c.zone !== zoneFilter) return false;
      if (q) {
        const hay = `${c.customerName} ${c.accountCode} ${c.meterSerial} ${c.premiseAddress}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [state.connections, categoryFilter, zoneFilter, searchQuery]);

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
    setEditName(activeConnection.customerName);
    setEditAddress(activeConnection.premiseAddress);
    setEditZone(activeConnection.zone);
    setEditCategory(activeConnection.category);
    setEditMeterSerial(activeConnection.meterSerial);
    setEditPhone(activeConnection.phone);
    setEditEmail(activeConnection.email);
    setEditError('');
    setEditModalOpen(true);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConnection) return;
    if (!editName.trim() || !editAddress.trim() || !editMeterSerial.trim()) {
      setEditError('Customer name, premise address, and meter serial are required.');
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
      customerName: editName.trim(),
      premiseAddress: editAddress.trim(),
      zone: editZone,
      category: editCategory,
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
      customerName: newName.trim(),
      premiseAddress: newAddress.trim(),
      zone: newZone,
      category: newCategory,
      meterSerial: newMeterSerial.trim().toUpperCase(),
      status: ConnectionStatus.Active,
      phone: newPhone.trim() || '0712000000',
      email: newEmail.trim() || 'billing@example.com',
      lastReadingTenthsM3: tenths,
    });

    setNewName('');
    setNewAddress('');
    setNewMeterSerial(`MTR-${Math.floor(84220 + Math.random() * 700)}`);
    setNewInitialIndex('0.0');
    setNewEmail('');
    setAddError('');
    onAddModalOpenChange(false);
  };

  const handleBatchGenerateNewBuildingRooms = (e: React.FormEvent) => {
    e.preventDefault();
    const tenths = parseM3InputToTenths(batchInitialIndex);
    if (tenths === null) {
      setBatchError('Enter a valid non-negative initial meter index in m³.');
      return;
    }

    const floors = batchTargetFloor === 'all'
      ? Array.from({ length: batchFloorCount }, (_, i) => i + 1)
      : [parseInt(batchTargetFloor, 10) || 1];

    const existingMeters = new Set(state.connections.map((c) => c.meterSerial.toLowerCase()));
    const batchDrafts: Omit<WaterConnection, 'id' | 'accountCode' | 'lastReadCycle'>[] = [];

    for (const floor of floors) {
      for (let r = 1; r <= batchRoomsPerFloor; r++) {
        const roomCode = `A${r}`;
        const premiseAddress = `New Building, Floor ${floor}, Room ${roomCode}`;
        const customerName = `Floor ${floor} Room ${roomCode} Tenant`;
        const meterSerial = `${batchMeterPrefix.trim() || 'NB-'}F${floor}-${roomCode}`;

        if (existingMeters.has(meterSerial.toLowerCase())) {
          setBatchError(`Meter serial ${meterSerial} is already assigned. Please adjust prefix or rooms.`);
          return;
        }
        existingMeters.add(meterSerial.toLowerCase());

        batchDrafts.push({
          customerName,
          premiseAddress,
          zone: SupplyZone.NewBuilding,
          category: batchCategory,
          meterSerial,
          status: ConnectionStatus.Active,
          phone: '0712000000',
          email: `f${floor}.${roomCode.toLowerCase()}@newbuilding.ke`,
          lastReadingTenthsM3: tenths,
        });
      }
    }

    if (onBatchAddConnections) {
      onBatchAddConnections(batchDrafts);
    } else {
      // Fallback: add sequentially
      batchDrafts.forEach((d) => onAddConnection(d));
    }

    setBatchModalOpen(false);
    setBatchError('');
  };

  const handleBatchGenerateOldBuildingRooms = (e: React.FormEvent) => {
    e.preventDefault();
    const tenths = parseM3InputToTenths(oldBatchInitialIndex);
    if (tenths === null) {
      setOldBatchError('Enter a valid non-negative initial meter index in m³.');
      return;
    }

    // Specification: First floor A1 and A6; Second floor B1-B12, C1-C12, D1-D12, E1-E5
    const floor1Rooms = ['A1', 'A6'];
    const floor2Rooms: string[] = [
      ...Array.from({ length: 12 }, (_, i) => `B${i + 1}`),
      ...Array.from({ length: 12 }, (_, i) => `C${i + 1}`),
      ...Array.from({ length: 12 }, (_, i) => `D${i + 1}`),
      ...Array.from({ length: 5 }, (_, i) => `E${i + 1}`),
    ];

    const targets: { floor: number; floorLabel: string; room: string }[] = [];
    if (oldBatchFloorFilter === 'all' || oldBatchFloorFilter === 'F1') {
      floor1Rooms.forEach((r) => targets.push({ floor: 1, floorLabel: 'Floor 1', room: r }));
    }
    if (oldBatchFloorFilter === 'all' || oldBatchFloorFilter === 'F2') {
      floor2Rooms.forEach((r) => targets.push({ floor: 2, floorLabel: 'Floor 2', room: r }));
    }

    const existingMeters = new Set(state.connections.map((c) => c.meterSerial.toLowerCase()));
    const batchDrafts: Omit<WaterConnection, 'id' | 'accountCode' | 'lastReadCycle'>[] = [];

    for (const item of targets) {
      const premiseAddress = `Old Building, ${item.floorLabel}, Room ${item.room}`;
      const customerName = `${item.floorLabel} Room ${item.room} Tenant`;
      const meterSerial = `${oldBatchMeterPrefix.trim() || 'OB-'}F${item.floor}-${item.room}`;

      if (existingMeters.has(meterSerial.toLowerCase())) {
        setOldBatchError(`Meter serial ${meterSerial} is already assigned. Please adjust prefix or records.`);
        return;
      }
      existingMeters.add(meterSerial.toLowerCase());

      batchDrafts.push({
        customerName,
        premiseAddress,
        zone: SupplyZone.OldBuilding,
        category: oldBatchCategory,
        meterSerial,
        status: ConnectionStatus.Active,
        phone: '0722000000',
        email: `ob.f${item.floor}.${item.room.toLowerCase()}@oldbuilding.ke`,
        lastReadingTenthsM3: tenths,
      });
    }

    if (onBatchAddConnections) {
      onBatchAddConnections(batchDrafts);
    } else {
      batchDrafts.forEach((d) => onAddConnection(d));
    }

    setOldBatchModalOpen(false);
    setOldBatchError('');
  };

  const handleBatchGenerateHeavyMeters = (e: React.FormEvent) => {
    e.preventDefault();
    const tenths = parseM3InputToTenths(heavyBatchInitialIndex);
    if (tenths === null) {
      setHeavyBatchError('Enter a valid non-negative initial meter index in m³.');
      return;
    }

    const existingMeters = new Set(state.connections.map((c) => c.meterSerial.toLowerCase()));
    const batchDrafts: Omit<WaterConnection, 'id' | 'accountCode' | 'lastReadCycle'>[] = [];

    for (let i = 1; i <= heavyBatchCount; i++) {
      const meterCode = `F${i}`;
      const premiseAddress = `Heavy Consumer Zone, Main Feeder ${meterCode}`;
      const customerName = `Heavy Consumer ${meterCode} Client`;
      const meterSerial = `${heavyBatchMeterPrefix.trim() || 'HM-'}${meterCode}`;

      if (existingMeters.has(meterSerial.toLowerCase())) {
        setHeavyBatchError(`Meter serial ${meterSerial} is already assigned. Please adjust prefix or records.`);
        return;
      }
      existingMeters.add(meterSerial.toLowerCase());

      batchDrafts.push({
        customerName,
        premiseAddress,
        zone: SupplyZone.HeavyConsumer,
        category: heavyBatchCategory,
        meterSerial,
        status: ConnectionStatus.Active,
        phone: `073300${String(i).padStart(4, '0')}`,
        email: `heavy.${meterCode.toLowerCase()}@heavyconsumer.ke`,
        lastReadingTenthsM3: tenths,
      });
    }

    if (onBatchAddConnections) {
      onBatchAddConnections(batchDrafts);
    } else {
      batchDrafts.forEach((d) => onAddConnection(d));
    }

    setHeavyBatchModalOpen(false);
    setHeavyBatchError('');
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

          <select
            aria-label="Filter accounts by supply zone"
            value={zoneFilter}
            onChange={(e) => setZoneFilter(e.target.value as SupplyZone | 'ALL')}
            className="min-h-10 rounded-control border border-border/55 bg-surface px-3 text-label text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          >
            <option value="ALL">All supply zones</option>
            <option value={SupplyZone.OldBuilding}>{SupplyZone.OldBuilding}</option>
            <option value={SupplyZone.NewBuilding}>{SupplyZone.NewBuilding}</option>
            <option value={SupplyZone.HeavyConsumer}>{SupplyZone.HeavyConsumer}</option>
          </select>

          <Button
            tone="quiet"
            size="sm"
            onClick={() => setHeavyBatchModalOpen(true)}
            title="Generate heavy meter consumer accounts (F1 to F10)"
          >
            <Zap className="size-4 text-warning" />
            Heavy meters (F1-F10)
          </Button>

          <Button
            tone="quiet"
            size="sm"
            onClick={() => setOldBatchModalOpen(true)}
            title="Generate room accounts for Old Building (F1: A1, A6; F2: B1-B12, C1-C12, D1-D12, E1-E5)"
          >
            <Building2 className="size-4 text-accent" />
            Old Building rooms
          </Button>

          <Button
            tone="quiet"
            size="sm"
            onClick={() => setBatchModalOpen(true)}
            title="Generate room accounts for New Building floors (A1 to A10)"
          >
            <Building2 className="size-4 text-primary" />
            New Building rooms
          </Button>

          <Button tone="primary" size="sm" onClick={() => onAddModalOpenChange(true)}>
            <Plus className="size-4" />
            Add client
          </Button>
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
              <UserPlus className="mx-auto size-10 text-muted opacity-60 mb-3" />
              <p className="text-section text-foreground">No clients found</p>
              <p className="mt-1 text-caption text-muted">
                {state.connections.length === 0
                  ? 'Your system is currently fresh and clean with 0 records. Add your first water client or generate building/heavy meter presets.'
                  : 'No client records match the selected filters or search query.'}
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                <Button tone="primary" size="sm" onClick={() => setHeavyBatchModalOpen(true)}>
                  <Zap className="size-4" />
                  Generate Heavy meters (F1 to F10)
                </Button>
                <Button tone="quiet" size="sm" onClick={() => setOldBatchModalOpen(true)}>
                  <Building2 className="size-4" />
                  Generate Old Building (43 rooms)
                </Button>
                <Button tone="quiet" size="sm" onClick={() => setBatchModalOpen(true)}>
                  <Building2 className="size-4" />
                  Generate New Building (F1 A1-A10)
                </Button>
                <Button tone="quiet" size="sm" onClick={() => onAddModalOpenChange(true)}>
                  <Plus className="size-4" />
                  Add single client
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
                            {` · ${conn.premiseAddress} · ${conn.zone}`}
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
                      {`${activeConnection.premiseAddress} · ${activeConnection.zone}`}
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
                <div className="text-caption text-muted">
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
              label="Customer or business name"
              value={editName}
              onChange={(e) => {
                setEditName(e.target.value);
                setEditError('');
              }}
              required
            />
            <Field
              label="Premise street address"
              value={editAddress}
              onChange={(e) => {
                setEditAddress(e.target.value);
                setEditError('');
              }}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              label="Supply zone"
              value={editZone}
              onChange={(e) => setEditZone(e.target.value as SupplyZone)}
            >
              {Object.values(SupplyZone).map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </SelectField>

            <SelectField
              label="Tariff class"
              value={editCategory}
              onChange={(e) => setEditCategory(e.target.value as TariffCategory)}
            >
              <option value={TariffCategory.Residential}>Residents (KSh 150/m³)</option>
              <option value={TariffCategory.HeavyClients}>Heavy Clients (KSh 180/m³)</option>
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
        subtitle="Assign a physical meter serial, supply zone, and tariff rate class."
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
            <SelectField
              label="Supply zone"
              value={newZone}
              onChange={(e) => setNewZone(e.target.value as SupplyZone)}
            >
              {Object.values(SupplyZone).map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </SelectField>

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

      {/* Batch Generate New Building Rooms Modal */}
      <ModalDialog
        open={batchModalOpen}
        onClose={() => setBatchModalOpen(false)}
        title="Generate New Building Room Clients"
      >
        <form onSubmit={handleBatchGenerateNewBuildingRooms} className="space-y-4">
          <p className="text-body text-muted">
            Configure rooms and floors for the <strong>New Building</strong> supply zone. Each room will be provisioned with an individual meter serial and tenant billing account.
          </p>

          {batchError ? (
            <div
              role="alert"
              className="rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-caption text-danger"
            >
              {batchError}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              label="Floors to generate"
              value={batchTargetFloor}
              onChange={(e) => setBatchTargetFloor(e.target.value)}
            >
              <option value="1">Floor 1 only (F1 Rooms A1 to A10 - 10 rooms)</option>
              <option value="all">All 5 Floors (F1 to F5, Rooms A1 to A10 - 50 rooms total)</option>
            </SelectField>

            <SelectField
              label="Tariff classification"
              value={batchCategory}
              onChange={(e) => setBatchCategory(e.target.value as TariffCategory)}
            >
              <option value={TariffCategory.Residential}>Residents (KSh 150/m³)</option>
              <option value={TariffCategory.HeavyClients}>Heavy Clients (KSh 180/m³)</option>
            </SelectField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field
              label="Floors count"
              type="number"
              min="1"
              max="20"
              value={batchFloorCount}
              onChange={(e) => setBatchFloorCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
              disabled={batchTargetFloor !== 'all'}
            />
            <Field
              label="Rooms per floor"
              type="number"
              min="1"
              max="50"
              value={batchRoomsPerFloor}
              onChange={(e) => setBatchRoomsPerFloor(Math.max(1, parseInt(e.target.value, 10) || 1))}
            />
            <Field
              label="Meter serial prefix"
              value={batchMeterPrefix}
              onChange={(e) => setBatchMeterPrefix(e.target.value)}
              placeholder="e.g. NB-"
            />
          </div>

          <Field
            label="Initial register index for all meters (m³)"
            type="number"
            step="0.1"
            min="0"
            value={batchInitialIndex}
            onChange={(e) => setBatchInitialIndex(e.target.value)}
            required
          />

          {/* Quick Summary Pill Box */}
          <div className="rounded-control border border-border/45 bg-surface-muted/40 p-3 text-caption text-muted">
            <span className="font-medium text-foreground">Preview: </span>
            {batchTargetFloor === '1' ? (
              <span>
                10 accounts will be created for <strong>New Building Floor 1 (Rooms A1 through A10)</strong> with meter serials <code className="font-mono text-foreground">{batchMeterPrefix || 'NB-'}F1-A1</code> to <code className="font-mono text-foreground">{batchMeterPrefix || 'NB-'}F1-A10</code>.
              </span>
            ) : (
              <span>
                {batchFloorCount * batchRoomsPerFloor} accounts will be created across <strong>{batchFloorCount} floors</strong> (F1 to F{batchFloorCount}, Rooms A1 through A{batchRoomsPerFloor}) in the New Building supply zone.
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
            <Button tone="quiet" onClick={() => setBatchModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" tone="primary">
              <Building2 className="size-4" />
              {batchTargetFloor === '1' ? 'Create 10 clients (F1 A1-A10)' : `Create ${batchFloorCount * batchRoomsPerFloor} clients (5 floors)`}
            </Button>
          </div>
        </form>
      </ModalDialog>

      {/* Batch Generate Old Building Rooms Modal */}
      <ModalDialog
        open={oldBatchModalOpen}
        onClose={() => setOldBatchModalOpen(false)}
        title="Generate Old Building Room Clients"
      >
        <form onSubmit={handleBatchGenerateOldBuildingRooms} className="space-y-4">
          <p className="text-body text-muted">
            Configure room clients for the <strong>Old Building</strong> supply zone based on the building layout:
          </p>

          <div className="rounded-control border border-border/40 bg-surface-muted/30 p-3 space-y-1.5 text-caption">
            <div>
              <span className="font-semibold text-foreground">First Floor: </span>
              <span className="text-foreground/90 font-mono">A1, A6</span>
              <span className="text-muted"> (2 rooms)</span>
            </div>
            <div>
              <span className="font-semibold text-foreground">Second Floor: </span>
              <span className="text-foreground/90 font-mono">B1–B12 (12) · C1–C12 (12) · D1–D12 (12) · E1–E5 (5)</span>
              <span className="text-muted"> (41 rooms)</span>
            </div>
            <div className="pt-1 text-muted border-t border-border/30">
              Total: <strong>43 rooms</strong> across both floors.
            </div>
          </div>

          {oldBatchError ? (
            <div
              role="alert"
              className="rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-caption text-danger"
            >
              {oldBatchError}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              label="Floors to generate"
              value={oldBatchFloorFilter}
              onChange={(e) => setOldBatchFloorFilter(e.target.value as 'all' | 'F1' | 'F2')}
            >
              <option value="all">All Floors (F1: A1, A6 & F2: B1-B12, C1-C12, D1-D12, E1-E5 - 43 rooms)</option>
              <option value="F1">First Floor Only (A1, A6 - 2 rooms)</option>
              <option value="F2">Second Floor Only (B1-B12, C1-C12, D1-D12, E1-E5 - 41 rooms)</option>
            </SelectField>

            <SelectField
              label="Tariff classification"
              value={oldBatchCategory}
              onChange={(e) => setOldBatchCategory(e.target.value as TariffCategory)}
            >
              <option value={TariffCategory.Residential}>Residents (KSh 150/m³)</option>
              <option value={TariffCategory.HeavyClients}>Heavy Clients (KSh 180/m³)</option>
            </SelectField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Meter serial prefix"
              value={oldBatchMeterPrefix}
              onChange={(e) => setOldBatchMeterPrefix(e.target.value)}
              placeholder="e.g. OB-"
            />
            <Field
              label="Initial register index for all meters (m³)"
              type="number"
              step="0.1"
              min="0"
              value={oldBatchInitialIndex}
              onChange={(e) => setOldBatchInitialIndex(e.target.value)}
              required
            />
          </div>

          {/* Quick Summary Pill Box */}
          <div className="rounded-control border border-border/45 bg-surface-muted/40 p-3 text-caption text-muted">
            <span className="font-medium text-foreground">Summary: </span>
            {oldBatchFloorFilter === 'F1' ? (
              <span>
                2 accounts will be generated for <strong>First Floor (Rooms A1, A6)</strong> with meter serials <code className="font-mono text-foreground">{oldBatchMeterPrefix || 'OB-'}F1-A1</code> and <code className="font-mono text-foreground">{oldBatchMeterPrefix || 'OB-'}F1-A6</code>.
              </span>
            ) : oldBatchFloorFilter === 'F2' ? (
              <span>
                41 accounts will be generated for <strong>Second Floor (B1–B12, C1–C12, D1–D12, E1–E5)</strong> with meter serials <code className="font-mono text-foreground">{oldBatchMeterPrefix || 'OB-'}F2-B1</code> through <code className="font-mono text-foreground">{oldBatchMeterPrefix || 'OB-'}F2-E5</code>.
              </span>
            ) : (
              <span>
                43 accounts will be generated for <strong>Old Building</strong>: Floor 1 (A1, A6) and Floor 2 (B1-B12, C1-C12, D1-D12, E1-E5).
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
            <Button tone="quiet" onClick={() => setOldBatchModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" tone="primary">
              <Building2 className="size-4" />
              {oldBatchFloorFilter === 'F1'
                ? 'Create 2 clients (F1 A1, A6)'
                : oldBatchFloorFilter === 'F2'
                ? 'Create 41 clients (F2 B, C, D, E)'
                : 'Create 43 clients (Old Building)'}
            </Button>
          </div>
        </form>
      </ModalDialog>

      {/* Batch Generate Heavy Meters (F1 to F10) Modal */}
      <ModalDialog
        open={heavyBatchModalOpen}
        onClose={() => setHeavyBatchModalOpen(false)}
        title="Generate Heavy Meter Clients (F1 to F10)"
      >
        <form onSubmit={handleBatchGenerateHeavyMeters} className="space-y-4">
          <p className="text-body text-muted">
            Configure industrial / heavy commercial consumers for the <strong>Heavy Consumer</strong> supply zone. Provisions bulk meters designated <strong>F1 through F10</strong>.
          </p>

          {heavyBatchError ? (
            <div
              role="alert"
              className="rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-caption text-danger"
            >
              {heavyBatchError}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              label="Tariff classification"
              value={heavyBatchCategory}
              onChange={(e) => setHeavyBatchCategory(e.target.value as TariffCategory)}
            >
              <option value={TariffCategory.HeavyClients}>Heavy Clients (KSh 180/m³)</option>
              <option value={TariffCategory.Residential}>Residents (KSh 150/m³)</option>
            </SelectField>

            <Field
              label="Number of heavy meters"
              type="number"
              min="1"
              max="20"
              value={heavyBatchCount}
              onChange={(e) => setHeavyBatchCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
              hint="Default: 10 meters (F1 to F10)"
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Meter serial prefix"
              value={heavyBatchMeterPrefix}
              onChange={(e) => setHeavyBatchMeterPrefix(e.target.value)}
              placeholder="e.g. HM-"
            />
            <Field
              label="Initial register index for all meters (m³)"
              type="number"
              step="0.1"
              min="0"
              value={heavyBatchInitialIndex}
              onChange={(e) => setHeavyBatchInitialIndex(e.target.value)}
              required
            />
          </div>

          {/* Quick Summary Pill Box */}
          <div className="rounded-control border border-border/45 bg-surface-muted/40 p-3 text-caption text-muted">
            <span className="font-medium text-foreground">Summary: </span>
            <span>
              {heavyBatchCount} heavy commercial client accounts will be created in the <strong>Heavy Consumer</strong> zone with meters <code className="font-mono text-foreground">{heavyBatchMeterPrefix || 'HM-'}F1</code> to <code className="font-mono text-foreground">{heavyBatchMeterPrefix || 'HM-'}F{heavyBatchCount}</code> at <strong>KSh 180/m³</strong>.
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
            <Button tone="quiet" onClick={() => setHeavyBatchModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" tone="primary">
              <Zap className="size-4" />
              Create {heavyBatchCount} heavy meters (F1 to F{heavyBatchCount})
            </Button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}

