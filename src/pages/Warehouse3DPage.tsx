import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRightLeft,
  ChevronDown,
  ChevronUp,
  Layers,
  Pause,
  Play,
  Search,
  Warehouse as WarehouseIcon,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import { useErpData } from '../hooks/useErpData.ts';
import { formatCurrency, formatNumber } from '../shared/formatters.ts';
import { Button } from '../components/ui/Button.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { Skeleton } from '../components/ui/Skeleton.tsx';
import { StatusText } from '../components/ui/StatusText.tsx';
import { Warehouse3DCanvas } from '../components/warehouse3d/Warehouse3DCanvas.tsx';
import {
  buildWarehouseScenePlan,
  type CameraPreset3D,
  type ColorMode3D,
  type LocationNode3D,
} from '../components/warehouse3d/warehouseLayout.ts';

const ZONE_LABELS: Record<string, string> = {
  storage: 'Stockage',
  picking: 'Préparation',
  receiving: 'Réception',
  shipping: 'Expédition',
};

const LEGEND_BY_MODE: Record<ColorMode3D, Array<{ color: string; label: string }>> = {
  occupancy: [
    { color: 'bg-emerald-500', label: '< 70 %' },
    { color: 'bg-amber-500', label: '70–89 %' },
    { color: 'bg-red-600', label: '≥ 90 %' },
    { color: 'bg-slate-500', label: 'Vide / Bloqué' },
  ],
  zone: [
    { color: 'bg-blue-600', label: 'Stockage' },
    { color: 'bg-sky-500', label: 'Préparation' },
    { color: 'bg-emerald-500', label: 'Réception' },
    { color: 'bg-amber-500', label: 'Expédition' },
  ],
  alerts: [
    { color: 'bg-red-600', label: 'Rupture / Seuil bas' },
    { color: 'bg-amber-500', label: 'Stock réservé' },
    { color: 'bg-emerald-500', label: 'Nominal' },
    { color: 'bg-slate-500', label: 'Vide' },
  ],
};

