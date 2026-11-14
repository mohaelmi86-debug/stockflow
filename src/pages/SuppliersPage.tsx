import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  CheckCircle2,
  Clock,
  Download,
  Edit3,
  Eye,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
  Truck,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useToast } from '../contexts/ToastContext.tsx';
import { useErpData } from '../hooks/useErpData.ts';
import {
  createSupplier,
  deleteSupplier,
  seedPurchasingDemoData,
  updateSupplier,
} from '../services/purchasingService.ts';
import { supplierSchema, type SupplierInput } from '../shared/schemas.ts';
import { formatCurrency, formatDateShort, formatNumber } from '../shared/formatters.ts';
import type { Supplier } from '../shared/types.ts';
import { Button } from '../components/ui/Button.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { ConfirmDialog } from '../components/ui/ConfirmDialog.tsx';
import { TableSkeleton } from '../components/ui/Skeleton.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { StatusText } from '../components/ui/StatusText.tsx';

export function SuppliersPage() {
  const navigate = useNavigate();
  const { user, activeOrg } = useAuth();
  const { toast } = useToast();
  const {
    suppliers,
    purchaseOrders,
    supplierInvoices,
    products,
    warehouses,
    isLoading,
    invalidateAll,
  } = useErpData();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'active' | 'inactive'>('ALL');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [detailSupplier, setDetailSupplier] = useState<Supplier | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const currency = activeOrg?.currency ?? 'EUR';
  const memberUids = activeOrg?.memberUids ?? (user ? [user.uid] : []);

  const form = useForm<SupplierInput>({
    resolver: zodResolver(supplierSchema) as never,
    defaultValues: {
      code: '',
      name: '',
      contactName: '',
      email: '',
      phone: '',
      address: '',
      city: '',
      country: 'France',
      siret: '',
      vatNumber: '',
      paymentTerms: '30 jours fin de mois',
      leadTimeDays: 5,
      rating: 4.5,
      onTimeRate: 95,
      status: 'active',
      notes: '',
    },
  });

  const statsBySupplier = useMemo(() => {
    const map = new Map<string, { orderCount: number; totalOrderedTtc: number; unpaidTtc: number }>();
    for (const po of purchaseOrders) {
      if (po.status === 'canceled') continue;
      const cur = map.get(po.supplierId) ?? { orderCount: 0, totalOrderedTtc: 0, unpaidTtc: 0 };
      cur.orderCount += 1;
      cur.totalOrderedTtc += po.totalTtc;
      map.set(po.supplierId, cur);
    }
    for (const inv of supplierInvoices) {
      const cur = map.get(inv.supplierId) ?? { orderCount: 0, totalOrderedTtc: 0, unpaidTtc: 0 };
      cur.unpaidTtc += Math.max(0, inv.totalTtc - inv.paidAmount);
      map.set(inv.supplierId, cur);
    }
    return map;
  }, [purchaseOrders, supplierInvoices]);

  const kpis = useMemo(() => {
    const active = suppliers.filter((s) => s.status === 'active');
    const avgLead =
      active.length > 0
        ? active.reduce((acc, s) => acc + s.leadTimeDays, 0) / active.length
        : 0;
    const avgOnTime =
      active.length > 0
        ? active.reduce((acc, s) => acc + s.onTimeRate, 0) / active.length
        : 0;
    return {
      total: suppliers.length,
      activeCount: active.length,
      avgLead,
      avgOnTime,
    };
  }, [suppliers]);

  const filteredSuppliers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return suppliers.filter((s) => {
      if (statusFilter !== 'ALL' && s.status !== statusFilter) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        (s.contactName ?? '').toLowerCase().includes(q) ||
        (s.email ?? '').toLowerCase().includes(q) ||
        (s.city ?? '').toLowerCase().includes(q) ||
        (s.siret ?? '').toLowerCase().includes(q)
      );
    });
  }, [suppliers, search, statusFilter]);

  const openCreateModal = () => {
    setEditingSupplier(null);
    form.reset({
      code: '',
      name: '',
      contactName: '',
      email: '',
      phone: '',
      address: '',
      city: '',
      country: 'France',
      siret: '',
      vatNumber: '',
      paymentTerms: '30 jours fin de mois',
      leadTimeDays: 5,
      rating: 4.5,
      onTimeRate: 95,
      status: 'active',
      notes: '',
    });
    setModalOpen(true);
  };

  const openEditModal = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    form.reset({
      code: supplier.code,
      name: supplier.name,
      contactName: supplier.contactName ?? '',
      email: supplier.email ?? '',
      phone: supplier.phone ?? '',
      address: supplier.address ?? '',
      city: supplier.city ?? '',
      country: supplier.country ?? 'France',
      siret: supplier.siret ?? '',
      vatNumber: supplier.vatNumber ?? '',
      paymentTerms: supplier.paymentTerms,
      leadTimeDays: supplier.leadTimeDays,
      rating: supplier.rating,
      onTimeRate: supplier.onTimeRate,
      status: supplier.status,
      notes: supplier.notes ?? '',
    });
    setModalOpen(true);
  };

  const onSubmit = form.handleSubmit(async (data) => {
    if (!activeOrg || !user) return;
    setSubmitting(true);
    try {
      if (editingSupplier) {
        await updateSupplier(activeOrg.id, editingSupplier.id, data);
        toast({
          title: 'Fournisseur mis à jour',
          description: `${data.code.toUpperCase()} — ${data.name}`,
          variant: 'success',
        });
      } else {
        await createSupplier(activeOrg.id, memberUids, data, {
          uid: user.uid,
          email: user.email ?? '',
        });
        toast({
          title: 'Fournisseur créé',
          description: `${data.code.toUpperCase()} — ${data.name}`,
          variant: 'success',
        });
      }
      setModalOpen(false);
      await invalidateAll();
    } catch (err) {
      toast({
        title: 'Enregistrement impossible',
        description: err instanceof Error ? err.message : 'Erreur inconnue',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  });

  const handleConfirmDelete = async () => {
    if (!activeOrg || !deleteTarget) return;
    const hasOrders = purchaseOrders.some((po) => po.supplierId === deleteTarget.id);
    if (hasOrders) {
      toast({
        title: 'Suppression bloquée',
        description:
          'Ce fournisseur est lié à des commandes d’achat. Passez-le au statut « Inactif » pour préserver l’historique.',
        variant: 'warning',
      });
      setDeleteTarget(null);
      return;
    }
    setSubmitting(true);
    try {
      await deleteSupplier(activeOrg.id, deleteTarget.id);
      toast({ title: 'Fournisseur supprimé', variant: 'success' });
      setDeleteTarget(null);
      await invalidateAll();
    } catch (err) {
      toast({
        title: 'Erreur lors de la suppression',
        description: err instanceof Error ? err.message : 'Erreur inconnue',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSeedDemo = async () => {
    if (!activeOrg || !user) return;
    const defaultWh = warehouses[0];
    if (!defaultWh) {
      toast({
        title: 'Entrepôt requis',
        description: 'Créez d’abord un entrepôt avant d’initialiser les données de démonstration.',
        variant: 'warning',
      });
      return;
    }
    setSubmitting(true);
    try {
      await seedPurchasingDemoData({
        orgId: activeOrg.id,
        memberUids,
        products,
        warehouse: defaultWh,
        actor: {
          uid: user.uid,
          email: user.email ?? '',
          displayName: user.displayName || user.email || 'Utilisateur',
        },
      });
      toast({
        title: 'Fournisseurs de démonstration ajoutés',
        description: '3 fournisseurs et 1 commande prête à réceptionner ont été créés.',
        variant: 'success',
      });
      await invalidateAll();
    } catch (err) {
      toast({
        title: 'Initialisation impossible',
        description: err instanceof Error ? err.message : 'Erreur inconnue',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleExportCsv = () => {
    const header = [
      'Code',
      'Raison sociale',
      'Contact',
      'Email',
      'Téléphone',
      'Ville',
      'Pays',
      'SIRET',
      'TVA',
      'Conditions paiement',
      'Délai (j)',
      'Note /5',
      'Ponctualité %',
      'Statut',
    ];
    const rows = filteredSuppliers.map((s) => [
      s.code,
      `"${(s.name || '').replace(/"/g, '""')}"`,
      `"${(s.contactName || '').replace(/"/g, '""')}"`,
      s.email || '',
      s.phone || '',
      s.city || '',
      s.country || '',
      s.siret || '',
      s.vatNumber || '',
      `"${(s.paymentTerms || '').replace(/"/g, '""')}"`,
      s.leadTimeDays,
      s.rating,
      s.onTimeRate,
      s.status,
    ]);
    const csv = [header.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stockflow-fournisseurs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const detailOrders = useMemo(
    () => (detailSupplier ? purchaseOrders.filter((po) => po.supplierId === detailSupplier.id) : []),
    [detailSupplier, purchaseOrders]
  );

  const detailInvoices = useMemo(
    () =>
      detailSupplier ? supplierInvoices.filter((inv) => inv.supplierId === detailSupplier.id) : [],
    [detailSupplier, supplierInvoices]
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Accueil / Fournisseurs</p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Référentiel fournisseurs
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {suppliers.length === 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleSeedDemo()}
              disabled={submitting}
            >
              <Sparkles className="h-4 w-4 text-blue-600" />
              <span>Charger données démo</span>
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={handleExportCsv}
            disabled={filteredSuppliers.length === 0}
          >
            <Download className="h-4 w-4" />
            <span>Export CSV</span>
          </Button>
          <Button type="button" onClick={openCreateModal}>
            <Plus className="h-4 w-4" />
            <span>Nouveau fournisseur</span>
          </Button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Total fournisseurs</span>
            <Truck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <p className="mt-2 font-mono text-xl font-semibold text-slate-900 dark:text-white tabular-nums">
            {kpis.total}
          </p>
          <p className="mt-1 text-xs text-slate-500">{kpis.activeCount} actifs au catalogue</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Délai moyen</span>
            <Clock className="h-4 w-4 text-slate-400" />
          </div>
          <p className="mt-2 font-mono text-xl font-semibold text-slate-900 dark:text-white tabular-nums">
            {formatNumber(kpis.avgLead, 1)} j
          </p>
          <p className="mt-1 text-xs text-slate-500">Livraison standard</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Ponctualité moyenne</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="mt-2 font-mono text-xl font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
            {formatNumber(kpis.avgOnTime, 1)} %
          </p>
          <p className="mt-1 text-xs text-slate-500">Taux de respect des délais</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Encours fournisseurs</span>
            <Star className="h-4 w-4 text-amber-500" />
          </div>
          <p className="mt-2 font-mono text-xl font-semibold text-slate-900 dark:text-white tabular-nums">
            {formatCurrency(
              supplierInvoices.reduce(
                (acc, inv) => acc + Math.max(0, inv.totalTtc - inv.paidAmount),
                0
              ),
              currency
            )}
          </p>
          <p className="mt-1 text-xs text-slate-500">Factures restant à régler</p>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher code, raison sociale, contact, SIRET, ville..."
            className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Filtrer par statut fournisseur"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'active' | 'inactive')}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            <option value="ALL">Tous les statuts</option>
            <option value="active">Actifs uniquement</option>
            <option value="inactive">Inactifs</option>
          </select>
        </div>
      </div>

      {/* Suppliers Table */}
      {isLoading ? (
        <TableSkeleton rows={5} />
      ) : filteredSuppliers.length === 0 ? (
        <EmptyState
          icon={Truck}
          title={suppliers.length === 0 ? 'Aucun fournisseur enregistré' : 'Aucun résultat'}
          description={
            suppliers.length === 0
              ? 'Créez votre premier partenaire fournisseur ou chargez le jeu de démonstration Phase 3 pour tester le cycle d’achat.'
              : 'Aucun fournisseur ne correspond à vos critères de recherche.'
          }
          action={
            suppliers.length === 0 ? (
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <Button type="button" variant="outline" onClick={() => void handleSeedDemo()}>
                  <Sparkles className="h-4 w-4 text-blue-600" />
                  <span>Charger données démo</span>
                </Button>
                <Button type="button" onClick={openCreateModal}>
                  <Plus className="h-4 w-4" />
                  <span>Créer un fournisseur</span>
                </Button>
              </div>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/80 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Fournisseur</th>
                  <th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium">Conditions &amp; Délai</th>
                  <th className="px-4 py-3 font-medium">Performance</th>
                  <th className="px-4 py-3 font-medium text-right">Volume achats TTC</th>
                  <th className="px-4 py-3 font-medium">Statut</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredSuppliers.map((sup) => {
                  const stat = statsBySupplier.get(sup.id);
                  return (
                    <tr key={sup.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900 dark:text-slate-100">
                          {sup.name}
                          {sup.isDemo && (
                            <span className="ml-2 text-[11px] font-normal text-slate-400">
                              (Démo)
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-500 font-mono">
                          {sup.code}
                          {sup.city ? ` · ${sup.city}` : ''}
                          {sup.siret ? ` · SIRET ${sup.siret}` : ''}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-slate-800 dark:text-slate-200">
                          {sup.contactName || '—'}
                        </p>
                        <p className="text-xs text-slate-500 truncate max-w-[200px]">
                          {sup.email || sup.phone || 'Aucun contact direct'}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-slate-800 dark:text-slate-200">{sup.paymentTerms}</p>
                        <p className="text-xs text-slate-500 font-mono tabular-nums">
                          Délai : {sup.leadTimeDays} jour(s)
                        </p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs tabular-nums">
                        <span className="text-slate-800 dark:text-slate-200">
                          {sup.rating.toFixed(1)}/5
                        </span>
                        <span className="mx-1.5 text-slate-400" aria-hidden="true">
                          ·
                        </span>
                        <span
                          className={
                            sup.onTimeRate >= 90
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }
                        >
                          {sup.onTimeRate}% à l’heure
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        <p className="font-medium text-slate-900 dark:text-slate-100">
                          {formatCurrency(stat?.totalOrderedTtc ?? 0, currency)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {stat?.orderCount ?? 0} commande(s)
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <StatusText
                          tone={sup.status === 'active' ? 'success' : 'neutral'}
                          label={sup.status === 'active' ? 'Actif' : 'Inactif'}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setDetailSupplier(sup)}
                            title="Voir la fiche"
                            aria-label={`Voir la fiche de ${sup.name}`}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white cursor-pointer"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(sup)}
                            title="Modifier"
                            aria-label={`Modifier ${sup.name}`}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-800 dark:hover:text-blue-400 cursor-pointer"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(sup)}
                            title="Supprimer"
                            aria-label={`Supprimer ${sup.name}`}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-400 cursor-pointer"
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

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingSupplier ? 'Modifier le fournisseur' : 'Nouveau fournisseur'}
        subtitle="Coordonnées légales, conditions commerciales et indicateurs de performance."
        size="lg"
      >
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Code fournisseur *
              </label>
              <input
                {...form.register('code')}
                placeholder="FR-OPTI"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm uppercase dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              {form.formState.errors.code && (
                <p className="mt-1 text-xs text-red-600">{form.formState.errors.code.message}</p>
              )}
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Raison sociale *
              </label>
              <input
                {...form.register('name')}
                placeholder="Ex. OptiSense Automation SAS"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              {form.formState.errors.name && (
                <p className="mt-1 text-xs text-red-600">{form.formState.errors.name.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Contact principal
              </label>
              <input
                {...form.register('contactName')}
                placeholder="Claire Moreau"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Email commandes
              </label>
              <input
                type="email"
                {...form.register('email')}
                placeholder="commandes@fournisseur.fr"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Téléphone
              </label>
              <input
                {...form.register('phone')}
                placeholder="+33 1 42 68 55 10"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Adresse
              </label>
              <input
                {...form.register('address')}
                placeholder="22 Rue Ampère"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Ville
              </label>
              <input
                {...form.register('city')}
                placeholder="Lyon"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Pays
              </label>
              <input
                {...form.register('country')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                N° SIRET / Identifiant légal
              </label>
              <input
                {...form.register('siret')}
                placeholder="812 345 678 00024"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                N° TVA intracommunautaire
              </label>
              <input
                {...form.register('vatNumber')}
                placeholder="FR45812345678"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Conditions de paiement *
              </label>
              <input
                {...form.register('paymentTerms')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Délai (jours)
              </label>
              <input
                type="number"
                {...form.register('leadTimeDays')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Note (/5)
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="5"
                {...form.register('rating')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Ponctualité (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                {...form.register('onTimeRate')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Statut
              </label>
              <select
                {...form.register('status')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="active">Actif</option>
                <option value="inactive">Inactif</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Notes internes
              </label>
              <input
                {...form.register('notes')}
                placeholder="Remarques qualité, minimum de commande..."
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting
                ? 'Enregistrement...'
                : editingSupplier
                  ? 'Mettre à jour'
                  : 'Créer le fournisseur'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Supplier Detail Drawer/Modal */}
      <Modal
        open={Boolean(detailSupplier)}
        onClose={() => setDetailSupplier(null)}
        title={detailSupplier ? `${detailSupplier.name} (${detailSupplier.code})` : ''}
        subtitle="Fiche partenaire, historique des commandes et factures fournisseurs."
        size="xl"
      >
        {detailSupplier && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs dark:border-slate-800 dark:bg-slate-950/60">
              <div className="space-y-1">
                <p className="font-semibold text-slate-500">Contact &amp; Adresse</p>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {detailSupplier.contactName || '—'}
                </p>
                <p className="text-slate-600 dark:text-slate-400">{detailSupplier.email || '—'}</p>
                <p className="text-slate-600 dark:text-slate-400">{detailSupplier.phone || '—'}</p>
                <p className="text-slate-600 dark:text-slate-400">
                  {[detailSupplier.address, detailSupplier.city, detailSupplier.country]
                    .filter(Boolean)
                    .join(', ') || '—'}
                </p>
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-slate-500">Mentions légales &amp; Règlement</p>
                <p className="text-slate-700 dark:text-slate-300 font-mono">
                  SIRET : {detailSupplier.siret || '—'}
                </p>
                <p className="text-slate-700 dark:text-slate-300 font-mono">
                  TVA : {detailSupplier.vatNumber || '—'}
                </p>
                <p className="text-slate-700 dark:text-slate-300">
                  Paiement : {detailSupplier.paymentTerms}
                </p>
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-slate-500">Performance livraison</p>
                <p className="text-slate-700 dark:text-slate-300 font-mono">
                  Délai standard : {detailSupplier.leadTimeDays} jour(s)
                </p>
                <p className="text-slate-700 dark:text-slate-300 font-mono">
                  Note qualité : {detailSupplier.rating.toFixed(1)} / 5
                </p>
                <p className="text-emerald-600 dark:text-emerald-400 font-mono font-medium">
                  Ponctualité : {detailSupplier.onTimeRate} %
                </p>
              </div>
            </div>

            {detailSupplier.notes && (
              <p className="text-xs text-slate-600 dark:text-slate-400">
                <span className="font-semibold text-slate-800 dark:text-slate-200">Notes : </span>
                {detailSupplier.notes}
              </p>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Commandes d’achat ({detailOrders.length})
                </h3>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setDetailSupplier(null);
                    navigate(`/achats?supplierId=${detailSupplier.id}`);
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Nouvelle commande</span>
                </Button>
              </div>
              {detailOrders.length === 0 ? (
                <p className="rounded-lg border border-slate-200 p-4 text-xs text-slate-500 dark:border-slate-800">
                  Aucune commande passée auprès de ce fournisseur.
                </p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60 text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">Référence</th>
                        <th className="px-3 py-2 font-medium">Entrepôt</th>
                        <th className="px-3 py-2 font-medium">Statut</th>
                        <th className="px-3 py-2 font-medium text-right">Total TTC</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {detailOrders.map((po) => (
                        <tr key={po.id}>
                          <td className="px-3 py-2 font-mono font-medium text-slate-900 dark:text-slate-100">
                            {po.reference}
                          </td>
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                            {po.warehouseName}
                          </td>
                          <td className="px-3 py-2">{po.status}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {formatCurrency(po.totalTtc, currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
                Factures fournisseurs ({detailInvoices.length})
              </h3>
              {detailInvoices.length === 0 ? (
                <p className="rounded-lg border border-slate-200 p-4 text-xs text-slate-500 dark:border-slate-800">
                  Aucune facture enregistrée pour ce fournisseur.
                </p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60 text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">N° Facture</th>
                        <th className="px-3 py-2 font-medium">Échéance</th>
                        <th className="px-3 py-2 font-medium text-right">TTC</th>
                        <th className="px-3 py-2 font-medium text-right">Payé</th>
                        <th className="px-3 py-2 font-medium">Statut</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {detailInvoices.map((inv) => (
                        <tr key={inv.id}>
                          <td className="px-3 py-2 font-mono font-medium">{inv.invoiceNumber}</td>
                          <td className="px-3 py-2 font-mono">{formatDateShort(inv.dueDate)}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {formatCurrency(inv.totalTtc, currency)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {formatCurrency(inv.paidAmount, currency)}
                          </td>
                          <td className="px-3 py-2">{inv.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="Supprimer le fournisseur"
        description={
          deleteTarget
            ? `Confirmez-vous la suppression définitive de « ${deleteTarget.name} » (${deleteTarget.code}) ?`
            : ''
        }
        loading={submitting}
      />
    </div>
  );
}
