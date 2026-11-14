import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  CheckCircle2,
  ClipboardCheck,
  Eye,
  FilePlus2,
  FileText,
  Lock,
  PackageCheck,
  Plus,
  Printer,
  Search,
  Send,
  Sparkles,
  Trash2,
  TrendingUp,
  Truck,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useToast } from '../contexts/ToastContext.tsx';
import { useErpData } from '../hooks/useErpData.ts';
import {
  cancelSalesOrder,
  computeSalesTotals,
  createQuote,
  createSalesOrder,
  reserveSalesOrderStock,
  seedSalesDemoData,
  shipSalesOrder,
  updateQuoteStatus,
  type DeliveryInputLine,
} from '../services/salesService.ts';
import {
  quoteSchema,
  salesOrderSchema,
  type QuoteInput,
  type SalesOrderInput,
} from '../shared/schemas.ts';
import {
  formatCurrency,
  formatDateShort,
  formatDateTime,
  formatNumber,
} from '../shared/formatters.ts';
import type {
  DeliveryNote,
  Quote,
  SalesLine,
  SalesOrder,
} from '../shared/types.ts';
import { Button } from '../components/ui/Button.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { ConfirmDialog } from '../components/ui/ConfirmDialog.tsx';
import { TableSkeleton } from '../components/ui/Skeleton.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { StatusText, type SemanticTone } from '../components/ui/StatusText.tsx';
import { cn } from '../lib/cn.ts';

type SalesTab = 'quotes' | 'orders' | 'deliveries';

const QUOTE_STATUS_META: Record<Quote['status'], { label: string; tone: SemanticTone }> = {
  draft: { label: 'Brouillon', tone: 'neutral' },
  sent: { label: 'Envoyé', tone: 'info' },
  accepted: { label: 'Accepté', tone: 'success' },
  rejected: { label: 'Refusé', tone: 'error' },
  expired: { label: 'Expiré', tone: 'warning' },
  converted: { label: 'Converti en CC', tone: 'success' },
};

const SO_STATUS_META: Record<SalesOrder['status'], { label: string; tone: SemanticTone }> = {
  draft: { label: 'Brouillon', tone: 'neutral' },
  confirmed: { label: 'Confirmée', tone: 'info' },
  preparing: { label: 'En préparation', tone: 'info' },
  partially_delivered: { label: 'Livraison partielle', tone: 'warning' },
  delivered: { label: 'Livrée', tone: 'success' },
  invoiced: { label: 'Facturée', tone: 'success' },
  closed: { label: 'Clôturée', tone: 'success' },
  canceled: { label: 'Annulée', tone: 'error' },
};

