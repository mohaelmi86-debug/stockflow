import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  CreditCard,
  Download,
  FileCheck2,
  FileMinus2,
  FileText,
  Plus,
  Printer,
  Search,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useBranding } from '../contexts/BrandingContext.tsx';
import { useToast } from '../contexts/ToastContext.tsx';
import { useErpData } from '../hooks/useErpData.ts';
import {
  computeSalesTotals,
  createSalesInvoice,
  getNextInvoiceSequence,
  recordTreasuryPayment,
} from '../services/salesService.ts';
import { salesInvoiceSchema, type SalesInvoiceInput } from '../shared/schemas.ts';
import { formatCurrency, formatDateShort, formatNumber } from '../shared/formatters.ts';
import type {
  PaymentMethod,
  SalesInvoice,
  SalesInvoiceType,
  SalesLine,
} from '../shared/types.ts';
import { Button } from '../components/ui/Button.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { TableSkeleton } from '../components/ui/Skeleton.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { StatusText, type SemanticTone } from '../components/ui/StatusText.tsx';

const INVOICE_TYPE_LABELS: Record<SalesInvoiceType, string> = {
  invoice: 'Facture',
  deposit: 'Acompte',
  credit_note: 'Avoir',
};

const INVOICE_STATUS_META: Record<
  SalesInvoice['status'],
  { label: string; tone: SemanticTone }
> = {
  issued: { label: 'Émise', tone: 'warning' },
  partially_paid: { label: 'Partiel', tone: 'info' },
  paid: { label: 'Soldée', tone: 'success' },
};

