import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRightLeft,
  Box,
  Boxes,
  CheckCircle2,
  Info,
  PackageX,
  Plus,
  Warehouse as WarehouseIcon,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useErpData } from '../hooks/useErpData.ts';
import { formatCurrency, formatDateTime, formatNumber, toDate } from '../shared/formatters.ts';
import { Button } from '../components/ui/Button.tsx';
import { Skeleton } from '../components/ui/Skeleton.tsx';
import { StatusText } from '../components/ui/StatusText.tsx';

export function DashboardPage() {
  const navigate = useNavigate();
  const { activeOrg } = useAuth();
  const {
    products,
    warehouses,
    locations,
    balances,
    movements,
    auditLogs,
    purchaseOrders,
    supplierInvoices,
    customers,
    salesOrders,
    salesInvoices,
    payments,
    isLoading,
    error,
  } = useErpData();

  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('ALL');
  const currency = activeOrg?.currency ?? 'EUR';

  const filteredBalances = useMemo(() => {
    if (selectedWarehouseId === 'ALL') return balances;
    return balances.filter((b) => b.warehouseId === selectedWarehouseId);
  }, [balances, selectedWarehouseId]);

  const filteredMovements = useMemo(() => {
    if (selectedWarehouseId === 'ALL') return movements;
    return movements.filter(
      (m) => m.warehouseId === selectedWarehouseId || m.targetWarehouseId === selectedWarehouseId
    );
  }, [movements, selectedWarehouseId]);

  const metrics = useMemo(() => {
    const totalStockValue = filteredBalances.reduce(
      (acc, b) => acc + b.physicalQty * b.unitCost,
      0
    );
    const totalPhysicalUnits = filteredBalances.reduce((acc, b) => acc + b.physicalQty, 0);

    const qtyByProduct = new Map<string, number>();
    for (const bal of filteredBalances) {
      qtyByProduct.set(bal.productId, (qtyByProduct.get(bal.productId) ?? 0) + bal.availableQty);
    }

    const activeProducts = products.filter((p) => p.status === 'active');
    const outOfStockProducts = activeProducts.filter(
      (p) => (qtyByProduct.get(p.id) ?? 0) <= 0
    );
    const lowStockProducts = activeProducts.filter((p) => {
      const q = qtyByProduct.get(p.id) ?? 0;
      return q > 0 && q <= p.minStock;
    });

    const openPurchaseOrders = purchaseOrders.filter(
      (po) => po.status === 'confirmed' || po.status === 'partially_received'
    );
    const openPurchaseOrdersTtc = openPurchaseOrders.reduce((acc, po) => acc + po.totalTtc, 0);
    const supplierPayablesTtc = supplierInvoices.reduce(
      (acc, inv) => acc + Math.max(0, inv.totalTtc - inv.paidAmount),
      0
    );

    const openSalesOrders = salesOrders.filter(
      (so) =>
        so.status === 'confirmed' ||
        so.status === 'preparing' ||
        so.status === 'partially_delivered'
    );
    const openSalesOrdersTtc = openSalesOrders.reduce((acc, so) => acc + so.totalTtc, 0);
    const netRevenueTtc = salesInvoices.reduce(
      (acc, inv) => acc + (inv.invoiceType === 'credit_note' ? -inv.totalTtc : inv.totalTtc),
      0
    );
    const unpaidCustomerInvoices = salesInvoices.filter(
      (inv) => inv.invoiceType !== 'credit_note' && inv.status !== 'paid'
    );
    const unpaidCustomerTtc = unpaidCustomerInvoices.reduce(
      (acc, inv) => acc + Math.max(0, inv.totalTtc - inv.paidAmount),
      0
    );
    const netCashflow = payments.reduce(
      (acc, p) => acc + (p.direction === 'incoming' ? p.amount : -p.amount),
      0
    );

    return {
      totalStockValue,
      totalPhysicalUnits,
      activeProductCount: activeProducts.length,
      outOfStockProducts,
      lowStockProducts,
      qtyByProduct,
      warehouseCount: warehouses.filter((w) => w.status === 'active').length,
      locationCount: locations.length,
      movementCount: filteredMovements.length,
      openPurchaseOrdersCount: openPurchaseOrders.length,
      openPurchaseOrdersTtc,
      supplierPayablesTtc,
      openSalesOrdersCount: openSalesOrders.length,
      openSalesOrdersTtc,
      netRevenueTtc,
      unpaidCustomerCount: unpaidCustomerInvoices.length,
      unpaidCustomerTtc,
      activeCustomersCount: customers.filter((c) => c.status === 'active').length,
      netCashflow,
    };
  }, [
    products,
    filteredBalances,
    warehouses,
    locations,
    filteredMovements,
    purchaseOrders,
    supplierInvoices,
    salesOrders,
    salesInvoices,
    customers,
    payments,
  ]);

  const valueByWarehouseData = useMemo(() => {
    return warehouses.map((wh) => {
      const whBalances = balances.filter((b) => b.warehouseId === wh.id);
      const value = whBalances.reduce((acc, b) => acc + b.physicalQty * b.unitCost, 0);
      const units = whBalances.reduce((acc, b) => acc + b.physicalQty, 0);
      return {
        name: wh.code,
        fullName: wh.name,
        valeur: Number(value.toFixed(2)),
        unites: units,
      };
    });
  }, [warehouses, balances]);

  const valueByCategoryData = useMemo(() => {
    const productMap = new Map(products.map((p) => [p.id, p]));
    const catTotals = new Map<string, number>();
    for (const b of filteredBalances) {
      const prod = productMap.get(b.productId);
      const cat = prod?.categoryName || 'Non classé';
      catTotals.set(cat, (catTotals.get(cat) ?? 0) + b.physicalQty * b.unitCost);
    }
    return Array.from(catTotals.entries())
      .map(([name, valeur]) => ({ name, valeur: Number(valeur.toFixed(2)) }))
      .sort((a, b) => b.valeur - a.valeur);
  }, [products, filteredBalances]);

  const salesVsPurchasesData = useMemo(() => {
    const monthly = new Map<string, { month: string; ventes: number; achats: number }>();
    const ensureMonth = (key: string) => {
      let entry = monthly.get(key);
      if (!entry) {
        entry = { month: key, ventes: 0, achats: 0 };
        monthly.set(key, entry);
      }
      return entry;
    };

    for (const inv of salesInvoices) {
      const monthKey = inv.issueDate?.slice(0, 7) || toDate(inv.createdAt)?.toISOString().slice(0, 7);
      if (!monthKey) continue;
      const entry = ensureMonth(monthKey);
      const sign = inv.invoiceType === 'credit_note' ? -1 : 1;
      entry.ventes = Number((entry.ventes + sign * inv.totalTtc).toFixed(2));
    }

    for (const po of purchaseOrders) {
      if (po.status === 'canceled' || po.status === 'draft') continue;
      const monthKey = toDate(po.createdAt)?.toISOString().slice(0, 7);
      if (!monthKey) continue;
      const entry = ensureMonth(monthKey);
      entry.achats = Number((entry.achats + po.totalTtc).toFixed(2));
    }

    return Array.from(monthly.values())
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-6);
  }, [salesInvoices, purchaseOrders]);

  const alertItems = useMemo(() => {
    return [
      ...metrics.outOfStockProducts.map((p) => ({
        product: p,
        available: metrics.qtyByProduct.get(p.id) ?? 0,
        severity: 'error' as const,
        label: 'Rupture',
      })),
      ...metrics.lowStockProducts.map((p) => ({
        product: p,
        available: metrics.qtyByProduct.get(p.id) ?? 0,
        severity: 'warning' as const,
        label: 'Sous seuil',
      })),
    ];
  }, [metrics]);

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
        Impossible de charger les indicateurs du tableau de bord : {error instanceof Error ? error.message : 'Erreur inconnue'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Accueil / Dashboard
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Tableau de bord
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Filtrer par entrepôt"
            value={selectedWarehouseId}
            onChange={(e) => setSelectedWarehouseId(e.target.value)}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="ALL">Tous les entrepôts</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
          <Button type="button" onClick={() => navigate('/stocks?action=new')}>
            <Plus className="h-4 w-4" />
            <span>Nouveau mouvement</span>
          </Button>
        </div>
      </div>

      {/* Demo Data Notice (clearly identified per rule 8) */}
      {activeOrg?.isDemoSeeded && (
        <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3 text-xs text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200">
          <Info className="h-4 w-4 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
          <div className="flex-1">
            <span className="font-semibold">Jeu de données de démonstration actif</span>
            <span className="mx-1.5" aria-hidden="true">·</span>
            <span>
              Les produits, entrepôts et mouvements initiaux marqués comme démonstration sont persistés dans votre espace isolé et entièrement modifiables.
            </span>
          </div>
        </div>
      )}

      {/* KPI Strip */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="mt-3 h-7 w-28" />
              <Skeleton className="mt-2 h-3 w-20" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Valeur du stock</span>
              <Boxes className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <p className="mt-2 font-mono text-xl font-semibold text-slate-900 dark:text-white tabular-nums">
              {formatCurrency(metrics.totalStockValue, currency)}
            </p>
            <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
              {formatNumber(metrics.totalPhysicalUnits)} unités physiques
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Produits actifs</span>
              <Box className="h-4 w-4 text-slate-400" />
            </div>
            <p className="mt-2 font-mono text-xl font-semibold text-slate-900 dark:text-white tabular-nums">
              {metrics.activeProductCount}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Sur {products.length} fiches catalogue
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>En rupture</span>
              <PackageX className="h-4 w-4 text-red-600 dark:text-red-400" />
            </div>
            <p className="mt-2 font-mono text-xl font-semibold text-red-600 dark:text-red-400 tabular-nums">
              {metrics.outOfStockProducts.length}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Stock disponible ≤ 0
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Sous seuil min.</span>
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <p className="mt-2 font-mono text-xl font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
              {metrics.lowStockProducts.length}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Réapprovisionnement conseillé
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Entrepôts actifs</span>
              <WarehouseIcon className="h-4 w-4 text-slate-400" />
            </div>
            <p className="mt-2 font-mono text-xl font-semibold text-slate-900 dark:text-white tabular-nums">
              {metrics.warehouseCount}
            </p>
            <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
              {metrics.locationCount} emplacements
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Mouvements</span>
              <ArrowRightLeft className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="mt-2 font-mono text-xl font-semibold text-slate-900 dark:text-white tabular-nums">
              {metrics.movementCount}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Journal traçable vérifié
            </p>
          </div>
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Valorisation du stock par entrepôt
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Calculée en temps réel à partir des soldes validés ({currency})
              </p>
            </div>
          </div>
          <div className="mt-4 h-64 w-full">
            {valueByWarehouseData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-slate-400">
                Aucun entrepôt configuré.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={valueByWarehouseData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(val) => [formatCurrency(Number(val ?? 0), currency), 'Valeur']}
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="valeur" fill="#2563eb" radius={[6, 6, 0, 0]} maxBarSize={56} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Répartition par catégorie
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Valeur stockée ventilée par famille de produits ({currency})
            </p>
          </div>
          <div className="mt-4 h-64 w-full">
            {valueByCategoryData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-slate-400">
                Aucune valorisation enregistrée.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={valueByCategoryData}
                  layout="vertical"
                  margin={{ top: 8, right: 20, left: 10, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={130}
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(val) => [formatCurrency(Number(val ?? 0), currency), 'Valeur']}
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="valeur" radius={[0, 6, 6, 0]} maxBarSize={28}>
                    {valueByCategoryData.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={index === 0 ? '#0f172a' : index === 1 ? '#2563eb' : '#64748b'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Operational Alerts + Recent Operations & Audit */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Stock Alerts */}
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Alertes de stock critiques
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Produits en rupture ou sous le seuil de sécurité
              </p>
            </div>
            <Link
              to="/stocks"
              className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400 whitespace-nowrap"
            >
              Gérer les stocks
            </Link>
          </div>
          {alertItems.length === 0 ? (
            <div className="flex items-center gap-3 px-5 py-8 text-sm text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <span>Tous les produits actifs respectent les seuils minimums configurés.</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/70 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Produit</th>
                    <th className="px-4 py-2.5 font-medium text-right">Dispo / Min</th>
                    <th className="px-4 py-2.5 font-medium">État</th>
                    <th className="px-4 py-2.5 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {alertItems.slice(0, 6).map((item) => (
                    <tr key={item.product.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-900 dark:text-slate-100 truncate max-w-[200px]">
                          {item.product.name}
                        </p>
                        <p className="font-mono text-xs text-slate-500">{item.product.sku}</p>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-slate-700 dark:text-slate-300">
                        {formatNumber(item.available)} / {formatNumber(item.product.minStock)} {item.product.unit}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusText tone={item.severity} label={item.label} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/stocks?action=new&productId=${item.product.id}`)}
                        >
                          Entrée stock
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent Movements & Audit */}
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Dernières opérations &amp; audit
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Mouvements de stock et événements utilisateurs récents
              </p>
            </div>
            <Link
              to="/parametres?tab=audit"
              className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400 whitespace-nowrap"
            >
              Journal complet
            </Link>
          </div>
          {filteredMovements.length === 0 && auditLogs.length === 0 ? (
            <p className="px-5 py-8 text-center text-xs text-slate-500">
              Aucune opération enregistrée pour le moment.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredMovements.slice(0, 5).map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                        {m.reference}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{m.movementType}</span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">{m.warehouseName}</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs font-medium text-slate-900 dark:text-slate-100">
                      {m.productSku} — {m.productName}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p
                      className={`font-mono text-xs font-semibold tabular-nums ${
                        m.movementType === 'OUT'
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                    </p>
                    <p className="text-[11px] text-slate-400 font-mono">
                      {formatDateTime(m.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Phase 3 & 4 Commercial & Purchasing Operations + Interactive Chart */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Évolution mensuelle Ventes vs Achats ({currency})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Facturation client nette TTC comparée aux commandes fournisseurs engagées
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link
                to="/ventes"
                className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400 whitespace-nowrap"
              >
                Ventes
              </Link>
              <Link
                to="/achats"
                className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400 whitespace-nowrap"
              >
                Achats
              </Link>
            </div>
          </div>
          <div className="mt-4 h-60 w-full">
            {salesVsPurchasesData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-slate-400">
                Aucune facture client ni commande fournisseur enregistrée sur la période.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={salesVsPurchasesData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(val, name) => [
                      formatCurrency(Number(val ?? 0), currency),
                      name === 'ventes' ? 'Ventes TTC' : 'Achats TTC',
                    ]}
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                      fontSize: '12px',
                    }}
                  />
                  <Legend
                    formatter={(value) => (value === 'ventes' ? 'Ventes TTC' : 'Achats TTC')}
                    wrapperStyle={{ fontSize: '12px' }}
                  />
                  <Bar dataKey="ventes" fill="#2563eb" radius={[6, 6, 0, 0]} maxBarSize={36} />
                  <Bar dataKey="achats" fill="#0f172a" radius={[6, 6, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Flux commerciaux &amp; trésorerie
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Synthèse temps réel achats, ventes et recouvrements
            </p>
            <div className="mt-4 space-y-3.5 border-t border-slate-100 pt-4 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">Chiffre d’affaires TTC</span>
                <span className="font-mono text-sm font-semibold text-slate-900 dark:text-white tabular-nums">
                  {formatCurrency(metrics.netRevenueTtc, currency)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">Commandes clients en cours</span>
                <span className="font-mono text-sm font-semibold text-slate-900 dark:text-white tabular-nums">
                  {metrics.openSalesOrdersCount} · {formatCurrency(metrics.openSalesOrdersTtc, currency)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">Factures clients impayées</span>
                <span className="font-mono text-sm font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                  {metrics.unpaidCustomerCount} · {formatCurrency(metrics.unpaidCustomerTtc, currency)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">Commandes fournisseurs</span>
                <span className="font-mono text-sm font-semibold text-slate-900 dark:text-white tabular-nums">
                  {metrics.openPurchaseOrdersCount} · {formatCurrency(metrics.openPurchaseOrdersTtc, currency)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">Factures fournisseurs à régler</span>
                <span className="font-mono text-sm font-semibold text-slate-900 dark:text-white tabular-nums">
                  {formatCurrency(metrics.supplierPayablesTtc, currency)}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <Link
              to="/facturation"
              className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              Facturation
            </Link>
            <span className="text-slate-300" aria-hidden="true">·</span>
            <Link
              to="/paiements"
              className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              Paiements
            </Link>
            <span className="text-slate-300" aria-hidden="true">·</span>
            <Link
              to="/clients"
              className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              Clients ({metrics.activeCustomersCount})
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
