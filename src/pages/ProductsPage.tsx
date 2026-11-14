import { useMemo, useState, type ChangeEvent } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Download,
  Edit3,
  Eye,
  FolderPlus,
  Package,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useToast } from '../contexts/ToastContext.tsx';
import { useErpData } from '../hooks/useErpData.ts';
import {
  createCategory,
  createProduct,
  deleteProduct,
  importProductsBatch,
  updateProduct,
} from '../services/erpService.ts';
import {
  categorySchema,
  productSchema,
  type CategoryInput,
  type ProductInput,
} from '../shared/schemas.ts';
import { formatCurrency, formatDateTime, formatNumber } from '../shared/formatters.ts';
import { PLAN_QUOTAS, type Product } from '../shared/types.ts';
import { Button } from '../components/ui/Button.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { ConfirmDialog } from '../components/ui/ConfirmDialog.tsx';
import { TableSkeleton } from '../components/ui/Skeleton.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { StatusText } from '../components/ui/StatusText.tsx';

export function ProductsPage() {
  const { user, activeOrg } = useAuth();
  const { toast } = useToast();
  const { products, categories, balances, movements, isLoading, invalidateAll } = useErpData();

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'active' | 'draft' | 'archived'>('ALL');
  const [onlyAlerts, setOnlyAlerts] = useState(false);

  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<ProductInput[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const currency = activeOrg?.currency ?? 'EUR';
  const memberUids = activeOrg?.memberUids ?? (user ? [user.uid] : []);
  const planQuota = PLAN_QUOTAS[activeOrg?.plan ?? 'starter'];

  const stockByProduct = useMemo(() => {
    const map = new Map<string, { physical: number; available: number }>();
    for (const b of balances) {
      const prev = map.get(b.productId) ?? { physical: 0, available: 0 };
      map.set(b.productId, {
        physical: prev.physical + b.physicalQty,
        available: prev.available + b.availableQty,
      });
    }
    return map;
  }, [balances]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
      if (categoryFilter !== 'ALL' && p.categoryId !== categoryFilter) return false;
      if (onlyAlerts) {
        const avail = stockByProduct.get(p.id)?.available ?? 0;
        if (avail > p.minStock) return false;
      }
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode ?? '').toLowerCase().includes(q) ||
        (p.brand ?? '').toLowerCase().includes(q)
      );
    });
  }, [products, search, categoryFilter, statusFilter, onlyAlerts, stockByProduct]);

  const productForm = useForm<ProductInput>({
    resolver: zodResolver(productSchema) as never,
    defaultValues: {
      sku: '',
      barcode: '',
      name: '',
      description: '',
      categoryId: '',
      brand: '',
      unit: 'unité',
      purchasePrice: 0,
      salePrice: 0,
      vatRate: 20,
      minStock: 5,
      maxStock: 100,
      status: 'active',
      trackBatches: false,
      trackSerials: false,
      trackExpiry: false,
    },
  });

  const categoryForm = useForm<CategoryInput>({
    resolver: zodResolver(categorySchema) as never,
    defaultValues: { code: '', name: '', description: '' },
  });

  const openCreateProduct = () => {
    setEditingProduct(null);
    productForm.reset({
      sku: `SF-${String(products.length + 1).padStart(4, '0')}`,
      barcode: '',
      name: '',
      description: '',
      categoryId: categories[0]?.id ?? '',
      brand: '',
      unit: 'unité',
      purchasePrice: 0,
      salePrice: 0,
      vatRate: 20,
      minStock: 5,
      maxStock: 100,
      status: 'active',
      trackBatches: false,
      trackSerials: false,
      trackExpiry: false,
    });
    setProductModalOpen(true);
  };

  const openEditProduct = (prod: Product) => {
    setEditingProduct(prod);
    productForm.reset({
      sku: prod.sku,
      barcode: prod.barcode ?? '',
      name: prod.name,
      description: prod.description ?? '',
      categoryId: prod.categoryId ?? '',
      brand: prod.brand ?? '',
      unit: prod.unit,
      purchasePrice: prod.purchasePrice,
      salePrice: prod.salePrice,
      vatRate: prod.vatRate,
      minStock: prod.minStock,
      maxStock: prod.maxStock,
      status: prod.status,
      trackBatches: Boolean(prod.trackBatches),
      trackSerials: Boolean(prod.trackSerials),
      trackExpiry: Boolean(prod.trackExpiry),
    });
    setProductModalOpen(true);
  };

  const onSubmitProduct = async (data: ProductInput) => {
    if (!activeOrg || !user) return;
    if (!editingProduct && products.length >= planQuota.maxProducts) {
      toast({
        variant: 'warning',
        title: 'Quota atteint',
        description: `Le plan ${planQuota.name} limite le catalogue à ${planQuota.maxProducts} produits.`,
      });
      return;
    }

    const duplicateSku = products.find(
      (p) => p.sku.toLowerCase() === data.sku.toLowerCase() && p.id !== editingProduct?.id
    );
    if (duplicateSku) {
      toast({
        variant: 'error',
        title: 'SKU déjà utilisé',
        description: `Un autre produit utilise déjà la référence ${data.sku}.`,
      });
      return;
    }

    const catName = categories.find((c) => c.id === data.categoryId)?.name ?? 'Non classé';
    const actor = { uid: user.uid, email: user.email ?? 'admin@stockflow.local' };

    setSubmitting(true);
    try {
      if (editingProduct) {
        await updateProduct(activeOrg.id, editingProduct.id, memberUids, data, catName, actor);
        toast({ variant: 'success', title: 'Produit mis à jour', description: data.name });
      } else {
        await createProduct(activeOrg.id, memberUids, data, catName, actor);
        toast({ variant: 'success', title: 'Produit créé', description: `${data.sku} — ${data.name}` });
      }
      await invalidateAll();
      setProductModalOpen(false);
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Erreur lors de l’enregistrement',
        description: err instanceof Error ? err.message : 'Opération refusée.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmitCategory = async (data: CategoryInput) => {
    if (!activeOrg) return;
    setSubmitting(true);
    try {
      await createCategory(activeOrg.id, memberUids, data);
      await invalidateAll();
      categoryForm.reset();
      setCategoryModalOpen(false);
      toast({ variant: 'success', title: 'Catégorie ajoutée', description: data.name });
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Erreur',
        description: err instanceof Error ? err.message : 'Impossible de créer la catégorie.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!activeOrg || !user || !deleteTarget) return;
    setSubmitting(true);
    try {
      await deleteProduct(activeOrg.id, deleteTarget, memberUids, {
        uid: user.uid,
        email: user.email ?? 'admin@stockflow.local',
      });
      await invalidateAll();
      toast({ variant: 'success', title: 'Produit supprimé', description: deleteTarget.sku });
      setDeleteTarget(null);
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Suppression impossible',
        description: err instanceof Error ? err.message : 'Erreur.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleExportCsv = () => {
    const header = [
      'SKU',
      'Code-barres',
      'Nom',
      'Catégorie',
      'Marque',
      'Unité',
      'Prix Achat HT',
      'Prix Vente HT',
      'TVA %',
      'Stock Min',
      'Stock Max',
      'Stock Physique',
      'Stock Disponible',
      'Statut',
    ];
    const rows = filteredProducts.map((p) => {
      const s = stockByProduct.get(p.id) ?? { physical: 0, available: 0 };
      return [
        p.sku,
        p.barcode ?? '',
        `"${p.name.replace(/"/g, '""')}"`,
        `"${(p.categoryName ?? '').replace(/"/g, '""')}"`,
        `"${(p.brand ?? '').replace(/"/g, '""')}"`,
        p.unit,
        p.purchasePrice,
        p.salePrice,
        p.vatRate,
        p.minStock,
        p.maxStock,
        s.physical,
        s.available,
        p.status,
      ].join(';');
    });
    const csv = '\uFEFF' + [header.join(';'), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `produits_${activeOrg?.slug ?? 'stockflow'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ variant: 'info', title: 'Export CSV généré', description: `${filteredProducts.length} ligne(s)` });
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      toast({ variant: 'warning', title: 'Fichier vide', description: 'Le CSV doit contenir un en-tête et au moins une ligne.' });
      return;
    }
    const sep = lines[0].includes(';') ? ';' : ',';
    const parsedRows: ProductInput[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
      if (!cols[0] || !cols[1]) continue;
      const result = productSchema.safeParse({
        sku: cols[0],
        name: cols[1],
        unit: cols[2] || 'unité',
        purchasePrice: Number(cols[3] || 0),
        salePrice: Number(cols[4] || 0),
        vatRate: Number(cols[5] || 20),
        minStock: Number(cols[6] || 5),
        maxStock: Number(cols[7] || 100),
        status: 'active',
      });
      if (result.success) parsedRows.push(result.data);
    }
    setImportPreview(parsedRows);
  };

  const handleConfirmImport = async () => {
    if (!activeOrg || !user || importPreview.length === 0) return;
    if (products.length + importPreview.length > planQuota.maxProducts) {
      toast({
        variant: 'warning',
        title: 'Quota catalogue dépassé',
        description: `Votre plan ${planQuota.name} autorise ${planQuota.maxProducts} produits maximum (${products.length} existants + ${importPreview.length} à importer). Passez au plan supérieur dans Paramètres > Abonnement.`,
      });
      return;
    }
    setSubmitting(true);
    try {
      const count = await importProductsBatch(activeOrg.id, memberUids, importPreview, {
        uid: user.uid,
        email: user.email ?? 'admin@stockflow.local',
      });
      await invalidateAll();
      toast({ variant: 'success', title: 'Import réussi', description: `${count} produit(s) importé(s).` });
      setImportPreview([]);
      setImportModalOpen(false);
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Import échoué',
        description: err instanceof Error ? err.message : 'Erreur.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const detailBalances = useMemo(() => {
    if (!detailProduct) return [];
    return balances.filter((b) => b.productId === detailProduct.id);
  }, [detailProduct, balances]);

  const detailMovements = useMemo(() => {
    if (!detailProduct) return [];
    return movements.filter((m) => m.productId === detailProduct.id).slice(0, 10);
  }, [detailProduct, movements]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Accueil / Catalogue / Produits</p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Produits &amp; Catalogue
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setCategoryModalOpen(true)}>
            <FolderPlus className="h-4 w-4" />
            <span>Catégorie</span>
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setImportModalOpen(true)}>
            <Upload className="h-4 w-4" />
            <span>Import CSV</span>
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={handleExportCsv}>
            <Download className="h-4 w-4" />
            <span>Export CSV</span>
          </Button>
          <Button type="button" onClick={openCreateProduct}>
            <Plus className="h-4 w-4" />
            <span>Nouveau produit</span>
          </Button>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrer par SKU, nom, code-barres ou marque..."
            className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Catégorie"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            <option value="ALL">Toutes catégories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {(['ALL', 'active', 'draft', 'archived'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  statusFilter === st
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {st === 'ALL' ? 'Tous' : st === 'active' ? 'Actifs' : st === 'draft' ? 'Brouillons' : 'Archivés'}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setOnlyAlerts((v) => !v)}
            className={`h-9 px-3 rounded-lg border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
              onlyAlerts
                ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'
            }`}
          >
            Sous seuil / Rupture
          </button>
        </div>
      </div>

      {/* Product Table */}
      {isLoading ? (
        <TableSkeleton rows={6} cols={7} />
      ) : filteredProducts.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Aucun produit trouvé"
          description="Ajustez vos filtres ou ajoutez un premier article à votre catalogue multi-entrepôts."
          action={
            <Button type="button" onClick={openCreateProduct}>
              <Plus className="h-4 w-4" />
              <span>Ajouter un produit</span>
            </Button>
          }
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/70 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">SKU / Produit</th>
                  <th className="px-4 py-3 font-medium">Catégorie</th>
                  <th className="px-4 py-3 font-medium text-right">Achat HT</th>
                  <th className="px-4 py-3 font-medium text-right">Vente HT</th>
                  <th className="px-4 py-3 font-medium text-right">Dispo</th>
                  <th className="px-4 py-3 font-medium">État stock</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredProducts.map((p) => {
                  const s = stockByProduct.get(p.id) ?? { physical: 0, available: 0 };
                  const stockTone =
                    s.available <= 0 ? 'error' : s.available <= p.minStock ? 'warning' : 'success';
                  const stockLabel =
                    s.available <= 0 ? 'Rupture' : s.available <= p.minStock ? 'Sous seuil' : 'Nominal';

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-blue-700 dark:text-blue-400">
                            {p.sku}
                          </span>
                          {p.isDemo && (
                            <span className="text-[11px] text-slate-400">· Démo</span>
                          )}
                        </div>
                        <p className="mt-0.5 font-medium text-slate-900 dark:text-slate-100">{p.name}</p>
                        {p.brand && (
                          <p className="text-xs text-slate-500">
                            {p.brand} {p.barcode ? `· EAN ${p.barcode}` : ''}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                        {p.categoryName || 'Non classé'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300">
                        {formatCurrency(p.purchasePrice, currency)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-medium tabular-nums text-slate-900 dark:text-slate-100">
                        {formatCurrency(p.salePrice, currency)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                        <span className="font-semibold text-slate-900 dark:text-white">
                          {formatNumber(s.available)}
                        </span>
                        <span className="text-slate-400"> {p.unit}</span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusText tone={stockTone} label={stockLabel} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setDetailProduct(p)}
                            aria-label={`Voir ${p.name}`}
                            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white cursor-pointer"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditProduct(p)}
                            aria-label={`Modifier ${p.name}`}
                            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-800 dark:hover:text-blue-400 cursor-pointer"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(p)}
                            aria-label={`Supprimer ${p.name}`}
                            className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400 cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create / Edit Product Modal */}
      <Modal
        open={productModalOpen}
        onClose={() => setProductModalOpen(false)}
        title={editingProduct ? `Modifier ${editingProduct.sku}` : 'Nouveau produit'}
        subtitle="Les quantités en stock sont gérées exclusivement par les mouvements de stock."
        size="lg"
      >
        <form onSubmit={productForm.handleSubmit(onSubmitProduct)} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">SKU *</label>
              <input
                type="text"
                {...productForm.register('sku')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono dark:border-slate-700 dark:bg-slate-950"
              />
              {productForm.formState.errors.sku && (
                <p className="mt-1 text-xs text-red-600">{productForm.formState.errors.sku.message}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Code-barres (EAN)</label>
              <input
                type="text"
                {...productForm.register('barcode')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Désignation *</label>
            <input
              type="text"
              {...productForm.register('name')}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
            {productForm.formState.errors.name && (
              <p className="mt-1 text-xs text-red-600">{productForm.formState.errors.name.message}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Catégorie</label>
              <select
                {...productForm.register('categoryId')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="">Non classé</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Marque</label>
              <input
                type="text"
                {...productForm.register('brand')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Unité</label>
              <input
                type="text"
                {...productForm.register('unit')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Prix achat HT</label>
              <input
                type="number"
                step="0.01"
                {...productForm.register('purchasePrice')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Prix vente HT</label>
              <input
                type="number"
                step="0.01"
                {...productForm.register('salePrice')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">TVA (%)</label>
              <input
                type="number"
                step="0.1"
                {...productForm.register('vatRate')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Statut</label>
              <select
                {...productForm.register('status')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="active">Actif</option>
                <option value="draft">Brouillon</option>
                <option value="archived">Archivé</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Seuil alerte (Min)</label>
              <input
                type="number"
                {...productForm.register('minStock')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Capacité cible (Max)</label>
              <input
                type="number"
                {...productForm.register('maxStock')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Description</label>
            <textarea
              rows={2}
              {...productForm.register('description')}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div className="flex flex-wrap gap-5 pt-1 text-xs text-slate-700 dark:text-slate-300">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" {...productForm.register('trackBatches')} />
              <span>Suivi par lots</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" {...productForm.register('trackSerials')} />
              <span>Numéros de série</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" {...productForm.register('trackExpiry')} />
              <span>Date de péremption (DLUO/DLC)</span>
            </label>
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
            <Button type="button" variant="outline" onClick={() => setProductModalOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Enregistrement...' : editingProduct ? 'Enregistrer' : 'Créer le produit'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Product Detail Modal */}
      <Modal
        open={Boolean(detailProduct)}
        onClose={() => setDetailProduct(null)}
        title={detailProduct ? `${detailProduct.sku} — ${detailProduct.name}` : ''}
        subtitle={detailProduct?.categoryName}
        size="lg"
      >
        {detailProduct && (
          <div className="space-y-5 text-sm">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
              <div>
                <p className="text-xs text-slate-500">Achat HT</p>
                <p className="mt-0.5 font-mono font-semibold tabular-nums">
                  {formatCurrency(detailProduct.purchasePrice, currency)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Vente HT</p>
                <p className="mt-0.5 font-mono font-semibold tabular-nums">
                  {formatCurrency(detailProduct.salePrice, currency)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">TVA</p>
                <p className="mt-0.5 font-mono font-semibold tabular-nums">{detailProduct.vatRate}%</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Seuils (Min / Max)</p>
                <p className="mt-0.5 font-mono font-semibold tabular-nums">
                  {detailProduct.minStock} / {detailProduct.maxStock}
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-slate-500 mb-2">Stock par emplacement</h3>
              {detailBalances.length === 0 ? (
                <p className="text-xs text-slate-500">Aucun solde enregistré pour cet article.</p>
              ) : (
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left">Entrepôt</th>
                        <th className="px-3 py-2 text-left">Emplacement</th>
                        <th className="px-3 py-2 text-right">Physique</th>
                        <th className="px-3 py-2 text-right">Réservé</th>
                        <th className="px-3 py-2 text-right">Disponible</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {detailBalances.map((b) => (
                        <tr key={b.id}>
                          <td className="px-3 py-2">{b.warehouseName}</td>
                          <td className="px-3 py-2 font-mono">{b.locationCode}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{b.physicalQty}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{b.reservedQty}</td>
                          <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{b.availableQty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <h3 className="text-xs font-semibold text-slate-500 mb-2">Historique récent des mouvements</h3>
              {detailMovements.length === 0 ? (
                <p className="text-xs text-slate-500">Aucun mouvement enregistré.</p>
              ) : (
                <div className="space-y-1.5">
                  {detailMovements.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-xs dark:border-slate-800"
                    >
                      <div>
                        <span className="font-mono font-semibold">{m.reference}</span>
                        <span className="mx-1.5">·</span>
                        <span>{m.movementType}</span>
                        <span className="mx-1.5">·</span>
                        <span className="text-slate-500">{m.reason}</span>
                      </div>
                      <div className="font-mono text-right shrink-0">
                        <span className="font-semibold">{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</span>
                        <span className="ml-2 text-slate-400">{formatDateTime(m.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Category Modal */}
      <Modal
        open={categoryModalOpen}
        onClose={() => setCategoryModalOpen(false)}
        title="Nouvelle catégorie produit"
      >
        <form onSubmit={categoryForm.handleSubmit(onSubmitCategory)} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Code *</label>
              <input
                type="text"
                placeholder="ELEC"
                {...categoryForm.register('code')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono uppercase dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Nom *</label>
              <input
                type="text"
                placeholder="Composants électroniques"
                {...categoryForm.register('name')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Description</label>
            <input
              type="text"
              {...categoryForm.register('description')}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setCategoryModalOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={submitting}>
              Créer
            </Button>
          </div>
        </form>
      </Modal>

      {/* CSV Import Modal */}
      <Modal
        open={importModalOpen}
        onClose={() => {
          setImportModalOpen(false);
          setImportPreview([]);
        }}
        title="Import CSV de produits"
        subtitle="Colonnes attendues : SKU;Nom;Unité;PrixAchatHT;PrixVenteHT;TVA;StockMin;StockMax"
      >
        <div className="space-y-4">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileUpload}
            className="block w-full text-xs text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-xs file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
          />
          {importPreview.length > 0 && (
            <div className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-800">
              <p className="font-semibold">{importPreview.length} produit(s) valide(s) prêt(s) à importer :</p>
              <ul className="mt-2 max-h-40 overflow-y-auto space-y-1 font-mono text-slate-600 dark:text-slate-300">
                {importPreview.slice(0, 15).map((r, i) => (
                  <li key={i}>
                    {r.sku} — {r.name} ({r.salePrice} {currency})
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setImportModalOpen(false)}>
              Fermer
            </Button>
            <Button type="button" disabled={importPreview.length === 0 || submitting} onClick={handleConfirmImport}>
              {submitting ? 'Importation...' : `Importer (${importPreview.length})`}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        loading={submitting}
        title="Supprimer ce produit ?"
        description={
          deleteTarget
            ? `Vous allez supprimer définitivement « ${deleteTarget.sku} — ${deleteTarget.name} ». L’historique des mouvements passés restera conservé dans le journal d’audit.`
            : ''
        }
      />
    </div>
  );
}