export function Warehouse3DPage() {
  const { activeOrg } = useAuth();
  const { theme } = useTheme();
  const { warehouses, locations, balances, products, isLoading } = useErpData();
  const [searchParams, setSearchParams] = useSearchParams();

  const paramWarehouseId = searchParams.get('warehouseId');
  const [selectedWhId, setSelectedWhId] = useState<string>(paramWarehouseId ?? '');

  useEffect(() => {
    if (paramWarehouseId && warehouses.some((w) => w.id === paramWarehouseId)) {
      setSelectedWhId(paramWarehouseId);
    } else if (!selectedWhId && warehouses.length > 0) {
      setSelectedWhId(warehouses[0].id);
    }
  }, [paramWarehouseId, warehouses, selectedWhId]);

  const activeWarehouse = useMemo(
    () => warehouses.find((w) => w.id === selectedWhId) ?? warehouses[0] ?? null,
    [warehouses, selectedWhId]
  );

  const scenePlan = useMemo(() => {
    if (!activeWarehouse) return null;
    return buildWarehouseScenePlan({
      warehouse: activeWarehouse,
      locations,
      balances,
      products,
    });
  }, [activeWarehouse, locations, balances, products]);

  const [colorMode, setColorMode] = useState<ColorMode3D>('occupancy');
  const [cameraPreset, setCameraPreset] = useState<CameraPreset3D>('iso');
  const [cameraPresetTrigger, setCameraPresetTrigger] = useState(0);
  const [explodeFactor, setExplodeFactor] = useState(0);
  const [animateForklift, setAnimateForklift] = useState(true);
  const [controlsCollapsed, setControlsCollapsed] = useState(false);

  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [hoveredLocationId, setHoveredLocationId] = useState<string | null>(null);
  const [focusLocationId, setFocusLocationId] = useState<string | null>(null);
  const [focusTrigger, setFocusTrigger] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  // Keyboard shortcut 'H' to toggle bottom control dock
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (ev.key === 'h' || ev.key === 'H') {
        setControlsCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Reset location selection when warehouse changes
  useEffect(() => {
    setSelectedLocationId(null);
    setHoveredLocationId(null);
    setFocusLocationId(null);
    setSearchQuery('');
  }, [activeWarehouse?.id]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, LocationNode3D>();
    if (!scenePlan) return map;
    for (const n of scenePlan.allNodes) {
      map.set(n.location.id, n);
    }
    return map;
  }, [scenePlan]);

  const selectedNode = selectedLocationId ? nodeMap.get(selectedLocationId) ?? null : null;
  const hoveredNode = hoveredLocationId ? nodeMap.get(hoveredLocationId) ?? null : null;

  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || !scenePlan) return [];
    return scenePlan.allNodes
      .filter((node) => {
        if (node.location.code.toLowerCase().includes(q)) return true;
        return node.items.some(
          (it) =>
            it.product?.sku.toLowerCase().includes(q) ||
            it.product?.name.toLowerCase().includes(q)
        );
      })
      .slice(0, 6);
  }, [searchQuery, scenePlan]);

  const warehouseSummary = useMemo(() => {
    if (!scenePlan) return { locCount: 0, totalUnits: 0, totalValue: 0, alertCount: 0 };
    return {
      locCount: scenePlan.allNodes.length,
      totalUnits: scenePlan.allNodes.reduce((s, n) => s + n.physicalQty, 0),
      totalValue: scenePlan.allNodes.reduce((s, n) => s + n.totalValue, 0),
      alertCount: scenePlan.allNodes.filter((n) => n.hasAlert).length,
    };
  }, [scenePlan]);

  const currency = activeOrg?.currency ?? 'EUR';

  const handleWarehouseChange = (nextId: string) => {
    setSelectedWhId(nextId);
    setSearchParams({ warehouseId: nextId });
  };

  const handlePresetClick = (preset: CameraPreset3D) => {
    setCameraPreset(preset);
    setCameraPresetTrigger((t) => t + 1);
  };

  const handleSelectSearchNode = (node: LocationNode3D) => {
    setSelectedLocationId(node.location.id);
    setFocusLocationId(node.location.id);
    setFocusTrigger((t) => t + 1);
    setSearchQuery('');
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[560px] w-full rounded-xl" />
      </div>
    );
  }

  if (!activeWarehouse || !scenePlan) {
    return (
      <EmptyState
        icon={WarehouseIcon}
        title="Aucun entrepôt disponible pour la vue 3D"
        description="Créez d’abord un entrepôt et des emplacements pour générer le jumeau numérique 3D."
        action={
          <Link to="/entrepots">
            <Button type="button">Aller aux entrepôts</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="relative h-[calc(100vh-8.5rem)] min-h-[560px] w-full">
      <Warehouse3DCanvas
        plan={scenePlan}
        colorMode={colorMode}
        cameraPreset={cameraPreset}
        cameraPresetTrigger={cameraPresetTrigger}
        explodeFactor={explodeFactor}
        animateForklift={animateForklift}
        selectedLocationId={selectedLocationId}
        focusLocationId={focusLocationId}
        focusTrigger={focusTrigger}
        isDarkTheme={theme === 'dark'}
        onSelectLocation={setSelectedLocationId}
        onHoverLocation={setHoveredLocationId}
      />

      {/* Minimal Top-Left Navigation & Search Overlay (No backdrop-blur for smooth WebGL) */}
      <div className="pointer-events-none absolute top-3 left-3 right-3 flex items-start justify-between gap-3">
        <div className="pointer-events-auto flex flex-col gap-2 max-w-xl">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900/95">
            <Link
              to="/entrepots"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Entrepôts</span>
            </Link>

            <select
              aria-label="Sélectionner un entrepôt"
              value={activeWarehouse.id}
              onChange={(e) => handleWarehouseChange(e.target.value)}
              className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            >
              {warehouses.map((wh) => (
                <option key={wh.id} value={wh.id}>
                  {wh.code} — {wh.name}
                </option>
              ))}
            </select>

            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Emplacement ou SKU..."
                className="h-8 w-44 sm:w-52 rounded-lg border border-slate-200 bg-white pl-8 pr-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
              {searchMatches.length > 0 && (
                <div className="absolute left-0 top-9 z-30 w-64 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  {searchMatches.map((node) => (
                    <button
                      key={node.location.id}
                      type="button"
                      onClick={() => handleSelectSearchNode(node)}
                      className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <span className="font-mono font-semibold text-slate-900 dark:text-white">
                        {node.location.code}
                      </span>
                      <span className="text-slate-500 dark:text-slate-400 font-mono">
                        {formatNumber(node.physicalQty)} u. · {node.items.length} SKU
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Compact Readout Bar */}
          <div className="inline-flex w-fit items-center gap-3 rounded-lg border border-slate-200 bg-white/95 px-3 py-1.5 text-[11px] font-mono tabular-nums text-slate-600 shadow-xs dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-300">
            <span>{warehouseSummary.locCount} emplacements</span>
            <span>·</span>
            <span>{formatNumber(warehouseSummary.totalUnits)} unités</span>
            <span>·</span>
            <span>{formatCurrency(warehouseSummary.totalValue, currency)}</span>
            {warehouseSummary.alertCount > 0 && (
              <>
                <span>·</span>
                <span className="font-semibold text-red-600 dark:text-red-400">
                  {warehouseSummary.alertCount} alerte(s)
                </span>
              </>
            )}
          </div>
        </div>

        {/* Selected Location Inspector Panel (Right Side, Never Blocks Center) */}
        {selectedNode && (
          <aside className="pointer-events-auto w-80 sm:w-96 max-h-[calc(100vh-14.5rem)] flex flex-col rounded-xl border border-slate-200 bg-white/95 shadow-lg dark:border-slate-700 dark:bg-slate-900/95 overflow-hidden">
            <div className="flex items-start justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold text-slate-900 dark:text-white">
                    {selectedNode.location.code}
                  </span>
                  <StatusText
                    tone={
                      selectedNode.location.status === 'blocked'
                        ? 'neutral'
                        : selectedNode.hasAlert
                          ? 'error'
                          : 'success'
                    }
                    label={
                      selectedNode.location.status === 'blocked'
                        ? 'Bloqué'
                        : selectedNode.hasAlert
                          ? 'Alerte seuil'
                          : 'Actif'
                    }
                  />
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {ZONE_LABELS[selectedNode.location.zoneType] ?? selectedNode.location.zoneType} · Allée{' '}
                  {selectedNode.aisleKey} / Rack {selectedNode.location.rack || '—'} / Niv.{' '}
                  {selectedNode.location.level || '—'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLocationId(null)}
                aria-label="Fermer l’inspecteur"
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Occupancy bar */}
              <div>
                <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                  <span>Occupation</span>
                  <span>
                    {formatNumber(selectedNode.physicalQty)} /{' '}
                    {formatNumber(selectedNode.location.capacity)} u. (
                    {Math.round(selectedNode.occupancyRatio * 100)} %)
                  </span>
                </div>
                <div className="mt-1.5 h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      selectedNode.occupancyRatio >= 0.9
                        ? 'bg-red-600'
                        : selectedNode.occupancyRatio >= 0.7
                          ? 'bg-amber-500'
                          : 'bg-emerald-600'
                    }`}
                    style={{ width: `${Math.min(100, Math.round(selectedNode.occupancyRatio * 100))}%` }}
                  />
                </div>
              </div>

              {/* Quick numeric grid */}
              <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-center dark:border-slate-800 dark:bg-slate-950">
                <div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Disponible</p>
                  <p className="font-mono text-xs font-bold tabular-nums text-slate-900 dark:text-white">
                    {formatNumber(selectedNode.availableQty)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Réservé</p>
                  <p className="font-mono text-xs font-bold tabular-nums text-amber-600 dark:text-amber-400">
                    {formatNumber(selectedNode.reservedQty)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Valeur</p>
                  <p className="font-mono text-xs font-bold tabular-nums text-slate-900 dark:text-white">
                    {formatCurrency(selectedNode.totalValue, currency)}
                  </p>
                </div>
              </div>

              {/* Stored SKUs */}
              <div>
                <p className="text-xs font-semibold text-slate-900 dark:text-white">
                  Articles stockés ({selectedNode.items.length})
                </p>
                {selectedNode.items.length === 0 ? (
                  <p className="mt-2 rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    Emplacement libre sans stock physique.
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {selectedNode.items.map((item) => (
                      <div
                        key={item.balance.id}
                        className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-950"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-slate-900 dark:text-white">
                              {item.product?.name ?? 'Produit inconnu'}
                            </p>
                            <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              {item.product?.sku ?? item.balance.productId}
                            </p>
                          </div>
                          {(item.isOutOfStock || item.isLowStock) && (
                            <StatusText
                              tone={item.isOutOfStock ? 'error' : 'warning'}
                              label={item.isOutOfStock ? 'Rupture' : 'Sous seuil'}
                            />
                          )}
                        </div>
                        <div className="mt-2 flex items-center justify-between font-mono text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
                          <span>Physique : {formatNumber(item.balance.physicalQty)}</span>
                          <span>Dispo : {formatNumber(item.balance.availableQty)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
              <Link to="/stocks" className="flex-1">
                <Button type="button" size="sm" className="w-full">
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  <span>Mouvement</span>
                </Button>
              </Link>
              <Link to="/entrepots" className="flex-1">
                <Button type="button" size="sm" variant="outline" className="w-full">
                  <span>Fiche entrepôt</span>
                </Button>
              </Link>
            </div>
          </aside>
        )}
      </div>

      {/* Subtle Hover Readout when hovering a slot */}
      {hoveredNode && hoveredNode.location.id !== selectedLocationId && (
        <div className="pointer-events-none absolute top-3 right-3 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-sm dark:border-slate-700 dark:bg-slate-900/95">
          <p className="font-mono font-bold text-slate-900 dark:text-white">
            {hoveredNode.location.code} · {ZONE_LABELS[hoveredNode.location.zoneType] ?? hoveredNode.location.zoneType}
          </p>
          <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
            {formatNumber(hoveredNode.physicalQty)} / {formatNumber(hoveredNode.location.capacity)} u. ·{' '}
            {hoveredNode.items.length} SKU
          </p>
        </div>
      )}

      {/* Collapsible Bottom Control Dock (Centered, No backdrop-blur) */}
      <div className="pointer-events-auto absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center max-w-[96%]">
        <button
          type="button"
          onClick={() => setControlsCollapsed((prev) => !prev)}
          className="inline-flex items-center gap-1.5 rounded-t-lg border border-b-0 border-slate-200 bg-white/95 px-3 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-300 dark:hover:text-white cursor-pointer"
        >
          {controlsCollapsed ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              <span>Afficher contrôles (H)</span>
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              <span>Masquer contrôles (H)</span>
            </>
          )}
        </button>

        {!controlsCollapsed && (
          <div className="flex flex-col gap-2.5 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg dark:border-slate-700 dark:bg-slate-900/95">
            <div className="flex flex-wrap items-center justify-center gap-3">
              {/* Color Mode Segmented Control */}
              <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                {(
                  [
                    { id: 'occupancy', label: 'Occupation' },
                    { id: 'zone', label: 'Zones' },
                    { id: 'alerts', label: 'Alertes' },
                  ] as const
                ).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setColorMode(mode.id)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                      colorMode === mode.id
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              <div className="h-5 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block" />

              {/* Camera Presets */}
              <div className="flex items-center gap-1">
                {(
                  [
                    { id: 'iso', label: 'Isométrique' },
                    { id: 'top', label: 'Plan' },
                    { id: 'aisle', label: 'Allée' },
                    { id: 'docks', label: 'Quais' },
                  ] as const
                ).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handlePresetClick(preset.id)}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                      cameraPreset === preset.id
                        ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-300'
                        : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="h-5 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block" />

              {/* Exploded Shelf View Slider */}
              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <Layers className="h-3.5 w-3.5 text-slate-500" />
                <span>Éclaté</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={explodeFactor}
                  onChange={(e) => setExplodeFactor(Number.parseFloat(e.target.value))}
                  className="w-20 accent-blue-600 cursor-pointer"
                />
                <span className="w-8 font-mono text-[11px] tabular-nums">
                  {Math.round(explodeFactor * 100)}%
                </span>
              </label>

              {/* Forklift Patrol Toggle */}
              <button
                type="button"
                onClick={() => setAnimateForklift((prev) => !prev)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer"
              >
                {animateForklift ? (
                  <Pause className="h-3.5 w-3.5 text-blue-600" />
                ) : (
                  <Play className="h-3.5 w-3.5 text-slate-500" />
                )}
                <span>Chariot : {animateForklift ? 'Actif' : 'Pause'}</span>
              </button>
            </div>

            {/* Static Color Legend Row (No pills, flat swatches) */}
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-slate-200 pt-2 text-[11px] text-slate-600 dark:border-slate-800 dark:text-slate-400">
              {LEGEND_BY_MODE[colorMode].map((item) => (
                <span key={item.label} className="inline-flex items-center gap-1.5">
                  <span className={`h-2.5 w-2.5 rounded-xs ${item.color}`} aria-hidden="true" />
                  <span>{item.label}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
