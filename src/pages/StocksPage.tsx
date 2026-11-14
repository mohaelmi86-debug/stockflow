import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Download,
  Plus,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useToast } from '../contexts/ToastContext.tsx';
import { useErpData } from '../hooks/useErpData.ts';
import { recordStockMovement } from '../services/erpService.ts';
import { stockMovementSchema, type StockMovementInput } from '../shared/schemas.ts';
import { formatCurrency, formatDateTime, formatNumber } from '../shared/formatters.ts';
import { Button } from '../components/ui/Button.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { TableSkeleton } from '../components/ui/Skeleton.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { StatusText } from '../components/ui/StatusText.tsx';

export function StocksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, activeOrg } = useAuth();
  const { toast } = useToast();
  const {
    products,
    warehouses,
    locations,
    balances,
    movements,
    isLoading,
    invalidateAll,
  } = useErpData();

  const [activeTab, setActiveTab] = useState<'balances' | 'movements'>('balances');
  const [search, setSearch] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('ALL');
  const [movementModalOpen, setMovementModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const currency = activeOrg?.currency ?? 'EUR';
  const memberUids = activeOrg?.memberUids ?? (user ? [user.uid] : []);
  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const form = useForm<StockMovementInput>({
    resolver: zodResolver(stockMovementSchema) as never,
    defaultValues: {
      movementType: 'IN',
      productId: '',
      warehouseId: '',
      locationId: '',
      targetWarehouseId: '',
      targetLocationId: '',
      quantity: 1,
      unitCost: 0,
      reason: '',
      sourceDocumentType: 'Opération manuelle',
      sourceDocumentRef: '',
    },
  });

  useEffect(() => {
    if (searchParams.get('action') === 'new') {
      const preselectProdId = searchParams.get('productId') || products[0]?.id || '';
      const defWh = warehouses.find((w) => w.isDefault) ?? warehouses[0];
      const defLoc = locations.find((l) => l.warehouseId === defWh?.id);
      const prod = products.find((p) => p.id === preselectProdId);
      form.reset({
        movementType: 'IN',
        productId: preselectProdId,
        warehouseId: defWh?.id ?? '',
        locationId: defLoc?.id ?? '',
        targetWarehouseId: '',
        targetLocationId: '',
        quantity: 10,
        unitCost: prod?.purchasePrice ?? 0,
        reason: preselectProdId ? 'Réapprovisionnement seuil minimum' : '',
        sourceDocumentType: 'Réception manuelle',
        sourceDocumentRef: '',
      });
      setMovementModalOpen(true);
      setSearchParams({});
    }
  }, [searchParams, setSearchParams, products, warehouses, locations, form]);

  const watchType = form.watch('movementType');
  const watchWhId = form.watch('warehouseId');
  const watchTargetWhId = form.watch('targetWarehouseId');
  const watchProductId = form.watch('productId');

  const sourceLocations = useMemo(
    () => locations.filter((l) => l.warehouseId === watchWhId),
    [locations, watchWhId]
  );

  const targetLocations = useMemo(
    () => locations.filter((l) => l.warehouseId === watchTargetWhId),
    [locations, watchTargetWhId]
  );

  useEffect(() => {
    if (sourceLocations.length > 0 && !sourceLocations.some((l) => l.id === form.getValues('locationId'))) {
      form.setValue('locationId', sourceLocations[0].id);
    }
  }, [sourceLocations, form]);

  useEffect(() => {
    if (targetLocations.length > 0 && !targetLocations.some((l) => l.id === form.getValues('targetLocationId'))) {
      form.setValue('targetLocationId', targetLocations[0].id);
    }
  }, [targetLocations, form]);

  useEffect(() => {
    const p = productMap.get(watchProductId);
    if (p) {
      form.setValue('unitCost', p.purchasePrice);
    }
  }, [watchProductId, productMap, form]);

  const openNewMovement = () => {
    const defWh = warehouses.find((w) => w.isDefault) ?? warehouses[0];
    const defLoc = locations.find((l) => l.warehouseId === defWh?.id);
    const defProd = products[0];
    form.reset({
      movementType: 'IN',
      productId: defProd?.id ?? '',
      warehouseId: defWh?.id ?? '',
      locationId: defLoc?.id ?? '',
      targetWarehouseId: warehouses[1]?.id ?? defWh?.id ?? '',
      targetLocationId: '',
      quantity: 1,
      unitCost: defProd?.purchasePrice ?? 0,
      reason: '',
      sourceDocumentType: 'Opération manuelle',
      sourceDocumentRef: '',
    });
    setMovementModalOpen(true);
  };

  const onSubmitMovement = async (data: StockMovementInput) => {
    if (!activeOrg || !user) return;
    const product = products.find((p) => p.id === data.productId);
    const warehouse = warehouses.find((w) => w.id === data.warehouseId);
    const location = locations.find((l) => l.id === data.locationId);

    if (!product || !warehouse || !location) {
      toast({
        variant: 'error',
        title: 'Sélection incomplète',
        description: 'Produit, entrepôt et emplacement sont obligatoires.',
      });
      return;
    }

    const targetWarehouse = data.movementType === 'TRANSFER'
      ? warehouses.find((w) => w.id === data.targetWarehouseId)
      : undefined;
    const targetLocation = data.movementType === 'TRANSFER'
      ? locations.find((l) => l.id === data.targetLocationId)
      : undefined;

    setSubmitting(true);
    try {
      const ref = await recordStockMovement({
        orgId: activeOrg.id,
        memberUids,
        input: data,
        product,
        warehouse,
        location,
        targetWarehouse,
        targetLocation,
        actor: {
          uid: user.uid,
          email: user.email ?? 'user@stockflow.local',
          displayName: user.displayName || user.email?.split('@')[0] || 'Opérateur',
        },
      });
      await invalidateAll();
      toast({
        variant: 'success',
        title: 'Mouvement validé',
        description: `Référence ${ref} enregistrée de manière transactionnelle.`,
      });
      setMovementModalOpen(false);
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Mouvement refusé',
        description: err instanceof Error ? err.message : 'Erreur lors de la transaction.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const filteredBalances = useMemo(() => {
    const q = search.trim().toLowerCase();
    return balances.filter((b) => {
      if (warehouseFilter !== 'ALL' && b.warehouseId !== warehouseFilter) return false;
      if (!q) return true;
      return (
        b.productSku.toLowerCase().includes(q) ||
        b.productName.toLowerCase().includes(q) ||
        b.locationCode.toLowerCase().includes(q)
      );
    });
  }, [balances, warehouseFilter, search]);

  const filteredMovements = useMemo(() => {
    const q = search.trim().toLowerCase();
    return movements.filter((m) => {
      if (
        warehouseFilter !== 'ALL' &&
        m.warehouseId !== warehouseFilter &&
        m.targetWarehouseId !== warehouseFilter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        m.reference.toLowerCase().includes(q) ||
        m.productSku.toLowerCase().includes(q) ||
        m.productName.toLowerCase().includes(q) ||
        m.reason.toLowerCase().includes(q)
      );
    });
  }, [movements, warehouseFilter, search]);

  const exportMovementsCsv = () => {
    const header = [
      'Référence',
      'Type',
      'SKU',
      'Produit',
      'Entrepôt source',
      'Emplacement',
      'Quantité',
      'Coût unitaire',
      'Motif',
      'Opérateur',
      'Date',
    ];
    const rows = filteredMovements.map((m) =>
      [
        m.reference,
        m.movementType,
        m.productSku,
        `"${m.productName.replace(/"/g, '""')}"`,
        `"${m.warehouseName.replace(/"/g, '""')}"`,
        m.locationCode,
        m.quantity,
        m.unitCost,
        `"${m.reason.replace(/"/g, '""')}"`,
        `"${m.performedByName.replace(/"/g, '""')}"`,
        formatDateTime(m.createdAt),
      ].join(';')
    );
    const csv = '\uFEFF' + [header.join(';'), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mouvements_stock_${activeOrg?.slug ?? 'stockflow'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Accueil / Logistique / Stocks</p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Gestion des stocks &amp; mouvements
          </h1>
        </div>
        <div className="flex items-center gap-2.5">
          <Button type="button" variant="outline" size="sm" onClick={exportMovementsCsv}>
            <Download className="h-4 w-4" />
            <span>Export journal</span>
          </Button>
          <Button type="button" onClick={openNewMovement} disabled={products.length === 0 || warehouses.length === 0}>
            <Plus className="h-4 w-4" />
            <span>Enregistrer un mouvement</span>
          </Button>
        </div>
      </div>

      {/* Tabs & Filters */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 w-fit dark:bg-slate-800">
          <button
            type="button"
            onClick={() => setActiveTab('balances')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'balances'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
            }`}
          >
            Soldes en stock ({filteredBalances.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('movements')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'movements'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
            }`}
          >
            Historique des mouvements ({filteredMovements.length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="SKU, référence, emplacement..."
              className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
          <select
            aria-label="Filtrer par entrepôt"
            value={warehouseFilter}
            onChange={(e) => setWarehouseFilter(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            <option value="ALL">Tous les entrepôts</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton rows={6} cols={7} />
      ) : activeTab === 'balances' ? (
        filteredBalances.length === 0 ? (
          <EmptyState
            icon={ArrowRightLeft}
            title="Aucun solde de stock"
            description="Enregistrez une entrée de stock pour initialiser les quantités sur vos entrepôts et emplacements."
            action={
              <Button type="button" onClick={openNewMovement} disabled={products.length === 0}>
                <Plus className="h-4 w-4" />
                <span>Première entrée de stock</span>
              </Button>
            }
          />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/70 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Produit</th>
                    <th className="px-4 py-3 font-medium">Entrepôt / Empl.</th>
                    <th className="px-4 py-3 font-medium text-right">Physique</th>
                    <th className="px-4 py-3 font-medium text-right">Réservé</th>
                    <th className="px-4 py-3 font-medium text-right">Disponible</th>
                    <th className="px-4 py-3 font-medium text-right">En cde</th>
                    <th className="px-4 py-3 font-medium text-right">Valorisation</th>
                    <th className="px-4 py-3 font-medium">État</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredBalances.map((b) => {
                    const prod = productMap.get(b.productId);
                    const min = prod?.minStock ?? 0;
                    const tone = b.availableQty <= 0 ? 'error' : b.availableQty <= min ? 'warning' : 'success';
                    const label = b.availableQty <= 0 ? 'Rupture' : b.availableQty <= min ? 'Sous seuil' : 'Nominal';
                    return (
                      <tr key={b.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs font-semibold text-blue-700 dark:text-blue-400">
                            {b.productSku}
                          </span>
                          <p className="font-medium text-slate-900 dark:text-slate-100">{b.productName}</p>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <p className="text-slate-800 dark:text-slate-200">{b.warehouseName}</p>
                          <p className="font-mono text-slate-500">{b.locationCode}</p>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                          {formatNumber(b.physicalQty)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-slate-500">
                          {formatNumber(b.reservedQty)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs font-semibold tabular-nums text-slate-900 dark:text-white">
                          {formatNumber(b.availableQty)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-slate-500">
                          {formatNumber(b.onOrderQty)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                          {formatCurrency(b.physicalQty * b.unitCost, currency)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusText tone={tone} label={label} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : filteredMovements.length === 0 ? (
        <EmptyState
          icon={SlidersHorizontal}
          title="Aucun mouvement enregistré"
          description="Tous les mouvements d’entrée, de sortie, de transfert et d’ajustement apparaissent ici avec leur référence immuable."
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/70 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Référence</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Produit</th>
                  <th className="px-4 py-3 font-medium">Entrepôt / Empl.</th>
                  <th className="px-4 py-3 font-medium text-right">Quantité</th>
                  <th className="px-4 py-3 font-medium">Motif / Document</th>
                  <th className="px-4 py-3 font-medium">Opérateur &amp; Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredMovements.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {m.reference}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        {m.movementType === 'IN' && <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-600" />}
                        {m.movementType === 'OUT' && <ArrowUpRight className="h-3.5 w-3.5 text-red-600" />}
                        {m.movementType === 'TRANSFER' && <ArrowRightLeft className="h-3.5 w-3.5 text-blue-600" />}
                        {m.movementType === 'ADJUSTMENT' && <SlidersHorizontal className="h-3.5 w-3.5 text-amber-600" />}
                        <span>{m.movementType}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-blue-700 dark:text-blue-400">{m.productSku}</span>
                      <p className="text-xs font-medium text-slate-900 dark:text-slate-100">{m.productName}</p>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <p>{m.warehouseName} ({m.locationCode})</p>
                      {m.targetWarehouseName && (
                        <p className="text-blue-600 dark:text-blue-400">
                          → {m.targetWarehouseName} ({m.targetLocationCode})
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs font-semibold tabular-nums">
                      <span className={m.movementType === 'OUT' ? 'text-red-600' : 'text-emerald-600'}>
                        {m.movementType === 'OUT' ? `-${Math.abs(m.quantity)}` : m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                      <p>{m.reason}</p>
                      {m.sourceDocumentType && (
                        <p className="text-[11px] text-slate-400">
                          {m.sourceDocumentType} {m.sourceDocumentRef ? `· ${m.sourceDocumentRef}` : ''}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <p className="text-slate-700 dark:text-slate-200">{m.performedByName}</p>
                      <p className="font-mono text-[11px] text-slate-400">{formatDateTime(m.createdAt)}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Transactional Movement Modal */}
      <Modal
        open={movementModalOpen}
        onClose={() => setMovementModalOpen(false)}
        title="Nouveau mouvement de stock"
        subtitle="Transaction atomique : met à jour le solde et enregistre une ligne immuable."
        size="lg"
      >
        <form onSubmit={form.handleSubmit(onSubmitMovement)} className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(
              [
                { code: 'IN', label: 'Entrée' },
                { code: 'OUT', label: 'Sortie' },
                { code: 'TRANSFER', label: 'Transfert' },
                { code: 'ADJUSTMENT', label: 'Ajustement' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.code}
                type="button"
                onClick={() => form.setValue('movementType', opt.code)}
                className={`py-2 px-3 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                  watchType === opt.code
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Produit *</label>
            <select
              {...form.register('productId')}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} — {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
                {watchType === 'TRANSFER' ? 'Entrepôt source *' : 'Entrepôt *'}
              </label>
              <select
                {...form.register('warehouseId')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
                {watchType === 'TRANSFER' ? 'Emplacement source *' : 'Emplacement *'}
              </label>
              <select
                {...form.register('locationId')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono dark:border-slate-700 dark:bg-slate-950"
              >
                {sourceLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} ({l.zoneType})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {watchType === 'TRANSFER' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-lg border border-blue-200 bg-blue-50/40 p-3 dark:border-blue-900/50 dark:bg-blue-950/20">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
                  Entrepôt destination *
                </label>
                <select
                  {...form.register('targetWarehouseId')}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="">Sélectionner...</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} — {w.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
                  Emplacement destination *
                </label>
                <select
                  {...form.register('targetLocationId')}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="">Sélectionner...</option>
                  {targetLocations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} ({l.zoneType})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
                Quantité {watchType === 'ADJUSTMENT' ? '(+ ou -)' : '*'}
              </label>
              <input
                type="number"
                step="0.01"
                {...form.register('quantity')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono dark:border-slate-700 dark:bg-slate-950"
              />
              {form.formState.errors.quantity && (
                <p className="mt-1 text-xs text-red-600">{form.formState.errors.quantity.message}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
                Coût unitaire ({currency})
              </label>
              <input
                type="number"
                step="0.01"
                {...form.register('unitCost')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Document source</label>
              <input
                type="text"
                placeholder="Ex. Bon de livraison"
                {...form.register('sourceDocumentType')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Réf. document</label>
              <input
                type="text"
                placeholder="Ex. BL-2026-0042"
                {...form.register('sourceDocumentRef')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Motif obligatoire *</label>
            <input
              type="text"
              placeholder="Ex. Réception fournisseur / Inventaire tournant / Expédition"
              {...form.register('reason')}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
            {form.formState.errors.reason && (
              <p className="mt-1 text-xs text-red-600">{form.formState.errors.reason.message}</p>
            )}
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
            <Button type="button" variant="outline" onClick={() => setMovementModalOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Validation...' : 'Valider le mouvement'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
