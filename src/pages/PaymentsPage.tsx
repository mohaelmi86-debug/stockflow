import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CreditCard,
  Download,
  Plus,
  Search,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useToast } from '../contexts/ToastContext.tsx';
import { useErpData } from '../hooks/useErpData.ts';
import { recordTreasuryPayment } from '../services/salesService.ts';
import { formatCurrency, formatDateShort, formatDateTime } from '../shared/formatters.ts';
import type { PaymentMethod, SalesInvoice, SupplierInvoice } from '../shared/types.ts';
import { Button } from '../components/ui/Button.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { TableSkeleton } from '../components/ui/Skeleton.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { StatusText } from '../components/ui/StatusText.tsx';
import { cn } from '../lib/cn.ts';

type TreasuryTab = 'ledger' | 'receivables' | 'payables';

const METHOD_LABELS: Record<PaymentMethod, string> = {
  transfer: 'Virement bancaire',
  card: 'Carte bancaire',
  check: 'Chèque',
  cash: 'Espèces',
  direct_debit: 'Prélèvement SEPA',
};

export function PaymentsPage() {
  const { user, activeOrg } = useAuth();
  const { toast } = useToast();
  const { payments, salesInvoices, supplierInvoices, isLoading, invalidateAll } = useErpData();

  const [activeTab, setActiveTab] = useState<TreasuryTab>('ledger');
  const [search, setSearch] = useState('');
  const [onlyOverdue, setOnlyOverdue] = useState(false);

  // Payment modal
  const [modalOpen, setModalOpen] = useState(false);
  const [direction, setDirection] = useState<'incoming' | 'outgoing'>('incoming');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [method, setMethod] = useState<PaymentMethod>('transfer');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const currency = activeOrg?.currency ?? 'EUR';
  const memberUids = activeOrg?.memberUids ?? (user ? [user.uid] : []);
  const actor = {
    uid: user?.uid ?? '',
    email: user?.email ?? '',
    displayName: user?.displayName || user?.email || 'Utilisateur',
  };

  const openSalesInvoices = useMemo(
    () =>
      salesInvoices.filter(
        (inv) => inv.invoiceType !== 'credit_note' && inv.status !== 'paid'
      ),
    [salesInvoices]
  );

  const openSupplierInvoices = useMemo(
    () => supplierInvoices.filter((inv) => inv.status !== 'paid'),
    [supplierInvoices]
  );

  const overdueReceivables = useMemo(
    () =>
      openSalesInvoices.filter((inv) => new Date(inv.dueDate).getTime() < Date.now()),
    [openSalesInvoices]
  );

  const kpis = useMemo(() => {
    const totalIncoming = payments
      .filter((p) => p.direction === 'incoming')
      .reduce((acc, p) => acc + p.amount, 0);
    const totalOutgoing = payments
      .filter((p) => p.direction === 'outgoing')
      .reduce((acc, p) => acc + p.amount, 0);
    const overdueTtc = overdueReceivables.reduce(
      (acc, inv) => acc + Math.max(0, inv.totalTtc - inv.paidAmount),
      0
    );
    return {
      totalIncoming,
      totalOutgoing,
      netCashflow: totalIncoming - totalOutgoing,
      overdueCount: overdueReceivables.length,
      overdueTtc,
    };
  }, [payments, overdueReceivables]);

  const openPaymentModal = (
    dir: 'incoming' | 'outgoing',
    preselected?: SalesInvoice | SupplierInvoice
  ) => {
    setDirection(dir);
    const list = dir === 'incoming' ? openSalesInvoices : openSupplierInvoices;
    const target = preselected ?? list[0];
    setSelectedInvoiceId(target?.id ?? '');
    setAmount(
      target ? Number(Math.max(0, target.totalTtc - target.paidAmount).toFixed(2)) : 0
    );
    setMethod('transfer');
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setNotes('');
    setModalOpen(true);
  };

  const handleSubmitPayment = async () => {
    if (!activeOrg || !user || !selectedInvoiceId || amount <= 0) {
      toast({ title: 'Sélectionnez une facture et un montant > 0', variant: 'warning' });
      return;
    }
    const sInv =
      direction === 'incoming'
        ? openSalesInvoices.find((i) => i.id === selectedInvoiceId)
        : undefined;
    const fInv =
      direction === 'outgoing'
        ? openSupplierInvoices.find((i) => i.id === selectedInvoiceId)
        : undefined;

    setSubmitting(true);
    try {
      const ref = await recordTreasuryPayment({
        orgId: activeOrg.id,
        memberUids,
        input: {
          direction,
          invoiceId: selectedInvoiceId,
          amount: Number(amount),
          method,
          paymentDate,
          notes,
        },
        salesInvoice: sInv,
        supplierInvoice: fInv,
        actor,
      });
      toast({
        title: `Paiement ${ref} enregistré`,
        description: `${formatCurrency(amount, currency)} lettré sur la facture.`,
        variant: 'success',
      });
      setModalOpen(false);
      await invalidateAll();
    } catch (err) {
      toast({
        title: 'Erreur lors de l’enregistrement',
        description: err instanceof Error ? err.message : 'Erreur inconnue',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const filteredPayments = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return payments;
    return payments.filter(
      (p) =>
        p.reference.toLowerCase().includes(q) ||
        p.invoiceNumber.toLowerCase().includes(q) ||
        p.partyName.toLowerCase().includes(q)
    );
  }, [payments, search]);

  const displayedReceivables = useMemo(() => {
    const q = search.trim().toLowerCase();
    return openSalesInvoices.filter((inv) => {
      if (onlyOverdue && new Date(inv.dueDate).getTime() >= Date.now()) return false;
      if (!q) return true;
      return (
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.customerName.toLowerCase().includes(q)
      );
    });
  }, [openSalesInvoices, onlyOverdue, search]);

  const displayedPayables = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return openSupplierInvoices;
    return openSupplierInvoices.filter(
      (inv) =>
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.supplierName.toLowerCase().includes(q)
    );
  }, [openSupplierInvoices, search]);

  const handleExportCsv = () => {
    const header = ['Référence', 'Flux', 'Facture', 'Tiers', 'Date', 'Moyen', 'Montant'];
    const rows = filteredPayments.map((p) => [
      p.reference,
      p.direction === 'incoming' ? 'Encaissement' : 'Décaissement',
      p.invoiceNumber,
      `"${(p.partyName || '').replace(/"/g, '""')}"`,
      p.paymentDate,
      METHOD_LABELS[p.method],
      p.direction === 'incoming' ? p.amount : -p.amount,
    ]);
    const csv = [header.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stockflow-tresorerie-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Accueil / Paiements &amp; Trésorerie
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Paiements &amp; Rapprochements
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            variant="outline"
            onClick={handleExportCsv}
            disabled={filteredPayments.length === 0}
          >
            <Download className="h-4 w-4" />
            <span>Export CSV</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={openSupplierInvoices.length === 0}
            onClick={() => openPaymentModal('outgoing')}
          >
            <ArrowUpRight className="h-4 w-4" />
            <span>Décaissement fournisseur</span>
          </Button>
          <Button
            type="button"
            disabled={openSalesInvoices.length === 0}
            onClick={() => openPaymentModal('incoming')}
          >
            <Plus className="h-4 w-4" />
            <span>Encaisser client</span>
          </Button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Total encaissé</span>
            <ArrowDownLeft className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="mt-2 font-mono text-xl font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
            +{formatCurrency(kpis.totalIncoming, currency)}
          </p>
          <p className="mt-1 text-xs text-slate-500">Règlements clients lettrés</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Total décaissé</span>
            <ArrowUpRight className="h-4 w-4 text-slate-400" />
          </div>
          <p className="mt-2 font-mono text-xl font-semibold text-slate-900 dark:text-white tabular-nums">
            -{formatCurrency(kpis.totalOutgoing, currency)}
          </p>
          <p className="mt-1 text-xs text-slate-500">Règlements fournisseurs</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Solde net enregistré</span>
            <Wallet className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <p className="mt-2 font-mono text-xl font-semibold text-slate-900 dark:text-white tabular-nums">
            {formatCurrency(kpis.netCashflow, currency)}
          </p>
          <p className="mt-1 text-xs text-slate-500">Flux cumulés encaissés − décaissés</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Créances échues</span>
            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
          </div>
          <p className="mt-2 font-mono text-xl font-semibold text-red-600 dark:text-red-400 tabular-nums">
            {formatCurrency(kpis.overdueTtc, currency)}
          </p>
          <p className="mt-1 text-xs text-slate-500 font-mono">
            {kpis.overdueCount} facture(s) à relancer
          </p>
        </div>
      </div>

      {/* Tabs + Search */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist">
          {(
            [
              { id: 'ledger', label: `Journal trésorerie (${payments.length})` },
              { id: 'receivables', label: `À encaisser (${openSalesInvoices.length})` },
              { id: 'payables', label: `À décaisser (${openSupplierInvoices.length})` },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                'rounded-lg px-3.5 py-2 text-xs font-medium transition-colors cursor-pointer',
                activeTab === t.id
                  ? 'bg-slate-900 text-white dark:bg-blue-600'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2.5">
          {activeTab === 'receivables' && (
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyOverdue}
                onChange={(e) => setOnlyOverdue(e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>Échues uniquement</span>
            </label>
          )}
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher référence, facture, tiers..."
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} />
      ) : (
        <>
          {activeTab === 'ledger' &&
            (filteredPayments.length === 0 ? (
              <EmptyState
                icon={CreditCard}
                title="Aucun paiement enregistré"
                description="Enregistrez vos encaissements clients et décaissements fournisseurs pour suivre les rapprochements de factures et la trésorerie réelle."
                action={
                  openSalesInvoices.length > 0 ? (
                    <Button type="button" onClick={() => openPaymentModal('incoming')}>
                      <Plus className="h-4 w-4" />
                      <span>Enregistrer un encaissement</span>
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50/80 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
                      <tr>
                        <th className="px-4 py-3 font-medium">Référence</th>
                        <th className="px-4 py-3 font-medium">Flux</th>
                        <th className="px-4 py-3 font-medium">Facture &amp; Tiers</th>
                        <th className="px-4 py-3 font-medium">Moyen</th>
                        <th className="px-4 py-3 font-medium">Date</th>
                        <th className="px-4 py-3 font-medium text-right">Montant</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredPayments.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-3">
                            <p className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                              {p.reference}
                            </p>
                            <p className="text-[11px] text-slate-400 font-mono">
                              {formatDateTime(p.createdAt)}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <StatusText
                              tone={p.direction === 'incoming' ? 'success' : 'neutral'}
                              label={p.direction === 'incoming' ? 'Encaissement' : 'Décaissement'}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-900 dark:text-slate-100">
                              {p.partyName}
                            </p>
                            <p className="font-mono text-xs text-slate-500">{p.invoiceNumber}</p>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                            {METHOD_LABELS[p.method]}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">
                            {formatDateShort(p.paymentDate)}
                          </td>
                          <td
                            className={`px-4 py-3 text-right font-mono font-semibold tabular-nums ${
                              p.direction === 'incoming'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-slate-900 dark:text-slate-100'
                            }`}
                          >
                            {p.direction === 'incoming' ? '+' : '-'}
                            {formatCurrency(p.amount, currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

          {activeTab === 'receivables' &&
            (displayedReceivables.length === 0 ? (
              <EmptyState
                icon={Wallet}
                title="Aucune créance client en attente"
                description="Toutes les factures clients émises sont soldées ou aucune facture ouverte ne correspond à ce filtre."
              />
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50/80 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
                      <tr>
                        <th className="px-4 py-3 font-medium">Facture</th>
                        <th className="px-4 py-3 font-medium">Client</th>
                        <th className="px-4 py-3 font-medium">Échéance</th>
                        <th className="px-4 py-3 font-medium text-right">TTC</th>
                        <th className="px-4 py-3 font-medium text-right">Reste à encaisser</th>
                        <th className="px-4 py-3 font-medium text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {displayedReceivables.map((inv) => {
                        const rem = Math.max(0, inv.totalTtc - inv.paidAmount);
                        const isOverdue = new Date(inv.dueDate).getTime() < Date.now();
                        return (
                          <tr key={inv.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                            <td className="px-4 py-3 font-mono font-semibold">
                              {inv.invoiceNumber}
                            </td>
                            <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                              {inv.customerName}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs">
                              <span
                                className={
                                  isOverdue
                                    ? 'font-semibold text-red-600 dark:text-red-400'
                                    : 'text-slate-600 dark:text-slate-300'
                                }
                              >
                                {formatDateShort(inv.dueDate)}
                                {isOverdue ? ' · En retard' : ''}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-mono tabular-nums">
                              {formatCurrency(inv.totalTtc, currency)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                              {formatCurrency(rem, currency)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => openPaymentModal('incoming', inv)}
                              >
                                Encaisser
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

          {activeTab === 'payables' &&
            (displayedPayables.length === 0 ? (
              <EmptyState
                icon={CreditCard}
                title="Aucune facture fournisseur à régler"
                description="Toutes les factures fournisseurs enregistrées sont soldées."
              />
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50/80 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
                      <tr>
                        <th className="px-4 py-3 font-medium">Facture</th>
                        <th className="px-4 py-3 font-medium">Fournisseur</th>
                        <th className="px-4 py-3 font-medium">Échéance</th>
                        <th className="px-4 py-3 font-medium text-right">TTC</th>
                        <th className="px-4 py-3 font-medium text-right">Reste à payer</th>
                        <th className="px-4 py-3 font-medium text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {displayedPayables.map((inv) => {
                        const rem = Math.max(0, inv.totalTtc - inv.paidAmount);
                        return (
                          <tr key={inv.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                            <td className="px-4 py-3 font-mono font-semibold">
                              {inv.invoiceNumber}
                            </td>
                            <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                              {inv.supplierName}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs">
                              {formatDateShort(inv.dueDate)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono tabular-nums">
                              {formatCurrency(inv.totalTtc, currency)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                              {formatCurrency(rem, currency)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => openPaymentModal('outgoing', inv)}
                              >
                                Régler
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
        </>
      )}

      {/* RECORD TREASURY PAYMENT MODAL */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={
          direction === 'incoming'
            ? 'Enregistrer un encaissement client'
            : 'Enregistrer un décaissement fournisseur'
        }
        subtitle="Le lettrage met à jour le solde de la facture et clôture automatiquement la commande une fois soldée."
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Facture concernée *
            </label>
            <select
              value={selectedInvoiceId}
              onChange={(e) => {
                setSelectedInvoiceId(e.target.value);
                const list =
                  direction === 'incoming' ? openSalesInvoices : openSupplierInvoices;
                const found = list.find((i) => i.id === e.target.value);
                if (found) {
                  setAmount(Number(Math.max(0, found.totalTtc - found.paidAmount).toFixed(2)));
                }
              }}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {(direction === 'incoming' ? openSalesInvoices : openSupplierInvoices).map((inv) => {
                const label =
                  direction === 'incoming'
                    ? (inv as SalesInvoice).customerName
                    : (inv as SupplierInvoice).supplierName;
                const rem = Math.max(0, inv.totalTtc - inv.paidAmount);
                return (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoiceNumber} — {label} (Reste : {formatCurrency(rem, currency)})
                  </option>
                );
              })}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Montant ({currency}) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Moyen de paiement
              </label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="transfer">Virement</option>
                <option value="card">Carte bancaire</option>
                <option value="check">Chèque</option>
                <option value="direct_debit">Prélèvement</option>
                <option value="cash">Espèces</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Date
              </label>
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Référence bancaire / Notes
            </label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex. Virement SEPA réf. 88421"
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Annuler
            </Button>
            <Button type="button" onClick={() => void handleSubmitPayment()} disabled={submitting}>
              {submitting ? 'Enregistrement...' : 'Valider le paiement'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
