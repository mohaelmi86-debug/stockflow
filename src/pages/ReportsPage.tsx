import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  Download,
  Printer,
  Search,
  TrendingUp,
  Truck,
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
import { useToast } from '../contexts/ToastContext.tsx';
import { useErpData } from '../hooks/useErpData.ts';
import { formatCurrency, formatNumber, toDate } from '../shared/formatters.ts';
import { Button } from '../components/ui/Button.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { Skeleton, TableSkeleton } from '../components/ui/Skeleton.tsx';
import { StatusText } from '../components/ui/StatusText.tsx';

type ReportTab = 'stock' | 'margins' | 'purchasing';
type PeriodDays = '7' | '30' | '90' | '365' | 'ALL';

function escapeCsvCell(value: string | number): string {
  const s = String(value ?? '');
  if (s.includes(';') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadCsvFile(filename: string, headers: string[], rows: Array<Array<string | number>>) {
  const lines = [
    headers.map(escapeCsvCell).join(';'),
    ...rows.map((r) => r.map(escapeCsvCell).join(';')),
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ReportsPage() {
  const { activeOrg } = useAuth();
  const { toast } = useToast();
  const {
    products,
    categories,
    warehouses,
    balances,
    movements,
    suppliers,
    purchaseOrders,
    supplierInvoices,
    salesInvoices,
    isLoading,
  } = useErpData();

  const [activeTab, setActiveTab] = useState<ReportTab>('stock');
  const [period, setPeriod] = useState<PeriodDays>('90');
  const [warehouseId, setWarehouseId] = useState<string>('ALL');
  const [categoryId, setCategoryId] = useState<string>('ALL');
  const [search, setSearch] = useState('');

  const currency = activeOrg?.currency ?? 'EUR';

  const cutoffMs = useMemo(() => {
    if (period === 'ALL') return 0;
    const days = Number(period);
    return Date.now() - days * 86_400_000;
  }, [period]);

  const inPeriod = (dateValue: unknown, isoFallback?: string): boolean => {
    if (cutoffMs === 0) return true;
    const d = toDate(dateValue) ?? (isoFallback ? new Date(isoFallback) : null);
    if (!d || Number.isNaN(d.getTime())) return true;
    return d.getTime() >= cutoffMs;
  };

  // Filtered Balances & Movements
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (categoryId !== 'ALL' && p.categoryId !== categoryId) return false;
      return true;
    });
  }, [products, categoryId]);

  const allowedProductIds = useMemo(
    () => new Set(filteredProducts.map((p) => p.id)),
    [filteredProducts]
  );

  const filteredBalances = useMemo(() => {
    return balances.filter((b) => {
      if (warehouseId !== 'ALL' && b.warehouseId !== warehouseId) return false;
      if (categoryId !== 'ALL' && !allowedProductIds.has(b.productId)) return false;
      return true;
    });
  }, [balances, warehouseId, categoryId, allowedProductIds]);

  const filteredMovements = useMemo(() => {
    return movements.filter((m) => {
      if (!inPeriod(m.createdAt)) return false;
      if (
        warehouseId !== 'ALL' &&
        m.warehouseId !== warehouseId &&
        m.targetWarehouseId !== warehouseId
      ) {
        return false;
      }
      if (categoryId !== 'ALL' && !allowedProductIds.has(m.productId)) return false;
      return true;
    });
  }, [movements, cutoffMs, warehouseId, categoryId, allowedProductIds]);

  // Tab 1: Stock Valuation & Rotation Metrics
  const stockReport = useMemo(() => {
    const aggMap = new Map<
      string,
      { physical: number; reserved: number; available: number; value: number; outboundQty: number }
    >();

    for (const b of filteredBalances) {
      const prev = aggMap.get(b.productId) ?? {
        physical: 0,
        reserved: 0,
        available: 0,
        value: 0,
        outboundQty: 0,
      };
      aggMap.set(b.productId, {
        ...prev,
        physical: prev.physical + b.physicalQty,
        reserved: prev.reserved + b.reservedQty,
        available: prev.available + b.availableQty,
        value: prev.value + b.physicalQty * b.unitCost,
      });
    }

    for (const m of filteredMovements) {
      if (m.movementType === 'OUT') {
        const prev = aggMap.get(m.productId) ?? {
          physical: 0,
          reserved: 0,
          available: 0,
          value: 0,
          outboundQty: 0,
        };
        aggMap.set(m.productId, {
          ...prev,
          outboundQty: prev.outboundQty + Math.abs(m.quantity),
        });
      }
    }

    const rows = filteredProducts.map((p) => {
      const a = aggMap.get(p.id) ?? {
        physical: 0,
        reserved: 0,
        available: 0,
        value: 0,
        outboundQty: 0,
      };
      const avgUnitCost = a.physical > 0 ? a.value / a.physical : p.purchasePrice;
      const rotationRate = a.physical > 0 ? a.outboundQty / a.physical : 0;
      let statusLabel = 'Nominal';
      let tone: 'success' | 'warning' | 'error' | 'info' = 'success';
      if (a.available <= 0) {
        statusLabel = 'Rupture';
        tone = 'error';
      } else if (a.available <= p.minStock) {
        statusLabel = 'Sous seuil';
        tone = 'warning';
      } else if (p.maxStock > 0 && a.physical > p.maxStock) {
        statusLabel = 'Surstock';
        tone = 'info';
      }

      return {
        product: p,
        physical: a.physical,
        reserved: a.reserved,
        available: a.available,
        outboundQty: a.outboundQty,
        avgUnitCost,
        value: a.value,
        rotationRate,
        statusLabel,
        tone,
      };
    });

    const totalValue = rows.reduce((s, r) => s + r.value, 0);
    const totalPhysical = rows.reduce((s, r) => s + r.physical, 0);
    const totalOutbound = rows.reduce((s, r) => s + r.outboundQty, 0);
    const alertCount = rows.filter((r) => r.tone === 'error' || r.tone === 'warning').length;
    const overstockCount = rows.filter((r) => r.tone === 'info').length;

    const q = search.trim().toLowerCase();
    const visibleRows = q
      ? rows.filter(
          (r) =>
            r.product.sku.toLowerCase().includes(q) ||
            r.product.name.toLowerCase().includes(q) ||
            (r.product.categoryName ?? '').toLowerCase().includes(q)
        )
      : rows;

    return {
      rows: visibleRows.sort((a, b) => b.value - a.value),
      totalValue,
      totalPhysical,
      totalOutbound,
      alertCount,
      overstockCount,
    };
  }, [filteredProducts, filteredBalances, filteredMovements, search]);

  const stockFlowChartData = useMemo(() => {
    const byDay = new Map<string, { date: string; entrees: number; sorties: number }>();
    for (const m of filteredMovements) {
      const d = toDate(m.createdAt);
      const key = d ? d.toISOString().slice(0, 10) : 'Récent';
      const entry = byDay.get(key) ?? { date: key, entrees: 0, sorties: 0 };
      if (m.movementType === 'IN') entry.entrees += Math.abs(m.quantity);
      if (m.movementType === 'OUT') entry.sorties += Math.abs(m.quantity);
      byDay.set(key, entry);
    }
    return Array.from(byDay.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14);
  }, [filteredMovements]);

  const warehouseValuationChartData = useMemo(() => {
    return warehouses.map((wh) => {
      const whBals = filteredBalances.filter((b) => b.warehouseId === wh.id);
      const val = whBals.reduce((s, b) => s + b.physicalQty * b.unitCost, 0);
      return {
        name: wh.code,
        valeur: Number(val.toFixed(2)),
      };
    });
  }, [warehouses, filteredBalances]);

  // Tab 2: Commercial Margins & Revenue
  const marginsReport = useMemo(() => {
    const productMap = new Map(products.map((p) => [p.id, p]));
    const periodInvoices = salesInvoices.filter((inv) => inPeriod(inv.createdAt, inv.issueDate));

    let netRevenueHt = 0;
    let netRevenueTtc = 0;
    let estimatedCogs = 0;
    let unpaidTtc = 0;

    const prodStats = new Map<
      string,
      {
        sku: string;
        name: string;
        qtySold: number;
        revenueHt: number;
        cogs: number;
      }
    >();

    const monthlyMap = new Map<string, { month: string; caHt: number; marge: number }>();

    for (const inv of periodInvoices) {
      const sign = inv.invoiceType === 'credit_note' ? -1 : 1;
      netRevenueHt += sign * inv.totalHt;
      netRevenueTtc += sign * inv.totalTtc;
      if (inv.invoiceType !== 'credit_note' && inv.status !== 'paid') {
        unpaidTtc += Math.max(0, inv.totalTtc - inv.paidAmount);
      }

      let invCogs = 0;
      for (const line of inv.lines) {
        if (categoryId !== 'ALL' && !allowedProductIds.has(line.productId)) continue;
        const prod = productMap.get(line.productId);
        const lineHt = line.quantity * line.unitPrice * (1 - (line.discountPct || 0) / 100);
        const unitCost = prod?.purchasePrice ?? line.unitPrice * 0.65;
        const lineCogs = line.quantity * unitCost;
        invCogs += sign * lineCogs;

        const prev = prodStats.get(line.productId) ?? {
          sku: line.productSku,
          name: line.productName,
          qtySold: 0,
          revenueHt: 0,
          cogs: 0,
        };
        prodStats.set(line.productId, {
          ...prev,
          qtySold: prev.qtySold + sign * line.quantity,
          revenueHt: prev.revenueHt + sign * lineHt,
          cogs: prev.cogs + sign * lineCogs,
        });
      }
      estimatedCogs += invCogs;

      const mKey = inv.issueDate?.slice(0, 7) || toDate(inv.createdAt)?.toISOString().slice(0, 7);
      if (mKey) {
        const prevM = monthlyMap.get(mKey) ?? { month: mKey, caHt: 0, marge: 0 };
        const htDelta = sign * inv.totalHt;
        monthlyMap.set(mKey, {
          month: mKey,
          caHt: Number((prevM.caHt + htDelta).toFixed(2)),
          marge: Number((prevM.marge + (htDelta - invCogs)).toFixed(2)),
        });
      }
    }

    const grossMargin = netRevenueHt - estimatedCogs;
    const marginRatePct = netRevenueHt > 0 ? (grossMargin / netRevenueHt) * 100 : 0;

    const q = search.trim().toLowerCase();
    const productRows = Array.from(prodStats.entries())
      .map(([productId, s]) => {
        const margin = s.revenueHt - s.cogs;
        const pct = s.revenueHt > 0 ? (margin / s.revenueHt) * 100 : 0;
        return { productId, ...s, margin, marginPct: pct };
      })
      .filter((r) => !q || r.sku.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
      .sort((a, b) => b.margin - a.margin);

    return {
      netRevenueHt,
      netRevenueTtc,
      estimatedCogs,
      grossMargin,
      marginRatePct,
      unpaidTtc,
      invoiceCount: periodInvoices.length,
      productRows,
      monthlyData: Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month)),
    };
  }, [salesInvoices, products, categoryId, allowedProductIds, cutoffMs, search]);

  // Tab 3: Purchasing & Suppliers Performance
  const purchasingReport = useMemo(() => {
    const periodOrders = purchaseOrders.filter(
      (po) => po.status !== 'canceled' && inPeriod(po.createdAt) && (warehouseId === 'ALL' || po.warehouseId === warehouseId)
    );

    const spendBySupplier = new Map<string, { orders: number; totalTtc: number }>();
    for (const po of periodOrders) {
      const prev = spendBySupplier.get(po.supplierId) ?? { orders: 0, totalTtc: 0 };
      spendBySupplier.set(po.supplierId, {
        orders: prev.orders + 1,
        totalTtc: prev.totalTtc + po.totalTtc,
      });
    }

    const totalCommittedTtc = periodOrders.reduce((s, po) => s + po.totalTtc, 0);
    const openOrdersCount = periodOrders.filter(
      (po) => po.status === 'confirmed' || po.status === 'partially_received'
    ).length;
    const payablesTtc = supplierInvoices.reduce(
      (s, inv) => s + Math.max(0, inv.totalTtc - inv.paidAmount),
      0
    );

    const activeSuppliers = suppliers.filter((s) => s.status === 'active');
    const avgOnTime = activeSuppliers.length
      ? activeSuppliers.reduce((s, sup) => s + sup.onTimeRate, 0) / activeSuppliers.length
      : 0;
    const avgLeadDays = activeSuppliers.length
      ? activeSuppliers.reduce((s, sup) => s + sup.leadTimeDays, 0) / activeSuppliers.length
      : 0;

    const q = search.trim().toLowerCase();
    const rows = suppliers
      .map((sup) => {
        const st = spendBySupplier.get(sup.id) ?? { orders: 0, totalTtc: 0 };
        return {
          supplier: sup,
          ordersCount: st.orders,
          totalTtc: st.totalTtc,
        };
      })
      .filter(
        (r) =>
          !q ||
          r.supplier.code.toLowerCase().includes(q) ||
          r.supplier.name.toLowerCase().includes(q)
      )
      .sort((a, b) => b.totalTtc - a.totalTtc);

    const chartData = rows
      .filter((r) => r.totalTtc > 0)
      .slice(0, 8)
      .map((r) => ({
        name: r.supplier.code,
        fullName: r.supplier.name,
        montant: Number(r.totalTtc.toFixed(2)),
      }));

    return {
      totalCommittedTtc,
      openOrdersCount,
      payablesTtc,
      avgOnTime,
      avgLeadDays,
      rows,
      chartData,
    };
  }, [purchaseOrders, supplierInvoices, suppliers, warehouseId, cutoffMs, search]);

  const handleExportCsv = () => {
    if (activeTab === 'stock') {
      downloadCsvFile(
        `stockflow-rapport-stocks-${new Date().toISOString().slice(0, 10)}.csv`,
        [
          'SKU',
          'Produit',
          'Catégorie',
          'Stock Physique',
          'Réservé',
          'Disponible',
          'Sorties Période',
          'Coût Unitaire',
          'Valorisation',
          'État',
        ],
        stockReport.rows.map((r) => [
          r.product.sku,
          r.product.name,
          r.product.categoryName || 'Non classé',
          r.physical,
          r.reserved,
          r.available,
          r.outboundQty,
          r.avgUnitCost.toFixed(2),
          r.value.toFixed(2),
          r.statusLabel,
        ])
      );
    } else if (activeTab === 'margins') {
      downloadCsvFile(
        `stockflow-rapport-marges-${new Date().toISOString().slice(0, 10)}.csv`,
        ['SKU', 'Produit', 'Quantité Vendue', 'CA HT', 'Coût Achat Estimé', 'Marge Brute', 'Taux Marge %'],
        marginsReport.productRows.map((r) => [
          r.sku,
          r.name,
          r.qtySold,
          r.revenueHt.toFixed(2),
          r.cogs.toFixed(2),
          r.margin.toFixed(2),
          r.marginPct.toFixed(1),
        ])
      );
    } else {
      downloadCsvFile(
        `stockflow-rapport-fournisseurs-${new Date().toISOString().slice(0, 10)}.csv`,
        ['Code', 'Fournisseur', 'Commandes', 'Engagé TTC', 'Délai (j)', 'Ponctualité %', 'Note /5', 'Statut'],
        purchasingReport.rows.map((r) => [
          r.supplier.code,
          r.supplier.name,
          r.ordersCount,
          r.totalTtc.toFixed(2),
          r.supplier.leadTimeDays,
          r.supplier.onTimeRate,
          r.supplier.rating,
          r.supplier.status === 'active' ? 'Actif' : 'Inactif',
        ])
      );
    }
    toast({
      variant: 'success',
      title: 'Export CSV généré',
      description: 'Le fichier compatible Excel a été téléchargé.',
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Accueil / Pilotage / Rapports &amp; Analyses
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Rapports &amp; Analyses
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 print:hidden">
          <Button type="button" variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            <span>Imprimer / PDF</span>
          </Button>
          <Button type="button" onClick={handleExportCsv}>
            <Download className="h-4 w-4" />
            <span>Exporter CSV</span>
          </Button>
        </div>
      </div>

      {/* Filters & Tabs Bar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {(
              [
                { id: 'stock', label: 'Valorisation & Rotation', icon: Boxes },
                { id: 'margins', label: 'Marges & Ventes', icon: TrendingUp },
                { id: 'purchasing', label: 'Achats & Fournisseurs', icon: Truck },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeTab === tab.id
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Période d’analyse"
              value={period}
              onChange={(e) => setPeriod(e.target.value as PeriodDays)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
            >
              <option value="7">7 derniers jours</option>
              <option value="30">30 derniers jours</option>
              <option value="90">90 derniers jours</option>
              <option value="365">12 derniers mois</option>
              <option value="ALL">Historique complet</option>
            </select>

            <select
              aria-label="Entrepôt"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
            >
              <option value="ALL">Tous les entrepôts</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </select>

            {activeTab !== 'purchasing' && (
              <select
                aria-label="Catégorie"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
              >
                <option value="ALL">Toutes catégories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}

            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filtrer..."
                className="h-9 w-44 rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, idx) => (
              <Skeleton key={idx} className="h-24 w-full rounded-xl" />
            ))}
          </div>
          <TableSkeleton rows={6} cols={6} />
        </div>
      ) : activeTab === 'stock' ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs text-slate-500 dark:text-slate-400">Valorisation stock</p>
              <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-slate-900 dark:text-white">
                {formatCurrency(stockReport.totalValue, currency)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs text-slate-500 dark:text-slate-400">Unités physiques</p>
              <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-slate-900 dark:text-white">
                {formatNumber(stockReport.totalPhysical)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs text-slate-500 dark:text-slate-400">Sorties sur période</p>
              <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-blue-600 dark:text-blue-400">
                {formatNumber(stockReport.totalOutbound)} u.
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs text-slate-500 dark:text-slate-400">Ruptures / Sous seuil</p>
              <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-red-600 dark:text-red-400">
                {stockReport.alertCount}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs text-slate-500 dark:text-slate-400">Références en surstock</p>
              <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-slate-900 dark:text-white">
                {stockReport.overstockCount}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Flux logistiques (Entrées vs Sorties)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Volume des unités réceptionnées et expédiées sur la période
              </p>
              <div className="mt-4 h-60 w-full">
                {stockFlowChartData.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-xs text-slate-400">
                    Aucun mouvement sur la période sélectionnée.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stockFlowChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Bar dataKey="entrees" name="Entrées" fill="#16a34a" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="sorties" name="Sorties" fill="#2563eb" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Valeur immobilisée par entrepôt ({currency})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Répartition financière des stocks physiques disponibles et réservés
              </p>
              <div className="mt-4 h-60 w-full">
                {warehouseValuationChartData.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-xs text-slate-400">
                    Aucun entrepôt configuré.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={warehouseValuationChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(val) => [formatCurrency(Number(val ?? 0), currency), 'Valeur']} />
                      <Bar dataKey="valeur" fill="#0f172a" radius={[4, 4, 0, 0]} maxBarSize={56} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
            <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Détail valorisation &amp; rotation par référence
              </h2>
            </div>
            {stockReport.rows.length === 0 ? (
              <EmptyState
                icon={Boxes}
                title="Aucune ligne correspondante"
                description="Ajustez vos filtres ou créez des produits dans le catalogue."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50/70 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">SKU / Produit</th>
                      <th className="px-4 py-2.5 font-medium">Catégorie</th>
                      <th className="px-4 py-2.5 font-medium text-right">Physique</th>
                      <th className="px-4 py-2.5 font-medium text-right">Disponible</th>
                      <th className="px-4 py-2.5 font-medium text-right">Sorties</th>
                      <th className="px-4 py-2.5 font-medium text-right">Rotation</th>
                      <th className="px-4 py-2.5 font-medium text-right">Valorisation</th>
                      <th className="px-4 py-2.5 font-medium">État</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {stockReport.rows.map((row) => (
                      <tr key={row.product.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-2.5">
                          <p className="font-mono text-xs font-semibold text-slate-900 dark:text-white">
                            {row.product.sku}
                          </p>
                          <p className="text-xs text-slate-500 truncate max-w-[240px]">
                            {row.product.name}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-slate-300">
                          {row.product.categoryName || 'Non classé'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                          {formatNumber(row.physical)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                          {formatNumber(row.available)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                          {formatNumber(row.outboundQty)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                          {row.rotationRate.toFixed(2)}×
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums text-slate-900 dark:text-white">
                          {formatCurrency(row.value, currency)}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusText tone={row.tone} label={row.statusLabel} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : activeTab === 'margins' ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs text-slate-500 dark:text-slate-400">CA Facturé HT</p>
              <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-slate-900 dark:text-white">
                {formatCurrency(marginsReport.netRevenueHt, currency)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs text-slate-500 dark:text-slate-400">CA Facturé TTC</p>
              <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-slate-900 dark:text-white">
                {formatCurrency(marginsReport.netRevenueTtc, currency)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs text-slate-500 dark:text-slate-400">Marge brute estimée</p>
              <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {formatCurrency(marginsReport.grossMargin, currency)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs text-slate-500 dark:text-slate-400">Taux de marge</p>
              <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-blue-600 dark:text-blue-400">
                {marginsReport.marginRatePct.toFixed(1)} %
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs text-slate-500 dark:text-slate-400">Créances clients</p>
              <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                {formatCurrency(marginsReport.unpaidTtc, currency)}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Évolution mensuelle CA HT &amp; Marge brute ({currency})
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Basée sur les factures et avoirs clients émis sur la période
            </p>
            <div className="mt-4 h-64 w-full">
              {marginsReport.monthlyData.length === 0 ? (
                <div className="flex h-full items-center justify-center text-xs text-slate-400">
                  Aucune facture client sur la période sélectionnée.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={marginsReport.monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(val) => formatCurrency(Number(val ?? 0), currency)} />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Bar dataKey="caHt" name="Chiffre d’affaires HT" fill="#2563eb" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="marge" name="Marge brute" fill="#16a34a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
            <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Rentabilité par produit facturé
              </h2>
            </div>
            {marginsReport.productRows.length === 0 ? (
              <EmptyState
                icon={BarChart3}
                title="Aucune vente facturée"
                description="Émettez des factures clients depuis le module Facturation pour analyser les marges."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50/70 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">SKU / Produit</th>
                      <th className="px-4 py-2.5 font-medium text-right">Qté vendue</th>
                      <th className="px-4 py-2.5 font-medium text-right">CA HT</th>
                      <th className="px-4 py-2.5 font-medium text-right">Coût estimé</th>
                      <th className="px-4 py-2.5 font-medium text-right">Marge brute</th>
                      <th className="px-4 py-2.5 font-medium text-right">Taux</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {marginsReport.productRows.map((row) => (
                      <tr key={row.productId} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-2.5">
                          <p className="font-mono text-xs font-semibold text-slate-900 dark:text-white">
                            {row.sku}
                          </p>
                          <p className="text-xs text-slate-500 truncate max-w-[260px]">{row.name}</p>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                          {formatNumber(row.qtySold)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                          {formatCurrency(row.revenueHt, currency)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-slate-500">
                          {formatCurrency(row.cogs, currency)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(row.margin, currency)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                          {row.marginPct.toFixed(1)} %
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs text-slate-500 dark:text-slate-400">Engagements achats TTC</p>
              <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-slate-900 dark:text-white">
                {formatCurrency(purchasingReport.totalCommittedTtc, currency)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs text-slate-500 dark:text-slate-400">Commandes en cours</p>
              <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-blue-600 dark:text-blue-400">
                {purchasingReport.openOrdersCount}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs text-slate-500 dark:text-slate-400">Dettes fournisseurs TTC</p>
              <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                {formatCurrency(purchasingReport.payablesTtc, currency)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs text-slate-500 dark:text-slate-400">Ponctualité moyenne</p>
              <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {purchasingReport.avgOnTime.toFixed(0)} %
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs text-slate-500 dark:text-slate-400">Délai moyen livraison</p>
              <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-slate-900 dark:text-white">
                {purchasingReport.avgLeadDays.toFixed(1)} j
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Volume d’achats engagé par fournisseur ({currency})
            </h2>
            <div className="mt-4 h-60 w-full">
              {purchasingReport.chartData.length === 0 ? (
                <div className="flex h-full items-center justify-center text-xs text-slate-400">
                  Aucune commande fournisseur engagée sur la période.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={purchasingReport.chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(val) => [formatCurrency(Number(val ?? 0), currency), 'Engagé TTC']} />
                    <Bar dataKey="montant" radius={[4, 4, 0, 0]} maxBarSize={56}>
                      {purchasingReport.chartData.map((_, idx) => (
                        <Cell key={idx} fill={idx === 0 ? '#2563eb' : '#0f172a'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
            <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Performance comparative des fournisseurs
              </h2>
            </div>
            {purchasingReport.rows.length === 0 ? (
              <EmptyState
                icon={AlertTriangle}
                title="Aucun fournisseur trouvé"
                description="Enregistrez des fournisseurs et commandes d’achat dans le module Achats."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50/70 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Fournisseur</th>
                      <th className="px-4 py-2.5 font-medium text-right">Commandes</th>
                      <th className="px-4 py-2.5 font-medium text-right">Engagé TTC</th>
                      <th className="px-4 py-2.5 font-medium text-right">Délai</th>
                      <th className="px-4 py-2.5 font-medium text-right">Ponctualité</th>
                      <th className="px-4 py-2.5 font-medium text-right">Note</th>
                      <th className="px-4 py-2.5 font-medium">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {purchasingReport.rows.map((row) => (
                      <tr key={row.supplier.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-2.5">
                          <p className="font-mono text-xs font-semibold text-slate-900 dark:text-white">
                            {row.supplier.code}
                          </p>
                          <p className="text-xs text-slate-500">{row.supplier.name}</p>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                          {row.ordersCount}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums text-slate-900 dark:text-white">
                          {formatCurrency(row.totalTtc, currency)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                          {row.supplier.leadTimeDays} j
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                          {row.supplier.onTimeRate} %
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                          {row.supplier.rating.toFixed(1)} / 5
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusText
                            tone={row.supplier.status === 'active' ? 'success' : 'neutral'}
                            label={row.supplier.status === 'active' ? 'Actif' : 'Inactif'}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
