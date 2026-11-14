import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Building2,
  CreditCard,
  Download,
  Edit3,
  Eye,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useToast } from '../contexts/ToastContext.tsx';
import { useErpData } from '../hooks/useErpData.ts';
import {
  createCustomer,
  deleteCustomer,
  seedSalesDemoData,
  updateCustomer,
} from '../services/salesService.ts';
import { customerSchema, type CustomerInput } from '../shared/schemas.ts';
import { formatCurrency, formatDateShort } from '../shared/formatters.ts';
import type { Customer } from '../shared/types.ts';
import { Button } from '../components/ui/Button.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { ConfirmDialog } from '../components/ui/ConfirmDialog.tsx';
import { TableSkeleton } from '../components/ui/Skeleton.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { StatusText } from '../components/ui/StatusText.tsx';

export function ClientsPage() {
  const navigate = useNavigate();
  const { user, activeOrg } = useAuth();
  const { toast } = useToast();
  const {
    customers,
    quotes,
    salesOrders,
    salesInvoices,
    products,
    warehouses,
    isLoading,
    invalidateAll,
  } = useErpData();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'B2B' | 'B2C'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'active' | 'inactive'>('ALL');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const currency = activeOrg?.currency ?? 'EUR';
  const memberUids = activeOrg?.memberUids ?? (user ? [user.uid] : []);

  const form = useForm<CustomerInput>({
    resolver: zodResolver(customerSchema) as never,
    defaultValues: {
      code: '',
      type: 'B2B',
      name: '',
      contactName: '',
      email: '',
      phone: '',
      billingAddress: '',
      shippingAddress: '',
      city: '',
      country: 'France',
      siret: '',
      vatNumber: '',
      paymentTerms: '30 jours fin de mois',
      creditLimit: 10000,
      status: 'active',
      notes: '',
    },
  });

  const statsByCustomer = useMemo(() => {
    const map = new Map<
      string,
      { orderCount: number; totalInvoicedTtc: number; unpaidTtc: number }
    >();
    for (const so of salesOrders) {
      if (so.status === 'canceled') continue;
      const cur = map.get(so.customerId) ?? { orderCount: 0, totalInvoicedTtc: 0, unpaidTtc: 0 };
      cur.orderCount += 1;
      map.set(so.customerId, cur);
    }
    for (const inv of salesInvoices) {
      const cur = map.get(inv.customerId) ?? { orderCount: 0, totalInvoicedTtc: 0, unpaidTtc: 0 };
      const sign = inv.invoiceType === 'credit_note' ? -1 : 1;
      cur.totalInvoicedTtc += sign * inv.totalTtc;
      if (inv.invoiceType !== 'credit_note') {
        cur.unpaidTtc += Math.max(0, inv.totalTtc - inv.paidAmount);
      }
      map.set(inv.customerId, cur);
    }
    return map;
  }, [salesOrders, salesInvoices]);

  const kpis = useMemo(() => {
    const b2bCount = customers.filter((c) => c.type === 'B2B').length;
    const b2cCount = customers.filter((c) => c.type === 'B2C').length;
    const totalBilled = salesInvoices.reduce(
      (acc, inv) => acc + (inv.invoiceType === 'credit_note' ? -inv.totalTtc : inv.totalTtc),
      0
    );
    const totalReceivables = salesInvoices
      .filter((inv) => inv.invoiceType !== 'credit_note')
      .reduce((acc, inv) => acc + Math.max(0, inv.totalTtc - inv.paidAmount), 0);
    return {
      total: customers.length,
      b2bCount,
      b2cCount,
      totalBilled,
      totalReceivables,
    };
  }, [customers, salesInvoices]);

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter((c) => {
      if (typeFilter !== 'ALL' && c.type !== typeFilter) return false;
      if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        (c.contactName ?? '').toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q) ||
        (c.city ?? '').toLowerCase().includes(q) ||
        (c.siret ?? '').toLowerCase().includes(q)
      );
    });
  }, [customers, search, typeFilter, statusFilter]);

  const openCreateModal = () => {
    setEditingCustomer(null);
    form.reset({
      code: '',
      type: 'B2B',
      name: '',
      contactName: '',
      email: '',
      phone: '',
      billingAddress: '',
      shippingAddress: '',
      city: '',
      country: 'France',
      siret: '',
      vatNumber: '',
      paymentTerms: '30 jours fin de mois',
      creditLimit: 10000,
      status: 'active',
      notes: '',
    });
    setModalOpen(true);
  };

  const openEditModal = (cust: Customer) => {
    setEditingCustomer(cust);
    form.reset({
      code: cust.code,
      type: cust.type,
      name: cust.name,
      contactName: cust.contactName ?? '',
      email: cust.email ?? '',
      phone: cust.phone ?? '',
      billingAddress: cust.billingAddress ?? '',
      shippingAddress: cust.shippingAddress ?? '',
      city: cust.city ?? '',
      country: cust.country ?? 'France',
      siret: cust.siret ?? '',
      vatNumber: cust.vatNumber ?? '',
      paymentTerms: cust.paymentTerms,
      creditLimit: cust.creditLimit,
      status: cust.status,
      notes: cust.notes ?? '',
    });
    setModalOpen(true);
  };

  const onSubmit = form.handleSubmit(async (data) => {
    if (!activeOrg || !user) return;
    setSubmitting(true);
    try {
      if (editingCustomer) {
        await updateCustomer(activeOrg.id, editingCustomer.id, data);
        toast({
          title: 'Fiche client mise à jour',
          description: `${data.code.toUpperCase()} — ${data.name}`,
          variant: 'success',
        });
      } else {
        await createCustomer(activeOrg.id, memberUids, data, {
          uid: user.uid,
          email: user.email ?? '',
        });
        toast({
          title: 'Client créé',
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
    const hasActivity =
      salesOrders.some((so) => so.customerId === deleteTarget.id) ||
      salesInvoices.some((inv) => inv.customerId === deleteTarget.id);
    if (hasActivity) {
      toast({
        title: 'Suppression bloquée',
        description:
          'Ce client possède des commandes ou factures associées. Passez-le au statut « Inactif » pour préserver la traçabilité comptable.',
        variant: 'warning',
      });
      setDeleteTarget(null);
      return;
    }
    setSubmitting(true);
    try {
      await deleteCustomer(activeOrg.id, deleteTarget.id);
      toast({ title: 'Client supprimé', variant: 'success' });
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
    const wh = warehouses[0];
    if (!wh) {
      toast({
        title: 'Entrepôt requis',
        description: 'Créez un entrepôt avant de charger les données de démonstration.',
        variant: 'warning',
      });
      return;
    }
    setSubmitting(true);
    try {
      await seedSalesDemoData({
        orgId: activeOrg.id,
        memberUids,
        products,
        warehouse: wh,
        actor: {
          uid: user.uid,
          email: user.email ?? '',
          displayName: user.displayName || user.email || 'Utilisateur',
        },
      });
      toast({
        title: 'Données CRM & Ventes de démonstration ajoutées',
        description: '3 clients (B2B/B2C), 1 devis et 1 commande client ont été créés.',
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
      'Type',
      'Nom / Raison sociale',
      'Contact',
      'Email',
      'Téléphone',
      'Adresse facturation',
      'Ville',
      'SIRET',
      'TVA',
      'Conditions paiement',
      'Encours max',
      'Statut',
    ];
    const rows = filteredCustomers.map((c) => [
      c.code,
      c.type,
      `"${(c.name || '').replace(/"/g, '""')}"`,
      `"${(c.contactName || '').replace(/"/g, '""')}"`,
      c.email || '',
      c.phone || '',
      `"${(c.billingAddress || '').replace(/"/g, '""')}"`,
      c.city || '',
      c.siret || '',
      c.vatNumber || '',
      `"${(c.paymentTerms || '').replace(/"/g, '""')}"`,
      c.creditLimit,
      c.status,
    ]);
    const csv = [header.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stockflow-clients-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const detailQuotes = useMemo(
    () => (detailCustomer ? quotes.filter((q) => q.customerId === detailCustomer.id) : []),
    [detailCustomer, quotes]
  );
  const detailOrders = useMemo(
    () => (detailCustomer ? salesOrders.filter((so) => so.customerId === detailCustomer.id) : []),
    [detailCustomer, salesOrders]
  );
  const detailInvoices = useMemo(
    () =>
      detailCustomer ? salesInvoices.filter((inv) => inv.customerId === detailCustomer.id) : [],
    [detailCustomer, salesInvoices]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Accueil / Clients (CRM)</p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Clients B2B &amp; B2C
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {customers.length === 0 && (
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
            disabled={filteredCustomers.length === 0}
          >
            <Download className="h-4 w-4" />
            <span>Export CSV</span>
          </Button>
          <Button type="button" onClick={openCreateModal}>
            <Plus className="h-4 w-4" />
            <span>Nouveau client</span>
          </Button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Portefeuille clients</span>
            <Users className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <p className="mt-2 font-mono text-xl font-semibold text-slate-900 dark:text-white tabular-nums">
            {kpis.total}
          </p>
          <p className="mt-1 text-xs text-slate-500 font-mono">
            {kpis.b2bCount} B2B · {kpis.b2cCount} B2C
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Segment Entreprises</span>
            <Building2 className="h-4 w-4 text-slate-400" />
          </div>
          <p className="mt-2 font-mono text-xl font-semibold text-slate-900 dark:text-white tabular-nums">
            {kpis.b2bCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">Comptes professionnels facturés</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Facturé net TTC</span>
            <CreditCard className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="mt-2 font-mono text-xl font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
            {formatCurrency(kpis.totalBilled, currency)}
          </p>
          <p className="mt-1 text-xs text-slate-500">Cumul factures déduction avoirs</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Encours client dû</span>
            <CreditCard className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <p className="mt-2 font-mono text-xl font-semibold text-slate-900 dark:text-white tabular-nums">
            {formatCurrency(kpis.totalReceivables, currency)}
          </p>
          <p className="mt-1 text-xs text-slate-500">Créances en attente d’encaissement</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher code, nom, contact, SIRET, ville..."
            className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-950">
            {(['ALL', 'B2B', 'B2C'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTypeFilter(t)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  typeFilter === t
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                }`}
              >
                {t === 'ALL' ? 'Tous' : t}
              </button>
            ))}
          </div>
          <select
            aria-label="Filtrer par statut client"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'active' | 'inactive')}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            <option value="ALL">Tous statuts</option>
            <option value="active">Actifs</option>
            <option value="inactive">Inactifs</option>
          </select>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <TableSkeleton rows={5} />
      ) : filteredCustomers.length === 0 ? (
        <EmptyState
          icon={Users}
          title={customers.length === 0 ? 'Aucun client enregistré' : 'Aucun résultat'}
          description={
            customers.length === 0
              ? 'Créez votre premier compte client B2B ou B2C, ou chargez le jeu de démonstration Phase 4 pour tester devis, réservations, facturation et encaissements.'
              : 'Aucun client ne correspond à vos critères de recherche.'
          }
          action={
            customers.length === 0 ? (
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <Button type="button" variant="outline" onClick={() => void handleSeedDemo()}>
                  <Sparkles className="h-4 w-4 text-blue-600" />
                  <span>Charger données démo</span>
                </Button>
                <Button type="button" onClick={openCreateModal}>
                  <Plus className="h-4 w-4" />
                  <span>Créer un client</span>
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
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium">Règlement &amp; Encours</th>
                  <th className="px-4 py-3 font-medium text-right">Facturé / Dû TTC</th>
                  <th className="px-4 py-3 font-medium">Statut</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredCustomers.map((cust) => {
                  const stat = statsByCustomer.get(cust.id);
                  const unpaid = stat?.unpaidTtc ?? 0;
                  const overLimit = cust.creditLimit > 0 && unpaid > cust.creditLimit;
                  return (
                    <tr key={cust.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900 dark:text-slate-100">
                          {cust.name}
                          {cust.isDemo && (
                            <span className="ml-2 text-[11px] font-normal text-slate-400">
                              (Démo)
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-500 font-mono">
                          {cust.code} · {cust.type}
                          {cust.city ? ` · ${cust.city}` : ''}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-slate-800 dark:text-slate-200">
                          {cust.contactName || '—'}
                        </p>
                        <p className="text-xs text-slate-500 truncate max-w-[200px]">
                          {cust.email || cust.phone || '—'}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-slate-800 dark:text-slate-200">{cust.paymentTerms}</p>
                        <p className="text-xs text-slate-500 font-mono tabular-nums">
                          Plafond : {formatCurrency(cust.creditLimit, currency)}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        <p className="font-medium text-slate-900 dark:text-slate-100">
                          {formatCurrency(stat?.totalInvoicedTtc ?? 0, currency)}
                        </p>
                        <p
                          className={`text-xs ${
                            overLimit
                              ? 'font-semibold text-red-600 dark:text-red-400'
                              : 'text-slate-500'
                          }`}
                        >
                          Dû : {formatCurrency(unpaid, currency)}
                          {overLimit ? ' (Plafond dépassé)' : ''}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <StatusText
                          tone={cust.status === 'active' ? 'success' : 'neutral'}
                          label={cust.status === 'active' ? 'Actif' : 'Inactif'}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setDetailCustomer(cust)}
                            aria-label={`Voir la fiche de ${cust.name}`}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white cursor-pointer"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(cust)}
                            aria-label={`Modifier ${cust.name}`}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-800 dark:hover:text-blue-400 cursor-pointer"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(cust)}
                            aria-label={`Supprimer ${cust.name}`}
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
        title={editingCustomer ? 'Modifier le client' : 'Nouveau client'}
        subtitle="Compte B2B ou B2C, adresses de facturation/livraison et plafond d’encours."
        size="lg"
      >
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Code client *
              </label>
              <input
                {...form.register('code')}
                placeholder="CL-VALM"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm uppercase dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              {form.formState.errors.code && (
                <p className="mt-1 text-xs text-red-600">{form.formState.errors.code.message}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Type *
              </label>
              <select
                {...form.register('type')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="B2B">B2B (Entreprise)</option>
                <option value="B2C">B2C (Particulier)</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Nom / Raison sociale *
              </label>
              <input
                {...form.register('name')}
                placeholder="Ex. Atelier Valmont Industrie SAS"
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
                Interlocuteur
              </label>
              <input
                {...form.register('contactName')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Email
              </label>
              <input
                type="email"
                {...form.register('email')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Téléphone
              </label>
              <input
                {...form.register('phone')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Adresse de facturation
              </label>
              <input
                {...form.register('billingAddress')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Adresse de livraison
              </label>
              <input
                {...form.register('shippingAddress')}
                placeholder="Identique à la facturation si vide"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Ville
              </label>
              <input
                {...form.register('city')}
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
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                SIRET (B2B)
              </label>
              <input
                {...form.register('siret')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                TVA Intra (B2B)
              </label>
              <input
                {...form.register('vatNumber')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Conditions de règlement *
              </label>
              <input
                {...form.register('paymentTerms')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Encours autorisé ({currency})
              </label>
              <input
                type="number"
                step="100"
                {...form.register('creditLimit')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
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
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Notes commerciales
            </label>
            <input
              {...form.register('notes')}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting
                ? 'Enregistrement...'
                : editingCustomer
                  ? 'Mettre à jour'
                  : 'Créer le client'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Customer Detail Modal */}
      <Modal
        open={Boolean(detailCustomer)}
        onClose={() => setDetailCustomer(null)}
        title={detailCustomer ? `${detailCustomer.name} (${detailCustomer.code})` : ''}
        subtitle={
          detailCustomer
            ? `Compte ${detailCustomer.type} · ${detailCustomer.paymentTerms}`
            : ''
        }
        size="xl"
      >
        {detailCustomer && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs dark:border-slate-800 dark:bg-slate-950/60">
              <div className="space-y-1">
                <p className="font-semibold text-slate-500">Contact</p>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {detailCustomer.contactName || '—'}
                </p>
                <p className="text-slate-600 dark:text-slate-400">{detailCustomer.email || '—'}</p>
                <p className="text-slate-600 dark:text-slate-400">{detailCustomer.phone || '—'}</p>
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-slate-500">Adresses</p>
                <p className="text-slate-700 dark:text-slate-300">
                  Facturation : {detailCustomer.billingAddress || '—'}, {detailCustomer.city || ''}
                </p>
                <p className="text-slate-700 dark:text-slate-300">
                  Livraison : {detailCustomer.shippingAddress || detailCustomer.billingAddress || '—'}
                </p>
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-slate-500">Mentions légales &amp; Encours</p>
                <p className="font-mono text-slate-700 dark:text-slate-300">
                  SIRET : {detailCustomer.siret || '—'}
                </p>
                <p className="font-mono text-slate-700 dark:text-slate-300">
                  TVA : {detailCustomer.vatNumber || '—'}
                </p>
                <p className="font-mono font-medium text-slate-900 dark:text-slate-100">
                  Plafond : {formatCurrency(detailCustomer.creditLimit, currency)}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Historique commercial ({detailQuotes.length} devis · {detailOrders.length} commandes ·{' '}
                {detailInvoices.length} factures)
              </h3>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setDetailCustomer(null);
                  navigate(`/ventes?customerId=${detailCustomer.id}`);
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Nouvelle commande</span>
              </Button>
            </div>

            {detailInvoices.length === 0 && detailOrders.length === 0 ? (
              <p className="rounded-lg border border-slate-200 p-4 text-xs text-slate-500 dark:border-slate-800">
                Aucune transaction commerciale enregistrée pour ce client.
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60 text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Document</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium text-right">TTC</th>
                      <th className="px-3 py-2 font-medium">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {detailOrders.map((so) => (
                      <tr key={so.id}>
                        <td className="px-3 py-2 font-mono font-medium">{so.reference}</td>
                        <td className="px-3 py-2">Commande client</td>
                        <td className="px-3 py-2 font-mono">{formatDateShort(so.createdAt)}</td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatCurrency(so.totalTtc, currency)}
                        </td>
                        <td className="px-3 py-2">{so.status}</td>
                      </tr>
                    ))}
                    {detailInvoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="px-3 py-2 font-mono font-medium">{inv.invoiceNumber}</td>
                        <td className="px-3 py-2">
                          {inv.invoiceType === 'credit_note' ? 'Avoir' : 'Facture'}
                        </td>
                        <td className="px-3 py-2 font-mono">{formatDateShort(inv.issueDate)}</td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatCurrency(inv.totalTtc, currency)}
                        </td>
                        <td className="px-3 py-2">{inv.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="Supprimer le client"
        description={
          deleteTarget
            ? `Confirmez-vous la suppression de « ${deleteTarget.name} » (${deleteTarget.code}) ?`
            : ''
        }
        loading={submitting}
      />
    </div>
  );
}