export function InvoicingPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, activeOrg } = useAuth();
  const { branding } = useBranding();
  const { toast } = useToast();
  const {
    products,
    customers,
    salesOrders,
    salesInvoices,
    isLoading,
    invalidateAll,
  } = useErpData();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | SalesInvoiceType>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | SalesInvoice['status']>('ALL');
  const [modalOpen, setModalOpen] = useState(false);
  const [relatedInvoiceId, setRelatedInvoiceId] = useState<string | undefined>(undefined);
  const [printInvoiceTarget, setPrintInvoiceTarget] = useState<SalesInvoice | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Quick payment modal
  const [payTarget, setPayTarget] = useState<SalesInvoice | null>(null);
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('transfer');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));

  const currency = activeOrg?.currency ?? 'EUR';
  const memberUids = activeOrg?.memberUids ?? (user ? [user.uid] : []);
  const actor = {
    uid: user?.uid ?? '',
    email: user?.email ?? '',
    displayName: user?.displayName || user?.email || 'Utilisateur',
  };

  const form = useForm<SalesInvoiceInput>({
    resolver: zodResolver(salesInvoiceSchema) as never,
    defaultValues: {
      invoiceType: 'invoice',
      customerId: '',
      salesOrderId: '',
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
      shippingCost: 0,
      notes: '',
      lines: [{ productId: '', quantity: 1, unitPrice: 0, discountPct: 0, vatRate: 20 }],
    },
  });
  const linesField = useFieldArray({ control: form.control, name: 'lines' });

  const openCreateModal = (opts?: {
    invoiceType?: SalesInvoiceType;
    orderId?: string;
    fromInvoice?: SalesInvoice;
  }) => {
    const type = opts?.invoiceType ?? 'invoice';
    const order = opts?.orderId ? salesOrders.find((o) => o.id === opts.orderId) : undefined;
    const fromInv = opts?.fromInvoice;
    const cust =
      customers.find((c) => c.id === (fromInv?.customerId ?? order?.customerId)) ??
      customers.find((c) => c.status === 'active') ??
      customers[0];
    const prod = products.find((p) => p.status === 'active') ?? products[0];

    setRelatedInvoiceId(fromInv?.id);

    const sourceLines = fromInv?.lines ?? order?.lines;
    form.reset({
      invoiceType: type,
      customerId: cust?.id ?? '',
      salesOrderId: fromInv?.salesOrderId ?? order?.id ?? '',
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
      shippingCost: fromInv?.shippingCost ?? order?.shippingCost ?? 0,
      notes: fromInv
        ? `Avoir annulant/rectifiant la facture ${fromInv.invoiceNumber}`
        : order
          ? `Facturation commande ${order.reference}`
          : '',
      lines: sourceLines?.length
        ? sourceLines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountPct: l.discountPct,
            vatRate: l.vatRate,
          }))
        : [
            {
              productId: prod?.id ?? '',
              quantity: 1,
              unitPrice: prod?.salePrice ?? 0,
              discountPct: 0,
              vatRate: prod?.vatRate ?? 20,
            },
          ],
    });
    setModalOpen(true);
  };

  useEffect(() => {
    const orderId = searchParams.get('orderId');
    if (orderId && salesOrders.length > 0 && customers.length > 0) {
      const ord = salesOrders.find((o) => o.id === orderId);
      if (ord) {
        openCreateModal({ invoiceType: 'invoice', orderId: ord.id });
        searchParams.delete('orderId');
        setSearchParams(searchParams, { replace: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, salesOrders, customers]);

  const watchedType = form.watch('invoiceType');
  const watchedLines = form.watch('lines');
  const watchedShipping = form.watch('shippingCost');

  const nextNumberPreview = useMemo(
    () => getNextInvoiceSequence(salesInvoices, watchedType),
    [salesInvoices, watchedType]
  );

  const previewTotals = useMemo(() => {
    const normalized: SalesLine[] = (watchedLines ?? []).map((l) => ({
      productId: l.productId || '',
      productSku: '',
      productName: '',
      unit: '',
      quantity: Number(l.quantity || 0),
      unitPrice: Number(l.unitPrice || 0),
      discountPct: Number(l.discountPct || 0),
      vatRate: Number(l.vatRate || 0),
    }));
    return computeSalesTotals(normalized, Number(watchedShipping || 0));
  }, [watchedLines, watchedShipping]);

  const kpis = useMemo(() => {
    let netHt = 0;
    let netVat = 0;
    let collectedTtc = 0;
    let remainingTtc = 0;

    for (const inv of salesInvoices) {
      const sign = inv.invoiceType === 'credit_note' ? -1 : 1;
      netHt += sign * inv.totalHt;
      netVat += sign * inv.totalVat;
      if (inv.invoiceType !== 'credit_note') {
        collectedTtc += inv.paidAmount;
        remainingTtc += Math.max(0, inv.totalTtc - inv.paidAmount);
      }
    }
    return { netHt, netVat, collectedTtc, remainingTtc };
  }, [salesInvoices]);

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return salesInvoices.filter((inv) => {
      if (typeFilter !== 'ALL' && inv.invoiceType !== typeFilter) return false;
      if (statusFilter !== 'ALL' && inv.status !== statusFilter) return false;
      if (!q) return true;
      return (
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.customerName.toLowerCase().includes(q) ||
        (inv.salesOrderRef ?? '').toLowerCase().includes(q)
      );
    });
  }, [salesInvoices, search, typeFilter, statusFilter]);

  const onSubmit = form.handleSubmit(async (data) => {
    if (!activeOrg || !user) return;
    const cust = customers.find((c) => c.id === data.customerId);
    if (!cust) {
      toast({ title: 'Client introuvable', variant: 'error' });
      return;
    }
    const linkedOrder = data.salesOrderId
      ? salesOrders.find((o) => o.id === data.salesOrderId)
      : undefined;

    setSubmitting(true);
    try {
      const { invoiceNumber } = await createSalesInvoice({
        orgId: activeOrg.id,
        memberUids,
        existingInvoices: salesInvoices,
        input: data,
        products,
        customer: cust,
        linkedOrder,
        relatedInvoiceId,
        actor,
      });
      toast({
        title: `Pièce ${invoiceNumber} émise`,
        description: `${INVOICE_TYPE_LABELS[data.invoiceType]} enregistrée pour ${cust.name}.`,
        variant: 'success',
      });
      setModalOpen(false);
      setRelatedInvoiceId(undefined);
      await invalidateAll();
    } catch (err) {
      toast({
        title: 'Émission impossible',
        description: err instanceof Error ? err.message : 'Erreur inconnue',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  });

  const handleQuickPay = async () => {
    if (!activeOrg || !user || !payTarget || payAmount <= 0) return;
    setSubmitting(true);
    try {
      const ref = await recordTreasuryPayment({
        orgId: activeOrg.id,
        memberUids,
        input: {
          direction: 'incoming',
          invoiceId: payTarget.id,
          amount: Number(payAmount),
          method: payMethod,
          paymentDate: payDate,
          notes: `Encaissement direct depuis Facturation`,
        },
        salesInvoice: payTarget,
        actor,
      });
      toast({
        title: `Encaissement ${ref} enregistré`,
        description: `${formatCurrency(payAmount, currency)} lettré sur ${payTarget.invoiceNumber}.`,
        variant: 'success',
      });
      setPayTarget(null);
      await invalidateAll();
    } catch (err) {
      toast({
        title: 'Erreur lors de l’encaissement',
        description: err instanceof Error ? err.message : 'Erreur inconnue',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleExportAccountingCsv = () => {
    const header = [
      'Numéro pièce',
      'Type',
      'Date émission',
      'Date échéance',
      'Client',
      'SIRET client',
      'Commande',
      'Total HT',
      'Total TVA',
      'Total TTC',
      'Encaissé',
      'Reste dû',
      'Statut',
    ];
    const rows = filteredInvoices.map((inv) => {
      const sign = inv.invoiceType === 'credit_note' ? -1 : 1;
      const remaining =
        inv.invoiceType === 'credit_note' ? 0 : Math.max(0, inv.totalTtc - inv.paidAmount);
      return [
        inv.invoiceNumber,
        INVOICE_TYPE_LABELS[inv.invoiceType],
        inv.issueDate,
        inv.dueDate,
        `"${(inv.customerName || '').replace(/"/g, '""')}"`,
        inv.customerSiret ?? '',
        inv.salesOrderRef ?? '',
        (sign * inv.totalHt).toFixed(2),
        (sign * inv.totalVat).toFixed(2),
        (sign * inv.totalTtc).toFixed(2),
        inv.paidAmount.toFixed(2),
        remaining.toFixed(2),
        INVOICE_STATUS_META[inv.status].label,
      ];
    });
    const csv = [header.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stockflow-journal-ventes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const vatBreakdownForPrint = useMemo(() => {
    if (!printInvoiceTarget) return [];
    const map = new Map<number, { baseHt: number; vatAmount: number }>();
    for (const l of printInvoiceTarget.lines) {
      const netHt = l.quantity * l.unitPrice * (1 - l.discountPct / 100);
      const vat = netHt * (l.vatRate / 100);
      const cur = map.get(l.vatRate) ?? { baseHt: 0, vatAmount: 0 };
      cur.baseHt += netHt;
      cur.vatAmount += vat;
      map.set(l.vatRate, cur);
    }
    if (printInvoiceTarget.shippingCost > 0) {
      const cur = map.get(20) ?? { baseHt: 0, vatAmount: 0 };
      cur.baseHt += printInvoiceTarget.shippingCost;
      cur.vatAmount += printInvoiceTarget.shippingCost * 0.2;
      map.set(20, cur);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [printInvoiceTarget]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Accueil / Facturation &amp; Conformité
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Facturation séquentielle
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            variant="outline"
            onClick={handleExportAccountingCsv}
            disabled={filteredInvoices.length === 0}
          >
            <Download className="h-4 w-4" />
            <span>Export comptable CSV</span>
          </Button>
          <Button
            type="button"
            onClick={() => openCreateModal({ invoiceType: 'invoice' })}
            disabled={customers.length === 0 || products.length === 0}
          >
            <Plus className="h-4 w-4" />
            <span>Nouvelle facture / Acompte</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Chiffre d’affaires net HT</span>
            <FileCheck2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <p className="mt-2 font-mono text-xl font-semibold text-slate-900 dark:text-white tabular-nums">
            {formatCurrency(kpis.netHt, currency)}
          </p>
          <p className="mt-1 text-xs text-slate-500">Factures + acomptes − avoirs</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>TVA collectée nette</span>
            <FileText className="h-4 w-4 text-slate-400" />
          </div>
          <p className="mt-2 font-mono text-xl font-semibold text-slate-900 dark:text-white tabular-nums">
            {formatCurrency(kpis.netVat, currency)}
          </p>
          <p className="mt-1 text-xs text-slate-500">Multi-taux ventilée</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Encaissé TTC</span>
            <CreditCard className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="mt-2 font-mono text-xl font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
            {formatCurrency(kpis.collectedTtc, currency)}
          </p>
          <p className="mt-1 text-xs text-slate-500">Règlements clients lettrés</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Reste à encaisser TTC</span>
            <FileMinus2 className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <p className="mt-2 font-mono text-xl font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
            {formatCurrency(kpis.remainingTtc, currency)}
          </p>
          <p className="mt-1 text-xs text-slate-500">Créances clients ouvertes</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher n° facture, client, commande..."
            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filtrer par type de pièce"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'ALL' | SalesInvoiceType)}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="ALL">Tous types (FAC / ACP / AV)</option>
            <option value="invoice">Factures (FAC)</option>
            <option value="deposit">Acomptes (ACP)</option>
            <option value="credit_note">Avoirs (AV)</option>
          </select>
          <select
            aria-label="Filtrer par statut de paiement"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as 'ALL' | SalesInvoice['status'])
            }
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="ALL">Tous statuts</option>
            <option value="issued">Émise</option>
            <option value="partially_paid">Paiement partiel</option>
            <option value="paid">Soldée</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} />
      ) : filteredInvoices.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Aucune pièce de facturation"
          description="Émettez une facture définitive, un acompte ou un avoir conforme avec numérotation chronologique continue (FAC / ACP / AV)."
          action={
            customers.length === 0 ? (
              <Button type="button" onClick={() => navigate('/clients')}>
                Créer un client d’abord
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => openCreateModal({ invoiceType: 'invoice' })}
              >
                <Plus className="h-4 w-4" />
                <span>Émettre une facture</span>
              </Button>
            )
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/80 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
                <tr>
                  <th className="px-4 py-3 font-medium">N° Pièce</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Émission / Échéance</th>
                  <th className="px-4 py-3 font-medium text-right">HT</th>
                  <th className="px-4 py-3 font-medium text-right">TTC</th>
                  <th className="px-4 py-3 font-medium text-right">Reste dû</th>
                  <th className="px-4 py-3 font-medium">Statut</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredInvoices.map((inv) => {
                  const sign = inv.invoiceType === 'credit_note' ? -1 : 1;
                  const remaining =
                    inv.invoiceType === 'credit_note'
                      ? 0
                      : Math.max(0, inv.totalTtc - inv.paidAmount);
                  const isOverdue =
                    inv.invoiceType !== 'credit_note' &&
                    inv.status !== 'paid' &&
                    new Date(inv.dueDate).getTime() < Date.now();
                  const meta = INVOICE_STATUS_META[inv.status];
                  return (
                    <tr key={inv.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {inv.invoiceNumber}
                        </p>
                        {inv.salesOrderRef && (
                          <p className="font-mono text-[11px] text-slate-500">
                            CC {inv.salesOrderRef}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium text-slate-700 dark:text-slate-300">
                        {INVOICE_TYPE_LABELS[inv.invoiceType]}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                        {inv.customerName}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        <p className="text-slate-700 dark:text-slate-300">
                          {formatDateShort(inv.issueDate)}
                        </p>
                        <p
                          className={
                            isOverdue
                              ? 'font-semibold text-red-600 dark:text-red-400'
                              : 'text-slate-500'
                          }
                        >
                          Éch. {formatDateShort(inv.dueDate)}
                          {isOverdue ? ' · Retard' : ''}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300">
                        {formatCurrency(sign * inv.totalHt, currency)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                        {formatCurrency(sign * inv.totalTtc, currency)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-semibold tabular-nums text-slate-800 dark:text-slate-200">
                        {formatCurrency(remaining, currency)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusText tone={meta.tone} label={meta.label} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setPrintInvoiceTarget(inv)}
                          >
                            <Printer className="h-3.5 w-3.5" />
                            <span>Aperçu / PDF</span>
                          </Button>
                          {inv.invoiceType !== 'credit_note' && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                openCreateModal({ invoiceType: 'credit_note', fromInvoice: inv })
                              }
                            >
                              Avoir
                            </Button>
                          )}
                          {inv.invoiceType !== 'credit_note' && inv.status !== 'paid' && (
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => {
                                setPayTarget(inv);
                                setPayAmount(Number(remaining.toFixed(2)));
                                setPayMethod('transfer');
                                setPayDate(new Date().toISOString().slice(0, 10));
                              }}
                            >
                              <CreditCard className="h-3.5 w-3.5" />
                              <span>Encaisser</span>
                            </Button>
                          )}
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

      {/* Create Sequential Invoice / Deposit / Credit Note Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Émettre une pièce de facturation"
        subtitle={`Numéro séquentiel attribué automatiquement : ${nextNumberPreview.invoiceNumber}`}
        size="xl"
      >
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Type de pièce *
              </label>
              <select
                {...form.register('invoiceType')}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="invoice">Facture définitive (FAC)</option>
                <option value="deposit">Facture d’acompte (ACP)</option>
                <option value="credit_note">Avoir client (AV)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Client *
              </label>
              <select
                {...form.register('customerId')}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Commande client liée (optionnel)
              </label>
              <select
                {...form.register('salesOrderId')}
                onChange={(e) => {
                  const ordId = e.target.value;
                  form.setValue('salesOrderId', ordId);
                  const ord = salesOrders.find((o) => o.id === ordId);
                  if (ord) {
                    form.setValue('customerId', ord.customerId);
                    form.setValue('shippingCost', ord.shippingCost);
                    form.setValue(
                      'lines',
                      ord.lines.map((l) => ({
                        productId: l.productId,
                        quantity: l.quantity,
                        unitPrice: l.unitPrice,
                        discountPct: l.discountPct,
                        vatRate: l.vatRate,
                      }))
                    );
                  }
                }}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="">Facturation directe sans commande</option>
                {salesOrders
                  .filter((o) => o.status !== 'canceled')
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.reference} — {o.customerName} ({formatCurrency(o.totalTtc, currency)})
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Date d’émission *
              </label>
              <input
                type="date"
                {...form.register('issueDate')}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Date d’échéance *
              </label>
              <input
                type="date"
                {...form.register('dueDate')}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Frais de port HT ({currency})
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                {...form.register('shippingCost')}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Lignes facturées
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  const p = products.find((item) => item.status === 'active') ?? products[0];
                  linesField.append({
                    productId: p?.id ?? '',
                    quantity: 1,
                    unitPrice: p?.salePrice ?? 0,
                    discountPct: 0,
                    vatRate: p?.vatRate ?? 20,
                  });
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Ajouter ligne</span>
              </Button>
            </div>
            <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              {linesField.fields.map((field, idx) => (
                <div key={field.id} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-12 sm:col-span-5">
                    <label className="block text-[11px] text-slate-500">Produit</label>
                    <select
                      {...form.register(`lines.${idx}.productId`)}
                      onChange={(e) => {
                        form.setValue(`lines.${idx}.productId`, e.target.value);
                        const prod = products.find((p) => p.id === e.target.value);
                        if (prod) {
                          form.setValue(`lines.${idx}.unitPrice`, prod.salePrice);
                          form.setValue(`lines.${idx}.vatRate`, prod.vatRate);
                        }
                      }}
                      className="mt-0.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                    >
                      <option value="">Sélectionner...</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} — {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-3 sm:col-span-2">
                    <label className="block text-[11px] text-slate-500">Qté</label>
                    <input
                      type="number"
                      step="any"
                      min="0.001"
                      {...form.register(`lines.${idx}.quantity`)}
                      className="mt-0.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                  <div className="col-span-3 sm:col-span-2">
                    <label className="block text-[11px] text-slate-500">PU HT</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      {...form.register(`lines.${idx}.unitPrice`)}
                      className="mt-0.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                  <div className="col-span-3 sm:col-span-1">
                    <label className="block text-[11px] text-slate-500">Rem.%</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      {...form.register(`lines.${idx}.discountPct`)}
                      className="mt-0.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-[11px] text-slate-500">TVA%</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      {...form.register(`lines.${idx}.vatRate`)}
                      className="mt-0.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    {linesField.fields.length > 1 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => linesField.remove(idx)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg bg-slate-50 px-4 py-3 text-xs dark:bg-slate-800/60">
            <span className="font-mono text-slate-600 dark:text-slate-300">
              Prochaine pièce : <strong>{nextNumberPreview.invoiceNumber}</strong> (séquence #
              {nextNumberPreview.sequenceNumber})
            </span>
            <div className="flex items-center gap-4 font-mono tabular-nums">
              <span className="text-slate-500">
                HT : {formatCurrency(previewTotals.subtotalHt, currency)}
              </span>
              <span className="text-slate-500">
                TVA : {formatCurrency(previewTotals.vatTotal, currency)}
              </span>
              <span className="text-sm font-bold text-slate-900 dark:text-white">
                TTC : {formatCurrency(previewTotals.totalTtc, currency)}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Mentions particulières / notes
            </label>
            <textarea
              rows={2}
              {...form.register('notes')}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div className="flex justify-end gap-2.5 border-t border-slate-100 pt-4 dark:border-slate-800">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={submitting}>
              Émettre {nextNumberPreview.invoiceNumber}
            </Button>
          </div>
        </form>
      </Modal>

      {/* French-Compliant Legal Invoice Preview & Print */}
      <Modal
        open={!!printInvoiceTarget}
        onClose={() => setPrintInvoiceTarget(null)}
        title={
          printInvoiceTarget
            ? `${INVOICE_TYPE_LABELS[printInvoiceTarget.invoiceType]} ${printInvoiceTarget.invoiceNumber}`
            : ''
        }
        subtitle="Document comptable conforme avec mentions légales françaises & ventilation TVA"
        size="xl"
      >
        {printInvoiceTarget && (
          <div className="space-y-5 text-sm">
            <div className="flex flex-col sm:flex-row sm:justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-20 shrink-0 items-center justify-center rounded bg-white p-1 print:border-0"><img src={branding.logoUrl || '/stockflow-logo.svg'} alt={branding.brandName} className="max-h-full max-w-full object-contain" onError={e=>{e.currentTarget.src='/stockflow-logo.svg';}}/></div>
                <div>
                <p className="font-display text-lg font-bold text-slate-900 dark:text-white">
                  {activeOrg?.name}
                </p>
                {branding.mode !== 'stockflow' && <p className="text-xs font-medium" style={{color:branding.primaryColor}}>{branding.brandName}{branding.showStockFlow?' · StockFlow':''}</p>}
                <p className="text-xs text-slate-500">{activeOrg?.country || 'France'}</p>
                {activeOrg?.siret && (
                  <p className="font-mono text-xs text-slate-600 dark:text-slate-400">
                    SIRET : {activeOrg.siret}
                  </p>
                )}
                {activeOrg?.vatNumber && (
                  <p className="font-mono text-xs text-slate-600 dark:text-slate-400">
                    TVA intracommunautaire : {activeOrg.vatNumber}
                  </p>
                )}
                </div>
              </div>
              <div className="sm:text-right">
                <p className="text-xs uppercase tracking-wider text-slate-500">
                  {INVOICE_TYPE_LABELS[printInvoiceTarget.invoiceType]}
                </p>
                <p className="font-mono text-lg font-bold text-slate-900 dark:text-white">
                  {printInvoiceTarget.invoiceNumber}
                </p>
                <p className="font-mono text-xs text-slate-500">
                  Émise le {formatDateShort(printInvoiceTarget.issueDate)} · Échéance{' '}
                  {formatDateShort(printInvoiceTarget.dueDate)}
                </p>
                {printInvoiceTarget.salesOrderRef && (
                  <p className="font-mono text-xs text-slate-500">
                    Réf. commande : {printInvoiceTarget.salesOrderRef}
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 p-3.5 text-xs dark:bg-slate-800/50">
              <p className="text-slate-500">Facturé à :</p>
              <p className="mt-1 font-semibold text-slate-900 dark:text-white">
                {printInvoiceTarget.customerName}
              </p>
              {printInvoiceTarget.customerAddress && (
                <p className="text-slate-600 dark:text-slate-300">
                  {printInvoiceTarget.customerAddress}
                </p>
              )}
              <div className="mt-1 flex flex-wrap gap-4 font-mono text-slate-500">
                {printInvoiceTarget.customerSiret && (
                  <span>SIRET : {printInvoiceTarget.customerSiret}</span>
                )}
                {printInvoiceTarget.customerVatNumber && (
                  <span>TVA : {printInvoiceTarget.customerVatNumber}</span>
                )}
              </div>
            </div>

            <table className="w-full text-left text-xs border border-slate-200 dark:border-slate-800">
              <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900">
                <tr>
                  <th className="px-3 py-2 font-medium">Réf. / Désignation</th>
                  <th className="px-3 py-2 font-medium text-right">Qté</th>
                  <th className="px-3 py-2 font-medium text-right">PU HT</th>
                  <th className="px-3 py-2 font-medium text-right">Rem.</th>
                  <th className="px-3 py-2 font-medium text-right">TVA</th>
                  <th className="px-3 py-2 font-medium text-right">Total HT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {printInvoiceTarget.lines.map((l, idx) => {
                  const lineHt = l.quantity * l.unitPrice * (1 - l.discountPct / 100);
                  return (
                    <tr key={`${l.productId}-${idx}`}>
                      <td className="px-3 py-2">
                        <span className="font-mono text-slate-500 mr-2">{l.productSku}</span>
                        <span className="font-medium">{l.productName}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {formatNumber(l.quantity)} {l.unit}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {formatCurrency(l.unitPrice, currency)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {l.discountPct}%
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{l.vatRate}%</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                        {formatCurrency(lineHt, currency)}
                      </td>
                    </tr>
                  );
                })}
                {printInvoiceTarget.shippingCost > 0 && (
                  <tr>
                    <td className="px-3 py-2 font-medium">Frais de transport / expédition</td>
                    <td className="px-3 py-2 text-right font-mono">1</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {formatCurrency(printInvoiceTarget.shippingCost, currency)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">0%</td>
                    <td className="px-3 py-2 text-right font-mono">20%</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                      {formatCurrency(printInvoiceTarget.shippingCost, currency)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
              <div className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-800">
                <p className="font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Ventilation TVA
                </p>
                <div className="space-y-1 font-mono tabular-nums">
                  {vatBreakdownForPrint.map(([rate, vals]) => (
                    <div key={rate} className="flex justify-between text-slate-600 dark:text-slate-400">
                      <span>Taux {rate}% (Base {formatCurrency(vals.baseHt, currency)})</span>
                      <span>{formatCurrency(vals.vatAmount, currency)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-1 text-xs font-mono tabular-nums sm:pl-8">
                <div className="flex justify-between">
                  <span className="text-slate-500">Total HT :</span>
                  <span>{formatCurrency(printInvoiceTarget.totalHt, currency)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Total TVA :</span>
                  <span>{formatCurrency(printInvoiceTarget.totalVat, currency)}</span>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-1 text-sm font-bold dark:border-slate-800">
                  <span>
                    {printInvoiceTarget.invoiceType === 'credit_note'
                      ? 'Net à déduire TTC :'
                      : 'Net à payer TTC :'}
                  </span>
                  <span>{formatCurrency(printInvoiceTarget.totalTtc, currency)}</span>
                </div>
                {printInvoiceTarget.invoiceType !== 'credit_note' && (
                  <div className="flex justify-between text-emerald-700 dark:text-emerald-400 pt-1">
                    <span>Déjà encaissé :</span>
                    <span>{formatCurrency(printInvoiceTarget.paidAmount, currency)}</span>
                  </div>
                )}
              </div>
            </div>

            {branding.footerText && <p className="text-center text-[10px] text-slate-500">{branding.footerText}</p>}
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-[11px] leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
              <p>
                <strong>Mentions légales obligatoires :</strong> En cas de retard de paiement, une
                pénalité égale à 3 fois le taux d’intérêt légal en vigueur est exigible de plein
                droit, sans qu’un rappel soit nécessaire (art. L.441-10 C. com.), ainsi qu’une
                indemnité forfaitaire pour frais de recouvrement de 40 € (art. D.441-5 C. com.).
                Aucun escompte pour paiement anticipé. Piste d’audit fiable &amp; structure prête
                Factur-X (EN 16931).
              </p>
            </div>

            <div className="flex justify-between items-center pt-1 print:hidden">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setPrintInvoiceTarget(null);
                  navigate('/paiements');
                }}
              >
                Ouvrir les paiements
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPrintInvoiceTarget(null)}
                >
                  Fermer
                </Button>
                <Button type="button" onClick={() => window.print()}>
                  <Printer className="h-4 w-4" />
                  <span>Imprimer / PDF</span>
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Quick Payment Modal */}
      <Modal
        open={!!payTarget}
        onClose={() => setPayTarget(null)}
        title={payTarget ? `Encaisser ${payTarget.invoiceNumber}` : ''}
        subtitle={
          payTarget
            ? `${payTarget.customerName} — Reste dû : ${formatCurrency(
                Math.max(0, payTarget.totalTtc - payTarget.paidAmount),
                currency
              )}`
            : ''
        }
      >
        {payTarget && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Montant encaissé ({currency}) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={Math.max(0, payTarget.totalTtc - payTarget.paidAmount)}
                  value={payAmount}
                  onChange={(e) => setPayAmount(Number(e.target.value))}
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Date d’opération *
                </label>
                <input
                  type="date"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Moyen de paiement
              </label>
              <select
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="transfer">Virement bancaire</option>
                <option value="card">Carte bancaire</option>
                <option value="direct_debit">Prélèvement SEPA</option>
                <option value="check">Chèque</option>
                <option value="cash">Espèces</option>
              </select>
            </div>
            <div className="flex justify-end gap-2.5 border-t border-slate-100 pt-4 dark:border-slate-800">
              <Button type="button" variant="outline" onClick={() => setPayTarget(null)}>
                Annuler
              </Button>
              <Button type="button" disabled={submitting} onClick={() => void handleQuickPay()}>
                Valider l’encaissement
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