export function SalesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, activeOrg } = useAuth();
  const { toast } = useToast();
  const {
    products,
    warehouses,
    locations,
    balances,
    customers,
    quotes,
    salesOrders,
    deliveryNotes,
    isLoading,
    invalidateAll,
  } = useErpData();

  const initialTab = searchParams.get('tab') as SalesTab | null;
  const [activeTab, setActiveTab] = useState<SalesTab>(
    initialTab && ['quotes', 'orders', 'deliveries'].includes(initialTab) ? initialTab : 'orders'
  );
  const [search, setSearch] = useState('');
  const [soStatusFilter, setSoStatusFilter] = useState<'ALL' | SalesOrder['status']>('ALL');
  const [submitting, setSubmitting] = useState(false);

  const [quoteModalOpen, setQuoteModalOpen] = useState(false);
  const [sendQuoteImmediately, setSendQuoteImmediately] = useState(true);
  const [printQuoteTarget, setPrintQuoteTarget] = useState<Quote | null>(null);

  const [soModalOpen, setSoModalOpen] = useState(false);
  const [sourceQuoteId, setSourceQuoteId] = useState<string | undefined>(undefined);
  const [confirmImmediately, setConfirmImmediately] = useState(true);
  const [printOrderTarget, setPrintOrderTarget] = useState<SalesOrder | null>(null);
  const [cancelOrderTarget, setCancelOrderTarget] = useState<SalesOrder | null>(null);

  const [shipOrderTarget, setShipOrderTarget] = useState<SalesOrder | null>(null);
  const [deliveryLines, setDeliveryLines] = useState<DeliveryInputLine[]>([]);
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [deliveryNotesText, setDeliveryNotesText] = useState('');
  const [deliveryDetailTarget, setDeliveryDetailTarget] = useState<DeliveryNote | null>(null);

  const currency = activeOrg?.currency ?? 'EUR';
  const memberUids = activeOrg?.memberUids ?? (user ? [user.uid] : []);
  const actor = {
    uid: user?.uid ?? '',
    email: user?.email ?? '',
    displayName: user?.displayName || user?.email || 'Utilisateur',
  };

  const quoteForm = useForm<QuoteInput>({
    resolver: zodResolver(quoteSchema) as never,
    defaultValues: {
      customerId: '',
      warehouseId: warehouses[0]?.id ?? '',
      validUntil: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
      paymentTerms: '30 jours fin de mois',
      shippingCost: 0,
      notes: '',
      lines: [{ productId: '', quantity: 1, unitPrice: 0, discountPct: 0, vatRate: 20 }],
    },
  });
  const quoteLinesField = useFieldArray({ control: quoteForm.control, name: 'lines' });

  const soForm = useForm<SalesOrderInput>({
    resolver: zodResolver(salesOrderSchema) as never,
    defaultValues: {
      customerId: '',
      warehouseId: warehouses[0]?.id ?? '',
      expectedDeliveryDate: new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10),
      paymentTerms: '30 jours fin de mois',
      shippingCost: 0,
      notes: '',
      lines: [{ productId: '', quantity: 1, unitPrice: 0, discountPct: 0, vatRate: 20 }],
    },
  });
  const soLinesField = useFieldArray({ control: soForm.control, name: 'lines' });

  useEffect(() => {
    const custId = searchParams.get('customerId');
    if (custId && customers.length > 0) {
      const cust = customers.find((c) => c.id === custId);
      if (cust) {
        setActiveTab('orders');
        openCreateSoModal({ customerId: cust.id });
        searchParams.delete('customerId');
        setSearchParams(searchParams, { replace: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, customers]);

  const kpis = useMemo(() => {
    const openQuotes = quotes.filter(
      (q) => q.status === 'draft' || q.status === 'sent' || q.status === 'accepted'
    );
    const openOrders = salesOrders.filter(
      (o) =>
        o.status === 'confirmed' ||
        o.status === 'preparing' ||
        o.status === 'partially_delivered' ||
        o.status === 'delivered'
    );
    const openOrdersTtc = openOrders.reduce((acc, o) => acc + o.totalTtc, 0);
    const reservedUnits = salesOrders
      .filter((o) => o.status !== 'canceled' && o.status !== 'closed')
      .reduce(
        (acc, o) => acc + o.lines.reduce((lAcc, l) => lAcc + l.reservedQty, 0),
        0
      );
    return {
      openQuotesCount: openQuotes.length,
      openQuotesTtc: openQuotes.reduce((acc, q) => acc + q.totalTtc, 0),
      openOrdersCount: openOrders.length,
      openOrdersTtc,
      reservedUnits,
      deliveriesCount: deliveryNotes.length,
    };
  }, [quotes, salesOrders, deliveryNotes]);

  const watchedQuoteLines = quoteForm.watch('lines');
  const watchedQuoteShipping = quoteForm.watch('shippingCost');
  const quotePreviewTotals = useMemo(() => {
    const normalized: SalesLine[] = (watchedQuoteLines ?? []).map((l) => ({
      productId: l.productId || '',
      productSku: '',
      productName: '',
      unit: '',
      quantity: Number(l.quantity || 0),
      unitPrice: Number(l.unitPrice || 0),
      discountPct: Number(l.discountPct || 0),
      vatRate: Number(l.vatRate || 0),
    }));
    return computeSalesTotals(normalized, Number(watchedQuoteShipping || 0));
  }, [watchedQuoteLines, watchedQuoteShipping]);

  const watchedSoLines = soForm.watch('lines');
  const watchedSoShipping = soForm.watch('shippingCost');
  const soPreviewTotals = useMemo(() => {
    const normalized: SalesLine[] = (watchedSoLines ?? []).map((l) => ({
      productId: l.productId || '',
      productSku: '',
      productName: '',
      unit: '',
      quantity: Number(l.quantity || 0),
      unitPrice: Number(l.unitPrice || 0),
      discountPct: Number(l.discountPct || 0),
      vatRate: Number(l.vatRate || 0),
    }));
    return computeSalesTotals(normalized, Number(watchedSoShipping || 0));
  }, [watchedSoLines, watchedSoShipping]);

  const openCreateQuoteModal = () => {
    const cust = customers.find((c) => c.status === 'active') ?? customers[0];
    const prod = products.find((p) => p.status === 'active') ?? products[0];
    setSendQuoteImmediately(true);
    quoteForm.reset({
      customerId: cust?.id ?? '',
      warehouseId: warehouses[0]?.id ?? '',
      validUntil: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
      paymentTerms: cust?.paymentTerms ?? '30 jours fin de mois',
      shippingCost: 0,
      notes: '',
      lines: [
        {
          productId: prod?.id ?? '',
          quantity: 1,
          unitPrice: prod?.salePrice ?? 0,
          discountPct: 0,
          vatRate: prod?.vatRate ?? 20,
        },
      ],
    });
    setQuoteModalOpen(true);
  };

  const openCreateSoModal = (opts?: {
    customerId?: string;
    warehouseId?: string;
    quote?: Quote;
  }) => {
    const cust =
      customers.find((c) => c.id === (opts?.quote?.customerId ?? opts?.customerId)) ??
      customers.find((c) => c.status === 'active') ??
      customers[0];
    const prod = products.find((p) => p.status === 'active') ?? products[0];

    setSourceQuoteId(opts?.quote?.id);
    setConfirmImmediately(true);
    soForm.reset({
      customerId: cust?.id ?? '',
      warehouseId: opts?.quote?.warehouseId ?? opts?.warehouseId ?? warehouses[0]?.id ?? '',
      expectedDeliveryDate: new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10),
      paymentTerms: opts?.quote?.paymentTerms ?? cust?.paymentTerms ?? '30 jours fin de mois',
      shippingCost: opts?.quote?.shippingCost ?? 0,
      notes: opts?.quote ? `Suite au devis ${opts.quote.reference}` : '',
      lines: opts?.quote?.lines.length
        ? opts.quote.lines.map((l) => ({
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
    setSoModalOpen(true);
  };

  const handleSeedDemo = async () => {
    if (!activeOrg || !user) return;
    const wh = warehouses[0];
    if (!wh) {
      toast({
        title: 'Entrepôt requis',
        description: 'Créez un entrepôt avant de charger les données commerciales de démonstration.',
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
        actor,
      });
      toast({
        title: 'Données commerciales chargées',
        description: '3 clients, 1 devis et 1 commande client de démonstration ont été créés.',
        variant: 'success',
      });
      await invalidateAll();
    } catch (err) {
      toast({
        title: 'Erreur lors du chargement',
        description: err instanceof Error ? err.message : 'Erreur inconnue',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmitQuote = quoteForm.handleSubmit(async (data) => {
    if (!activeOrg || !user) return;
    const cust = customers.find((c) => c.id === data.customerId);
    const wh = warehouses.find((w) => w.id === data.warehouseId);
    if (!cust || !wh) {
      toast({ title: 'Client ou entrepôt invalide', variant: 'error' });
      return;
    }
    setSubmitting(true);
    try {
      const { reference } = await createQuote({
        orgId: activeOrg.id,
        memberUids,
        input: data,
        products,
        customer: cust,
        warehouse: wh,
        actor,
        sendImmediately: sendQuoteImmediately,
      });
      toast({
        title: sendQuoteImmediately ? 'Devis créé et envoyé' : 'Brouillon de devis enregistré',
        description: `Référence ${reference} pour ${cust.name}.`,
        variant: 'success',
      });
      setQuoteModalOpen(false);
      setActiveTab('quotes');
      await invalidateAll();
    } catch (err) {
      toast({
        title: 'Création impossible',
        description: err instanceof Error ? err.message : 'Erreur inconnue',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  });

  const onSubmitSalesOrder = soForm.handleSubmit(async (data) => {
    if (!activeOrg || !user) return;
    const cust = customers.find((c) => c.id === data.customerId);
    const wh = warehouses.find((w) => w.id === data.warehouseId);
    if (!cust || !wh) {
      toast({ title: 'Client ou entrepôt invalide', variant: 'error' });
      return;
    }
    setSubmitting(true);
    try {
      const { reference } = await createSalesOrder({
        orgId: activeOrg.id,
        memberUids,
        input: data,
        products,
        customer: cust,
        warehouse: wh,
        actor,
        quoteId: sourceQuoteId,
        confirmImmediately,
      });
      toast({
        title: confirmImmediately ? 'Commande client confirmée' : 'Brouillon enregistré',
        description: sourceQuoteId
          ? `Commande ${reference} créée depuis le devis.`
          : `Référence ${reference} — ${cust.name}.`,
        variant: 'success',
      });
      setSoModalOpen(false);
      setSourceQuoteId(undefined);
      setActiveTab('orders');
      await invalidateAll();
    } catch (err) {
      toast({
        title: 'Création impossible',
        description: err instanceof Error ? err.message : 'Erreur inconnue',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  });

  const handleReserveStock = async (order: SalesOrder) => {
    if (!activeOrg || !user) return;
    setSubmitting(true);
    try {
      await reserveSalesOrderStock({
        orgId: activeOrg.id,
        memberUids,
        order,
        balances,
        actor: { uid: user.uid, email: user.email ?? '' },
      });
      toast({
        title: `Stock réservé sur ${order.reference}`,
        description: `Les quantités disponibles dans ${order.warehouseName} ont été allouées atomiquement.`,
        variant: 'success',
      });
      await invalidateAll();
    } catch (err) {
      toast({
        title: 'Réservation impossible',
        description: err instanceof Error ? err.message : 'Erreur inconnue',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmCancelOrder = async () => {
    if (!activeOrg || !user || !cancelOrderTarget) return;
    setSubmitting(true);
    try {
      await cancelSalesOrder({
        orgId: activeOrg.id,
        memberUids,
        order: cancelOrderTarget,
        balances,
        actor: { uid: user.uid, email: user.email ?? '' },
      });
      toast({
        title: `Commande ${cancelOrderTarget.reference} annulée`,
        description: 'Les éventuelles réservations de stock ont été libérées.',
        variant: 'info',
      });
      setCancelOrderTarget(null);
      await invalidateAll();
    } catch (err) {
      toast({
        title: 'Annulation impossible',
        description: err instanceof Error ? err.message : 'Erreur inconnue',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const openShipModal = (order: SalesOrder) => {
    const whLocations = locations.filter(
      (l) => l.warehouseId === order.warehouseId && l.status === 'active'
    );
    if (whLocations.length === 0) {
      toast({
        title: 'Aucun emplacement actif',
        description: `Créez un emplacement actif dans ${order.warehouseName} avant d’expédier.`,
        variant: 'warning',
      });
      return;
    }

    const linesInput: DeliveryInputLine[] = order.lines
      .filter((ol) => ol.quantity - ol.deliveredQty > 0.0001)
      .map((ol) => {
        const remaining = Number((ol.quantity - ol.deliveredQty).toFixed(3));
        const prodBalances = balances
          .filter(
            (b) =>
              b.warehouseId === order.warehouseId &&
              b.productId === ol.productId &&
              b.physicalQty > 0
          )
          .sort((a, b) => b.physicalQty - a.physicalQty);
        const preferredLocId = prodBalances[0]?.locationId ?? whLocations[0].id;
        return {
          productId: ol.productId,
          locationId: preferredLocId,
          deliveredQty: remaining,
        };
      });

    if (linesInput.length === 0) {
      toast({
        title: 'Commande déjà expédiée',
        description: 'Toutes les quantités de cette commande ont déjà été livrées.',
        variant: 'info',
      });
      return;
    }

    setShipOrderTarget(order);
    setDeliveryLines(linesInput);
    setCarrier('');
    setTrackingNumber('');
    setDeliveryNotesText('');
  };

  const handleValidateShipment = async () => {
    if (!activeOrg || !user || !shipOrderTarget) return;
    const wh = warehouses.find((w) => w.id === shipOrderTarget.warehouseId);
    if (!wh) {
      toast({ title: 'Entrepôt introuvable', variant: 'error' });
      return;
    }
    setSubmitting(true);
    try {
      const ref = await shipSalesOrder({
        orgId: activeOrg.id,
        memberUids,
        order: shipOrderTarget,
        warehouse: wh,
        locations,
        linesInput: deliveryLines,
        carrier,
        trackingNumber,
        notes: deliveryNotesText,
        actor,
      });
      toast({
        title: `Bon de livraison ${ref} validé`,
        description:
          'Les sorties de stock (OUT), les réservations et le solde entrepôt ont été mis à jour atomiquement.',
        variant: 'success',
      });
      setShipOrderTarget(null);
      await invalidateAll();
    } catch (err) {
      toast({
        title: 'Expédition impossible',
        description: err instanceof Error ? err.message : 'Erreur inconnue',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const filteredQuotes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return quotes;
    return quotes.filter(
      (item) =>
        item.reference.toLowerCase().includes(q) ||
        item.customerName.toLowerCase().includes(q) ||
        item.warehouseName.toLowerCase().includes(q)
    );
  }, [quotes, search]);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return salesOrders.filter((so) => {
      if (soStatusFilter !== 'ALL' && so.status !== soStatusFilter) return false;
      if (!q) return true;
      return (
        so.reference.toLowerCase().includes(q) ||
        so.customerName.toLowerCase().includes(q) ||
        so.warehouseName.toLowerCase().includes(q)
      );
    });
  }, [salesOrders, search, soStatusFilter]);

  const filteredDeliveries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return deliveryNotes;
    return deliveryNotes.filter(
      (dn) =>
        dn.reference.toLowerCase().includes(q) ||
        dn.salesOrderRef.toLowerCase().includes(q) ||
        dn.customerName.toLowerCase().includes(q) ||
        (dn.trackingNumber ?? '').toLowerCase().includes(q)
    );
  }, [deliveryNotes, search]);

  const shipWarehouseLocations = useMemo(() => {
    if (!shipOrderTarget) return [];
    return locations.filter(
      (l) => l.warehouseId === shipOrderTarget.warehouseId && l.status === 'active'
    );
  }, [shipOrderTarget, locations]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Accueil / Ventes &amp; Expéditions
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Devis, Commandes &amp; Livraisons
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
            onClick={openCreateQuoteModal}
            disabled={customers.length === 0 || products.length === 0}
          >
            <FilePlus2 className="h-4 w-4" />
            <span>Nouveau devis</span>
          </Button>
          <Button
            type="button"
            onClick={() => openCreateSoModal()}
            disabled={customers.length === 0 || products.length === 0}
          >
            <Plus className="h-4 w-4" />
            <span>Nouvelle commande client</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Devis ouverts</span>
            <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <p className="mt-2 font-mono text-xl font-semibold text-slate-900 dark:text-white tabular-nums">
            {kpis.openQuotesCount}
          </p>
          <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {formatCurrency(kpis.openQuotesTtc, currency)} TTC potentiel
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Commandes en cours</span>
            <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="mt-2 font-mono text-xl font-semibold text-slate-900 dark:text-white tabular-nums">
            {kpis.openOrdersCount}
          </p>
          <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {formatCurrency(kpis.openOrdersTtc, currency)} TTC
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Stock réservé</span>
            <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <p className="mt-2 font-mono text-xl font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
            {formatNumber(kpis.reservedUnits)} u.
          </p>
          <p className="mt-1 text-xs text-slate-500">Alloué aux commandes ouvertes</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Bons de livraison</span>
            <Truck className="h-4 w-4 text-slate-400" />
          </div>
          <p className="mt-2 font-mono text-xl font-semibold text-slate-900 dark:text-white tabular-nums">
            {kpis.deliveriesCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">Expéditions tracées (OUT)</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist">
          {(
            [
              { id: 'quotes', label: `Devis (${quotes.length})` },
              { id: 'orders', label: `Commandes clients (${salesOrders.length})` },
              { id: 'deliveries', label: `Bons de livraison (${deliveryNotes.length})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'rounded-lg px-3.5 py-2 text-xs font-medium transition-colors cursor-pointer',
                activeTab === tab.id
                  ? 'bg-slate-900 text-white dark:bg-blue-600'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher référence, client..."
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
          {activeTab === 'orders' && (
            <select
              aria-label="Filtrer par statut"
              value={soStatusFilter}
              onChange={(e) =>
                setSoStatusFilter(e.target.value as 'ALL' | SalesOrder['status'])
              }
              className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value="ALL">Tous statuts</option>
              <option value="draft">Brouillon</option>
              <option value="confirmed">Confirmée</option>
              <option value="preparing">En préparation</option>
              <option value="partially_delivered">Livraison partielle</option>
              <option value="delivered">Livrée</option>
              <option value="invoiced">Facturée</option>
              <option value="closed">Clôturée</option>
              <option value="canceled">Annulée</option>
            </select>
          )}
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} />
      ) : (
        <>
          {activeTab === 'quotes' &&
            (filteredQuotes.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="Aucun devis enregistré"
                description="Créez un devis commercial chiffré avec remises et TVA multi-taux, puis convertissez-le en commande client en un clic."
                action={
                  customers.length === 0 ? (
                    <Button type="button" onClick={() => navigate('/clients')}>
                      Créer un client d’abord
                    </Button>
                  ) : (
                    <Button type="button" onClick={openCreateQuoteModal}>
                      <Plus className="h-4 w-4" />
                      <span>Nouveau devis</span>
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
                        <th className="px-4 py-3 font-medium">Référence</th>
                        <th className="px-4 py-3 font-medium">Client</th>
                        <th className="px-4 py-3 font-medium">Entrepôt</th>
                        <th className="px-4 py-3 font-medium">Validité</th>
                        <th className="px-4 py-3 font-medium text-right">Total TTC</th>
                        <th className="px-4 py-3 font-medium">Statut</th>
                        <th className="px-4 py-3 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredQuotes.map((qt) => {
                        const meta = QUOTE_STATUS_META[qt.status];
                        return (
                          <tr key={qt.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                            <td className="px-4 py-3">
                              <p className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                                {qt.reference}
                              </p>
                              <p className="text-[11px] text-slate-500">
                                {qt.lines.length} ligne(s) · {formatDateShort(qt.createdAt)}
                              </p>
                            </td>
                            <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                              {qt.customerName}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                              {qt.warehouseName}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">
                              {formatDateShort(qt.validUntil)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                              {formatCurrency(qt.totalTtc, currency)}
                            </td>
                            <td className="px-4 py-3">
                              <StatusText tone={meta.tone} label={meta.label} />
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setPrintQuoteTarget(qt)}
                                >
                                  <Printer className="h-3.5 w-3.5" />
                                </Button>
                                {qt.status === 'draft' && activeOrg && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={async () => {
                                      await updateQuoteStatus(activeOrg.id, qt.id, 'sent');
                                      toast({ title: 'Devis marqué envoyé', variant: 'success' });
                                      await invalidateAll();
                                    }}
                                  >
                                    <Send className="h-3.5 w-3.5" />
                                    <span>Envoyer</span>
                                  </Button>
                                )}
                                {(qt.status === 'draft' || qt.status === 'sent') && activeOrg && (
                                  <>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={async () => {
                                        await updateQuoteStatus(activeOrg.id, qt.id, 'accepted');
                                        toast({ title: 'Devis accepté', variant: 'success' });
                                        await invalidateAll();
                                      }}
                                    >
                                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                      <span>Accepter</span>
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      onClick={async () => {
                                        await updateQuoteStatus(activeOrg.id, qt.id, 'rejected');
                                        toast({ title: 'Devis refusé', variant: 'info' });
                                        await invalidateAll();
                                      }}
                                    >
                                      Refuser
                                    </Button>
                                  </>
                                )}
                                {(qt.status === 'sent' || qt.status === 'accepted') && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => openCreateSoModal({ quote: qt })}
                                  >
                                    Convertir en commande
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
            ))}

          {activeTab === 'orders' &&
            (filteredOrders.length === 0 ? (
              <EmptyState
                icon={TrendingUp}
                title="Aucune commande client"
                description="Créez une commande client directement ou convertissez un devis pour réserver votre stock atomiquement et expédier vos bons de livraison."
                action={
                  customers.length === 0 ? (
                    <Button type="button" onClick={() => navigate('/clients')}>
                      Ouvrir les clients
                    </Button>
                  ) : (
                    <Button type="button" onClick={() => openCreateSoModal()}>
                      <Plus className="h-4 w-4" />
                      <span>Nouvelle commande client</span>
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
                        <th className="px-4 py-3 font-medium">Référence</th>
                        <th className="px-4 py-3 font-medium">Client</th>
                        <th className="px-4 py-3 font-medium">Entrepôt</th>
                        <th className="px-4 py-3 font-medium">Livraison &amp; Réservation</th>
                        <th className="px-4 py-3 font-medium text-right">Total TTC</th>
                        <th className="px-4 py-3 font-medium">Statut</th>
                        <th className="px-4 py-3 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredOrders.map((so) => {
                        const meta = SO_STATUS_META[so.status];
                        const orderedSum = so.lines.reduce((a, l) => a + l.quantity, 0);
                        const deliveredSum = so.lines.reduce((a, l) => a + l.deliveredQty, 0);
                        const reservedSum = so.lines.reduce((a, l) => a + l.reservedQty, 0);
                        const needsReservation =
                          so.status !== 'canceled' &&
                          so.status !== 'closed' &&
                          so.lines.some((l) => l.quantity - l.deliveredQty - l.reservedQty > 0.0001);
                        const canShip =
                          so.status !== 'canceled' &&
                          so.status !== 'closed' &&
                          so.status !== 'delivered' &&
                          so.lines.some((l) => l.quantity - l.deliveredQty > 0.0001);
                        const canInvoice =
                          so.status === 'confirmed' ||
                          so.status === 'preparing' ||
                          so.status === 'partially_delivered' ||
                          so.status === 'delivered';
                        const canCancel =
                          so.status === 'draft' ||
                          so.status === 'confirmed' ||
                          so.status === 'preparing';

                        return (
                          <tr key={so.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                            <td className="px-4 py-3">
                              <p className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                                {so.reference}
                              </p>
                              <p className="text-[11px] text-slate-500">
                                {so.lines.length} ligne(s) · {formatDateShort(so.createdAt)}
                              </p>
                            </td>
                            <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                              {so.customerName}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                              {so.warehouseName}
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-mono text-xs text-slate-700 dark:text-slate-200 tabular-nums">
                                {formatNumber(deliveredSum)} / {formatNumber(orderedSum)} expédié
                              </p>
                              <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                                {reservedSum > 0
                                  ? `${formatNumber(reservedSum)} u. réservées`
                                  : so.stockReserved
                                    ? 'Stock réservé'
                                    : 'Non réservée'}
                              </p>
                            </td>
                            <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                              {formatCurrency(so.totalTtc, currency)}
                            </td>
                            <td className="px-4 py-3">
                              <StatusText tone={meta.tone} label={meta.label} />
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setPrintOrderTarget(so)}
                                >
                                  <Printer className="h-3.5 w-3.5" />
                                </Button>
                                {needsReservation && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={submitting}
                                    onClick={() => void handleReserveStock(so)}
                                  >
                                    <Lock className="h-3.5 w-3.5 text-amber-600" />
                                    <span>Réserver stock</span>
                                  </Button>
                                )}
                                {canShip && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => openShipModal(so)}
                                  >
                                    <PackageCheck className="h-3.5 w-3.5" />
                                    <span>Expédier / BL</span>
                                  </Button>
                                )}
                                {canInvoice && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => navigate(`/facturation?orderId=${so.id}`)}
                                  >
                                    Facturer
                                  </Button>
                                )}
                                {canCancel && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setCancelOrderTarget(so)}
                                  >
                                    <XCircle className="h-3.5 w-3.5 text-red-500" />
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
            ))}

          {activeTab === 'deliveries' &&
            (filteredDeliveries.length === 0 ? (
              <EmptyState
                icon={Truck}
                title="Aucun bon de livraison"
                description="Expédiez une commande client depuis l’onglet Commandes pour générer un bon de livraison et déduire le stock automatiquement."
              />
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50/80 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
                      <tr>
                        <th className="px-4 py-3 font-medium">Référence BL</th>
                        <th className="px-4 py-3 font-medium">Commande / Client</th>
                        <th className="px-4 py-3 font-medium">Entrepôt</th>
                        <th className="px-4 py-3 font-medium">Transporteur / Suivi</th>
                        <th className="px-4 py-3 font-medium text-right">Qté expédiée</th>
                        <th className="px-4 py-3 font-medium">Date</th>
                        <th className="px-4 py-3 font-medium text-right">Détail</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredDeliveries.map((dn) => {
                        const qtySum = dn.lines.reduce((a, l) => a + l.deliveredQty, 0);
                        return (
                          <tr key={dn.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                            <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                              {dn.reference}
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-medium text-slate-900 dark:text-slate-100">
                                {dn.customerName}
                              </p>
                              <p className="font-mono text-xs text-slate-500">{dn.salesOrderRef}</p>
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                              {dn.warehouseName}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
                              {dn.carrier || '—'}
                              {dn.trackingNumber ? ` · ${dn.trackingNumber}` : ''}
                            </td>
                            <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                              {formatNumber(qtySum)}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-slate-500">
                              {formatDateTime(dn.createdAt)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setDeliveryDetailTarget(dn)}
                              >
                                <Eye className="h-3.5 w-3.5" />
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

      {/* Create Quote Modal */}
      <Modal
        open={quoteModalOpen}
        onClose={() => setQuoteModalOpen(false)}
        title="Nouveau devis client"
        subtitle="Chiffrage commercial HT/TVA/TTC convertible en commande client"
        size="xl"
      >
        <form onSubmit={onSubmitQuote} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Client *
              </label>
              <select
                {...quoteForm.register('customerId')}
                onChange={(e) => {
                  quoteForm.setValue('customerId', e.target.value);
                  const c = customers.find((item) => item.id === e.target.value);
                  if (c) quoteForm.setValue('paymentTerms', c.paymentTerms);
                }}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name} ({c.type})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Entrepôt d’expédition *
              </label>
              <select
                {...quoteForm.register('warehouseId')}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Valable jusqu’au *
              </label>
              <input
                type="date"
                {...quoteForm.register('validUntil')}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Conditions de règlement
              </label>
              <input
                type="text"
                {...quoteForm.register('paymentTerms')}
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
                {...quoteForm.register('shippingCost')}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Lignes du devis
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  const p = products.find((item) => item.status === 'active') ?? products[0];
                  quoteLinesField.append({
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
              {quoteLinesField.fields.map((field, idx) => (
                <div key={field.id} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-12 sm:col-span-5">
                    <label className="block text-[11px] text-slate-500">Produit</label>
                    <select
                      {...quoteForm.register(`lines.${idx}.productId`)}
                      onChange={(e) => {
                        quoteForm.setValue(`lines.${idx}.productId`, e.target.value);
                        const prod = products.find((p) => p.id === e.target.value);
                        if (prod) {
                          quoteForm.setValue(`lines.${idx}.unitPrice`, prod.salePrice);
                          quoteForm.setValue(`lines.${idx}.vatRate`, prod.vatRate);
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
                      {...quoteForm.register(`lines.${idx}.quantity`)}
                      className="mt-0.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                  <div className="col-span-3 sm:col-span-2">
                    <label className="block text-[11px] text-slate-500">PU HT</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      {...quoteForm.register(`lines.${idx}.unitPrice`)}
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
                      {...quoteForm.register(`lines.${idx}.discountPct`)}
                      className="mt-0.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-[11px] text-slate-500">TVA%</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      {...quoteForm.register(`lines.${idx}.vatRate`)}
                      className="mt-0.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    {quoteLinesField.fields.length > 1 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => quoteLinesField.remove(idx)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3 text-xs dark:bg-slate-800/60">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={sendQuoteImmediately}
                onChange={(e) => setSendQuoteImmediately(e.target.checked)}
                className="rounded border-slate-300 text-blue-600"
              />
              <span className="font-medium text-slate-700 dark:text-slate-200">
                Marquer directement comme « Envoyé au client »
              </span>
            </label>
            <div className="flex items-center gap-4 font-mono tabular-nums">
              <span className="text-slate-500">
                HT : {formatCurrency(quotePreviewTotals.subtotalHt, currency)}
              </span>
              <span className="text-slate-500">
                TVA : {formatCurrency(quotePreviewTotals.vatTotal, currency)}
              </span>
              <span className="text-sm font-bold text-slate-900 dark:text-white">
                TTC : {formatCurrency(quotePreviewTotals.totalTtc, currency)}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Notes commerciales
            </label>
            <textarea
              rows={2}
              {...quoteForm.register('notes')}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div className="flex justify-end gap-2.5 border-t border-slate-100 pt-4 dark:border-slate-800">
            <Button type="button" variant="outline" onClick={() => setQuoteModalOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={submitting}>
              {sendQuoteImmediately ? 'Enregistrer & envoyer' : 'Enregistrer brouillon'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Create Sales Order Modal */}
      <Modal
        open={soModalOpen}
        onClose={() => setSoModalOpen(false)}
        title={sourceQuoteId ? 'Convertir le devis en commande client' : 'Nouvelle commande client'}
        subtitle="La réservation de stock et les expéditions se gèrent de manière atomique après création"
        size="xl"
      >
        <form onSubmit={onSubmitSalesOrder} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Client *
              </label>
              <select
                {...soForm.register('customerId')}
                onChange={(e) => {
                  soForm.setValue('customerId', e.target.value);
                  const c = customers.find((item) => item.id === e.target.value);
                  if (c) soForm.setValue('paymentTerms', c.paymentTerms);
                }}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name} ({c.type})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Entrepôt d’expédition *
              </label>
              <select
                {...soForm.register('warehouseId')}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Livraison souhaitée
              </label>
              <input
                type="date"
                {...soForm.register('expectedDeliveryDate')}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Conditions de règlement
              </label>
              <input
                type="text"
                {...soForm.register('paymentTerms')}
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
                {...soForm.register('shippingCost')}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Lignes de commande
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  const p = products.find((item) => item.status === 'active') ?? products[0];
                  soLinesField.append({
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
              {soLinesField.fields.map((field, idx) => (
                <div key={field.id} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-12 sm:col-span-5">
                    <label className="block text-[11px] text-slate-500">Produit</label>
                    <select
                      {...soForm.register(`lines.${idx}.productId`)}
                      onChange={(e) => {
                        soForm.setValue(`lines.${idx}.productId`, e.target.value);
                        const prod = products.find((p) => p.id === e.target.value);
                        if (prod) {
                          soForm.setValue(`lines.${idx}.unitPrice`, prod.salePrice);
                          soForm.setValue(`lines.${idx}.vatRate`, prod.vatRate);
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
                      {...soForm.register(`lines.${idx}.quantity`)}
                      className="mt-0.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                  <div className="col-span-3 sm:col-span-2">
                    <label className="block text-[11px] text-slate-500">PU HT</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      {...soForm.register(`lines.${idx}.unitPrice`)}
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
                      {...soForm.register(`lines.${idx}.discountPct`)}
                      className="mt-0.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-[11px] text-slate-500">TVA%</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      {...soForm.register(`lines.${idx}.vatRate`)}
                      className="mt-0.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    {soLinesField.fields.length > 1 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => soLinesField.remove(idx)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3 text-xs dark:bg-slate-800/60">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmImmediately}
                onChange={(e) => setConfirmImmediately(e.target.checked)}
                className="rounded border-slate-300 text-blue-600"
              />
              <span className="font-medium text-slate-700 dark:text-slate-200">
                Confirmer immédiatement la commande client
              </span>
            </label>
            <div className="flex items-center gap-4 font-mono tabular-nums">
              <span className="text-slate-500">
                HT : {formatCurrency(soPreviewTotals.subtotalHt, currency)}
              </span>
              <span className="text-slate-500">
                TVA : {formatCurrency(soPreviewTotals.vatTotal, currency)}
              </span>
              <span className="text-sm font-bold text-slate-900 dark:text-white">
                TTC : {formatCurrency(soPreviewTotals.totalTtc, currency)}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Instructions de livraison / notes
            </label>
            <textarea
              rows={2}
              {...soForm.register('notes')}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div className="flex justify-end gap-2.5 border-t border-slate-100 pt-4 dark:border-slate-800">
            <Button type="button" variant="outline" onClick={() => setSoModalOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={submitting}>
              {confirmImmediately ? 'Créer & confirmer' : 'Enregistrer brouillon'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Ship Sales Order -> Delivery Note Modal */}
      <Modal
        open={!!shipOrderTarget}
        onClose={() => setShipOrderTarget(null)}
        title={
          shipOrderTarget ? `Expédition & Bon de livraison — ${shipOrderTarget.reference}` : ''
        }
        subtitle={
          shipOrderTarget
            ? `Client : ${shipOrderTarget.customerName} · Entrepôt : ${shipOrderTarget.warehouseName}`
            : ''
        }
        size="xl"
      >
        {shipOrderTarget && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Transporteur
                </label>
                <input
                  type="text"
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                  placeholder="Chronopost, DPD, Transport interne..."
                  className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  N° de suivi (Tracking)
                </label>
                <input
                  type="text"
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  placeholder="TRK-..."
                  className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50/80 text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">Produit</th>
                    <th className="px-3 py-2.5 font-medium">Emplacement source</th>
                    <th className="px-3 py-2.5 font-medium text-right">Reliquat</th>
                    <th className="px-3 py-2.5 font-medium text-right">Qté à expédier</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {deliveryLines.map((dl, idx) => {
                    const orderLine = shipOrderTarget.lines.find(
                      (ol) => ol.productId === dl.productId
                    );
                    if (!orderLine) return null;
                    const remaining = Number(
                      (orderLine.quantity - orderLine.deliveredQty).toFixed(3)
                    );
                    return (
                      <tr key={dl.productId}>
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-slate-900 dark:text-slate-100">
                            {orderLine.productName}
                          </p>
                          <p className="font-mono text-slate-500">{orderLine.productSku}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          <select
                            value={dl.locationId}
                            onChange={(e) =>
                              setDeliveryLines((prev) =>
                                prev.map((item, i) =>
                                  i === idx ? { ...item, locationId: e.target.value } : item
                                )
                              )
                            }
                            className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                          >
                            {shipWarehouseLocations.map((loc) => {
                              const bal = balances.find(
                                (b) =>
                                  b.warehouseId === shipOrderTarget.warehouseId &&
                                  b.locationId === loc.id &&
                                  b.productId === dl.productId
                              );
                              return (
                                <option key={loc.id} value={loc.id}>
                                  {loc.code} (physique : {formatNumber(bal?.physicalQty ?? 0)})
                                </option>
                              );
                            })}
                          </select>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                          {formatNumber(remaining)} {orderLine.unit}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <input
                            type="number"
                            step="any"
                            min="0"
                            max={remaining}
                            value={dl.deliveredQty}
                            onChange={(e) => {
                              const val = Math.max(0, Math.min(remaining, Number(e.target.value)));
                              setDeliveryLines((prev) =>
                                prev.map((item, i) =>
                                  i === idx ? { ...item, deliveredQty: val } : item
                                )
                              );
                            }}
                            className="h-8 w-24 rounded-lg border border-slate-200 bg-white px-2 text-right font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Observations bon de livraison
              </label>
              <input
                type="text"
                value={deliveryNotesText}
                onChange={(e) => setDeliveryNotesText(e.target.value)}
                placeholder="Colis scellé, remis au chauffeur..."
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>

            <div className="flex justify-end gap-2.5 border-t border-slate-100 pt-4 dark:border-slate-800">
              <Button type="button" variant="outline" onClick={() => setShipOrderTarget(null)}>
                Annuler
              </Button>
              <Button
                type="button"
                disabled={submitting}
                onClick={() => void handleValidateShipment()}
              >
                <ClipboardCheck className="h-4 w-4" />
                <span>Valider l’expédition &amp; sortie stock (OUT)</span>
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Delivery Note Detail Modal */}
      <Modal
        open={!!deliveryDetailTarget}
        onClose={() => setDeliveryDetailTarget(null)}
        title={deliveryDetailTarget ? `Bon de livraison ${deliveryDetailTarget.reference}` : ''}
        subtitle={
          deliveryDetailTarget
            ? `${deliveryDetailTarget.customerName} · Commande ${deliveryDetailTarget.salesOrderRef}`
            : ''
        }
        size="lg"
      >
        {deliveryDetailTarget && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800/50">
              <div>
                <p className="text-slate-500">Entrepôt source</p>
                <p className="font-medium text-slate-900 dark:text-slate-100">
                  {deliveryDetailTarget.warehouseName}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Transporteur / Suivi</p>
                <p className="font-medium text-slate-900 dark:text-slate-100">
                  {deliveryDetailTarget.carrier || '—'}{' '}
                  {deliveryDetailTarget.trackingNumber
                    ? `(${deliveryDetailTarget.trackingNumber})`
                    : ''}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Validé par</p>
                <p className="font-medium text-slate-900 dark:text-slate-100">
                  {deliveryDetailTarget.deliveredByName} ·{' '}
                  {formatDateTime(deliveryDetailTarget.createdAt)}
                </p>
              </div>
            </div>

            <table className="w-full text-left text-xs border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
              <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900">
                <tr>
                  <th className="px-3 py-2 font-medium">Produit</th>
                  <th className="px-3 py-2 font-medium">Emplacement</th>
                  <th className="px-3 py-2 font-medium text-right">Qté expédiée</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {deliveryDetailTarget.lines.map((l) => (
                  <tr key={`${l.productId}-${l.locationId}`}>
                    <td className="px-3 py-2">
                      <span className="font-medium">{l.productName}</span>
                      <span className="ml-2 font-mono text-slate-500">{l.productSku}</span>
                    </td>
                    <td className="px-3 py-2 font-mono">{l.locationCode}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                      {formatNumber(l.deliveredQty)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex justify-between items-center pt-2">
              <Link
                to="/stocks"
                className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                Consulter les mouvements OUT dans Stocks
              </Link>
              <Button type="button" variant="outline" onClick={() => setDeliveryDetailTarget(null)}>
                Fermer
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Printable Quote Preview */}
      <Modal
        open={!!printQuoteTarget}
        onClose={() => setPrintQuoteTarget(null)}
        title={printQuoteTarget ? `Aperçu devis — ${printQuoteTarget.reference}` : ''}
        size="xl"
      >
        {printQuoteTarget && (
          <div className="space-y-5 text-sm">
            <div className="flex justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <p className="font-display text-lg font-bold text-slate-900 dark:text-white">
                  {activeOrg?.name}
                </p>
                {activeOrg?.siret && (
                  <p className="font-mono text-xs text-slate-500">SIRET : {activeOrg.siret}</p>
                )}
                {activeOrg?.vatNumber && (
                  <p className="font-mono text-xs text-slate-500">TVA : {activeOrg.vatNumber}</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wider text-slate-500">Devis commercial</p>
                <p className="font-mono text-base font-bold text-slate-900 dark:text-white">
                  {printQuoteTarget.reference}
                </p>
                <p className="text-xs text-slate-500">
                  Valable jusqu’au {formatDateShort(printQuoteTarget.validUntil)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <p className="text-slate-500">Client</p>
                <p className="font-semibold text-slate-900 dark:text-white">
                  {printQuoteTarget.customerName}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Entrepôt &amp; conditions</p>
                <p className="font-medium text-slate-800 dark:text-slate-200">
                  {printQuoteTarget.warehouseName} · {printQuoteTarget.paymentTerms || '—'}
                </p>
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
                {printQuoteTarget.lines.map((l, idx) => {
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
              </tbody>
            </table>

            <div className="flex justify-end">
              <div className="w-64 space-y-1 text-xs font-mono tabular-nums">
                <div className="flex justify-between">
                  <span className="text-slate-500">Total HT :</span>
                  <span>{formatCurrency(printQuoteTarget.subtotalHt, currency)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Total TVA :</span>
                  <span>{formatCurrency(printQuoteTarget.vatTotal, currency)}</span>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-1 text-sm font-bold dark:border-slate-800">
                  <span>Total TTC :</span>
                  <span>{formatCurrency(printQuoteTarget.totalTtc, currency)}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 print:hidden">
              <Button type="button" variant="outline" onClick={() => setPrintQuoteTarget(null)}>
                Fermer
              </Button>
              <Button type="button" onClick={() => window.print()}>
                <Printer className="h-4 w-4" />
                <span>Imprimer / PDF</span>
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Printable Sales Order Preview */}
      <Modal
        open={!!printOrderTarget}
        onClose={() => setPrintOrderTarget(null)}
        title={printOrderTarget ? `Bon de commande client — ${printOrderTarget.reference}` : ''}
        size="xl"
      >
        {printOrderTarget && (
          <div className="space-y-5 text-sm">
            <div className="flex justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <p className="font-display text-lg font-bold text-slate-900 dark:text-white">
                  {activeOrg?.name}
                </p>
                {activeOrg?.siret && (
                  <p className="font-mono text-xs text-slate-500">SIRET : {activeOrg.siret}</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wider text-slate-500">Commande client</p>
                <p className="font-mono text-base font-bold text-slate-900 dark:text-white">
                  {printOrderTarget.reference}
                </p>
                <p className="text-xs text-slate-500">
                  Émise le {formatDateShort(printOrderTarget.createdAt)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <p className="text-slate-500">Client</p>
                <p className="font-semibold text-slate-900 dark:text-white">
                  {printOrderTarget.customerName}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Entrepôt &amp; livraison</p>
                <p className="font-medium text-slate-800 dark:text-slate-200">
                  {printOrderTarget.warehouseName} · Prévue{' '}
                  {formatDateShort(printOrderTarget.expectedDeliveryDate)}
                </p>
              </div>
            </div>

            <table className="w-full text-left text-xs border border-slate-200 dark:border-slate-800">
              <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900">
                <tr>
                  <th className="px-3 py-2 font-medium">Réf. / Désignation</th>
                  <th className="px-3 py-2 font-medium text-right">Commandé</th>
                  <th className="px-3 py-2 font-medium text-right">Livré</th>
                  <th className="px-3 py-2 font-medium text-right">PU HT</th>
                  <th className="px-3 py-2 font-medium text-right">Total HT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {printOrderTarget.lines.map((l, idx) => {
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
                        {formatNumber(l.deliveredQty)} {l.unit}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {formatCurrency(l.unitPrice, currency)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                        {formatCurrency(lineHt, currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="flex justify-end">
              <div className="w-64 space-y-1 text-xs font-mono tabular-nums">
                <div className="flex justify-between">
                  <span className="text-slate-500">Total HT :</span>
                  <span>{formatCurrency(printOrderTarget.subtotalHt, currency)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Total TVA :</span>
                  <span>{formatCurrency(printOrderTarget.vatTotal, currency)}</span>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-1 text-sm font-bold dark:border-slate-800">
                  <span>Total TTC :</span>
                  <span>{formatCurrency(printOrderTarget.totalTtc, currency)}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 print:hidden">
              <Button type="button" variant="outline" onClick={() => setPrintOrderTarget(null)}>
                Fermer
              </Button>
              <Button type="button" onClick={() => window.print()}>
                <Printer className="h-4 w-4" />
                <span>Imprimer / PDF</span>
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!cancelOrderTarget}
        onClose={() => setCancelOrderTarget(null)}
        onConfirm={() => void handleConfirmCancelOrder()}
        title="Annuler la commande client"
        description={
          cancelOrderTarget
            ? `Confirmez-vous l’annulation de la commande ${cancelOrderTarget.reference} ? Les éventuelles réservations de stock seront automatiquement libérées.`
            : ''
        }
        confirmLabel="Annuler la commande"
        loading={submitting}
      />
    </div>
  );
}
