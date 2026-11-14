import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import { Box, Layers, MapPin, Plus, Warehouse as WarehouseIcon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useToast } from '../contexts/ToastContext.tsx';
import { useErpData } from '../hooks/useErpData.ts';
import { createLocation, createWarehouse } from '../services/erpService.ts';
import {
  locationSchema,
  warehouseSchema,
  type LocationInput,
  type WarehouseInput,
} from '../shared/schemas.ts';
import { formatCurrency, formatNumber } from '../shared/formatters.ts';
import { PLAN_QUOTAS } from '../shared/types.ts';
import { Button } from '../components/ui/Button.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { TableSkeleton } from '../components/ui/Skeleton.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { StatusText } from '../components/ui/StatusText.tsx';

export function WarehousesPage() {
  const { user, activeOrg } = useAuth();
  const { toast } = useToast();
  const { warehouses, locations, balances, isLoading, invalidateAll } = useErpData();

  const [selectedWhId, setSelectedWhId] = useState<string | null>(null);
  const [whModalOpen, setWhModalOpen] = useState(false);
  const [locModalOpen, setLocModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const currency = activeOrg?.currency ?? 'EUR';
  const memberUids = activeOrg?.memberUids ?? (user ? [user.uid] : []);
  const planQuota = PLAN_QUOTAS[activeOrg?.plan ?? 'starter'];

  const activeWh = useMemo(() => {
    if (selectedWhId) {
      const found = warehouses.find((w) => w.id === selectedWhId);
      if (found) return found;
    }
    return warehouses[0] ?? null;
  }, [warehouses, selectedWhId]);

  const whStats = useMemo(() => {
    const map = new Map<string, { units: number; value: number }>();
    for (const b of balances) {
      const prev = map.get(b.warehouseId) ?? { units: 0, value: 0 };
      map.set(b.warehouseId, {
        units: prev.units + b.physicalQty,
        value: prev.value + b.physicalQty * b.unitCost,
      });
    }
    return map;
  }, [balances]);

  const locStats = useMemo(() => {
    const map = new Map<string, { units: number; skuCount: number }>();
    for (const b of balances) {
      const prev = map.get(b.locationId) ?? { units: 0, skuCount: 0 };
      map.set(b.locationId, {
        units: prev.units + b.physicalQty,
        skuCount: prev.skuCount + (b.physicalQty > 0 ? 1 : 0),
      });
    }
    return map;
  }, [balances]);

  const activeWhLocations = useMemo(() => {
    if (!activeWh) return [];
    return locations.filter((l) => l.warehouseId === activeWh.id);
  }, [locations, activeWh]);

  const whForm = useForm<WarehouseInput>({
    resolver: zodResolver(warehouseSchema) as never,
    defaultValues: {
      code: '',
      name: '',
      address: '',
      city: '',
      country: 'France',
      capacityUnits: 10000,
      isDefault: false,
      status: 'active',
    },
  });

  const locForm = useForm<LocationInput>({
    resolver: zodResolver(locationSchema) as never,
    defaultValues: {
      warehouseId: '',
      code: '',
      zoneType: 'storage',
      aisle: 'A',
      rack: '01',
      level: '01',
      capacity: 500,
      status: 'active',
    },
  });

  const openCreateWh = () => {
    whForm.reset({
      code: `WH-0${warehouses.length + 1}`,
      name: '',
      address: '',
      city: '',
      country: 'France',
      capacityUnits: 10000,
      isDefault: warehouses.length === 0,
      status: 'active',
    });
    setWhModalOpen(true);
  };

  const openCreateLoc = () => {
    if (!activeWh) return;
    locForm.reset({
      warehouseId: activeWh.id,
      code: `B-0${activeWhLocations.length + 1}-01`,
      zoneType: 'storage',
      aisle: 'B',
      rack: `0${activeWhLocations.length + 1}`,
      level: '01',
      capacity: 500,
      status: 'active',
    });
    setLocModalOpen(true);
  };

  const onSubmitWh = async (data: WarehouseInput) => {
    if (!activeOrg || !user) return;
    if (warehouses.length >= planQuota.maxWarehouses) {
      toast({
        variant: 'warning',
        title: 'Quota entrepôt atteint',
        description: `Votre plan ${planQuota.name} inclut ${planQuota.maxWarehouses} entrepôt(s). Passez au plan supérieur dans Paramètres.`,
      });
      return;
    }
    setSubmitting(true);
    try {
      const id = await createWarehouse(activeOrg.id, memberUids, data, {
        uid: user.uid,
        email: user.email ?? 'admin@stockflow.local',
      });
      await invalidateAll();
      setSelectedWhId(id);
      setWhModalOpen(false);
      toast({ variant: 'success', title: 'Entrepôt créé', description: data.name });
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Erreur',
        description: err instanceof Error ? err.message : 'Impossible de créer l’entrepôt.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmitLoc = async (data: LocationInput) => {
    if (!activeOrg) return;
    setSubmitting(true);
    try {
      await createLocation(activeOrg.id, memberUids, data);
      await invalidateAll();
      setLocModalOpen(false);
      toast({ variant: 'success', title: 'Emplacement créé', description: data.code.toUpperCase() });
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Erreur',
        description: err instanceof Error ? err.message : 'Impossible de créer l’emplacement.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Accueil / Logistique / Entrepôts</p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Entrepôts &amp; Emplacements
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {activeWh && (
            <>
              <Link to={`/entrepots-3d?warehouseId=${activeWh.id}`}>
                <Button type="button" variant="outline">
                  <Box className="h-4 w-4" />
                  <span>Vue 3D</span>
                </Button>
              </Link>
              <Button type="button" variant="outline" onClick={openCreateLoc}>
                <MapPin className="h-4 w-4" />
                <span>Ajouter un emplacement</span>
              </Button>
            </>
          )}
          <Button type="button" onClick={openCreateWh}>
            <Plus className="h-4 w-4" />
            <span>Nouvel entrepôt</span>
          </Button>
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={5} />
      ) : warehouses.length === 0 ? (
        <EmptyState
          icon={WarehouseIcon}
          title="Aucun entrepôt configuré"
          description="Créez votre premier entrepôt physique pour organiser vos zones et rayonnages."
          action={
            <Button type="button" onClick={openCreateWh}>
              <Plus className="h-4 w-4" />
              <span>Créer un entrepôt</span>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Warehouses list */}
          <div className="lg:col-span-4 space-y-3">
            {warehouses.map((wh) => {
              const st = whStats.get(wh.id) ?? { units: 0, value: 0 };
              const occupancyPct = wh.capacityUnits > 0 ? Math.min(100, Math.round((st.units / wh.capacityUnits) * 100)) : 0;
              const isSelected = activeWh?.id === wh.id;
              return (
                <button
                  key={wh.id}
                  type="button"
                  onClick={() => setSelectedWhId(wh.id)}
                  className={`w-full text-left rounded-xl border p-4 transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-blue-600 bg-blue-50/40 dark:border-blue-500 dark:bg-blue-950/20'
                      : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-blue-700 dark:text-blue-400">
                      {wh.code}
                    </span>
                    <StatusText
                      tone={wh.status === 'active' ? 'success' : 'neutral'}
                      label={wh.status === 'active' ? 'Actif' : 'Inactif'}
                    />
                  </div>
                  <p className="mt-1 font-semibold text-slate-900 dark:text-white">{wh.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {wh.city ? `${wh.city}, ` : ''}
                    {wh.country || 'France'}
                  </p>
                  <div className="mt-3 flex items-center justify-between text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                    <span>{formatNumber(st.units)} unités</span>
                    <span>{formatCurrency(st.value, currency)}</span>
                  </div>
                  <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-blue-600 rounded-full"
                      style={{ width: `${occupancyPct}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>

          {/* Locations & Zone Grid for selected warehouse */}
          <div className="lg:col-span-8 space-y-4">
            {activeWh && (
              <>
                <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                        Emplacements — {activeWh.name}
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {activeWh.address || 'Adresse non renseignée'} · Capacité {formatNumber(activeWh.capacityUnits)} unités
                      </p>
                    </div>
                    <span className="text-xs text-slate-500 font-mono">
                      {activeWhLocations.length} emplacement(s)
                    </span>
                  </div>

                  {activeWhLocations.length === 0 ? (
                    <p className="mt-6 text-center text-xs text-slate-500">
                      Aucun emplacement défini dans cet entrepôt.
                    </p>
                  ) : (
                    <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                      {activeWhLocations.map((loc) => {
                        const lStat = locStats.get(loc.id) ?? { units: 0, skuCount: 0 };
                        const pct = loc.capacity > 0 ? Math.min(100, Math.round((lStat.units / loc.capacity) * 100)) : 0;
                        const zoneLabels: Record<string, string> = {
                          storage: 'Stockage',
                          receiving: 'Réception',
                          shipping: 'Expédition',
                          picking: 'Préparation',
                        };
                        return (
                          <div
                            key={loc.id}
                            className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-950/60"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-xs font-semibold text-slate-900 dark:text-white">
                                {loc.code}
                              </span>
                              <span className="text-[11px] text-slate-500">
                                {zoneLabels[loc.zoneType] ?? loc.zoneType}
                              </span>
                            </div>
                            <div className="mt-2 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300 font-mono tabular-nums">
                              <span>
                                {formatNumber(lStat.units)} / {formatNumber(loc.capacity)} u.
                              </span>
                              <span>{lStat.skuCount} SKU</span>
                            </div>
                            <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  pct >= 90 ? 'bg-red-600' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-600'
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <Layers className="h-5 w-5 text-blue-600 shrink-0 mt-0.5 dark:text-blue-400" />
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">
                        Jumeau numérique 3D
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        Explorez en 3D vos allées, racks, niveaux et zones d’expédition avec inspection temps réel des stocks et alertes de rupture.
                      </p>
                    </div>
                  </div>
                  <Link to={`/entrepots-3d?warehouseId=${activeWh.id}`} className="shrink-0">
                    <Button type="button" size="sm">
                      <Box className="h-4 w-4" />
                      <span>Ouvrir la vue 3D interactive</span>
                    </Button>
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* New Warehouse Modal */}
      <Modal open={whModalOpen} onClose={() => setWhModalOpen(false)} title="Nouvel entrepôt">
        <form onSubmit={whForm.handleSubmit(onSubmitWh)} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Code *</label>
              <input
                type="text"
                {...whForm.register('code')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono uppercase dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Nom *</label>
              <input
                type="text"
                placeholder="Entrepôt Sud Marseille"
                {...whForm.register('name')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Adresse</label>
            <input
              type="text"
              {...whForm.register('address')}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Ville</label>
              <input
                type="text"
                {...whForm.register('city')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Capacité (unités)</label>
              <input
                type="number"
                {...whForm.register('capacityUnits')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setWhModalOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Création...' : 'Créer l’entrepôt'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* New Location Modal */}
      <Modal open={locModalOpen} onClose={() => setLocModalOpen(false)} title="Nouvel emplacement">
        <form onSubmit={locForm.handleSubmit(onSubmitLoc)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Code emplacement *</label>
              <input
                type="text"
                {...locForm.register('code')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono uppercase dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Type de zone</label>
              <select
                {...locForm.register('zoneType')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="storage">Stockage</option>
                <option value="picking">Préparation</option>
                <option value="receiving">Réception</option>
                <option value="shipping">Expédition</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Allée</label>
              <input
                type="text"
                {...locForm.register('aisle')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Rack</label>
              <input
                type="text"
                {...locForm.register('rack')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Niveau</label>
              <input
                type="text"
                {...locForm.register('level')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Capacité (unités)</label>
            <input
              type="number"
              {...locForm.register('capacity')}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setLocModalOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Ajout...' : 'Ajouter'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
