import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  Eye,
  FileText,
  PackageCheck,
  Plus,
  Printer,
  Scale,
  Search,
  ShoppingCart,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useToast } from '../contexts/ToastContext.tsx';
import { useErpData } from '../hooks/useErpData.ts';
import {
  addRfqOfferToRequest,
  computeOrderTotals,
  createPurchaseOrder,
  createPurchaseRequest,
  createSupplierInvoice,
  recordSupplierInvoicePayment,
  seedPurchasingDemoData,
  updatePurchaseOrderStatus,
  updatePurchaseRequest,
  validateGoodsReceipt,
  type ReceiptInputLine,
} from '../services/purchasingService.ts';
import {
  purchaseOrderSchema,
  purchaseRequestSchema,
  supplierInvoiceSchema,
  type PurchaseOrderInput,
  type PurchaseRequestInput,
  type SupplierInvoiceInput,
} from '../shared/schemas.ts';
import {
  formatCurrency,
  formatDateShort,
  formatDateTime,
  formatNumber,
} from '../shared/formatters.ts';
import type {
  InspectionStatus,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseRequest,
  SupplierInvoice,
} from '../shared/types.ts';
import { Button } from '../components/ui/Button.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { ConfirmDialog } from '../components/ui/ConfirmDialog.tsx';
import { TableSkeleton } from '../components/ui/Skeleton.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { StatusText, type SemanticTone } from '../components/ui/StatusText.tsx';
import { cn } from '../lib/cn.ts';

type PurchasingTab = 'requests' | 'orders' | 'receipts' | 'invoices';

const PO_STATUS_META: Record<PurchaseOrder['status'], { label: string; tone: SemanticTone }> = {
  draft: { label: 'Brouillon', tone: 'neutral' },
  confirmed: { label: 'Confirmée', tone: 'info' },
  partially_received: { label: 'Réception partielle', tone: 'warning' },
  received: { label: 'Réceptionnée', tone: 'success' },
  invoiced: { label: 'Facturée', tone: 'info' },
  closed: { label: 'Clôturée', tone: 'success' },
  canceled: { label: 'Annulée', tone: 'error' },
};

const PR_STATUS_META: Record<PurchaseRequest['status'], { label: string; tone: SemanticTone }> = {
  draft: { label: 'Brouillon', tone: 'neutral' },
  pending_approval: { label: 'À approuver', tone: 'warning' },
  approved: { label: 'Approuvée', tone: 'success' },
  rfq_sent: { label: 'Consultation RFQ', tone: 'info' },
  converted: { label: 'Convertie en CF', tone: 'success' },
  rejected: { label: 'Rejetée', tone: 'error' },
};

const INSPECTION_META: Record<InspectionStatus, { label: string; tone: SemanticTone }> = {
  passed: { label: 'Conforme', tone: 'success' },
  partial_issue: { label: 'Réserve partielle', tone: 'warning' },
  rejected: { label: 'Non conforme', tone: 'error' },
};

const INVOICE_STATUS_META: Record<
  SupplierInvoice['status'],
  { label: string; tone: SemanticTone }
> = {
  pending: { label: 'À payer', tone: 'warning' },
  partially_paid: { label: 'Partiel', tone: 'info' },
  paid: { label: 'Soldée', tone: 'success' },
};

export function PurchasingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, activeOrg } = useAuth();
  const { toast } = useToast();
  const {
    products,
    warehouses,
    locations,
    balances,
    suppliers,
    purchaseRequests,
    purchaseOrders,
    goodsReceipts,
    supplierInvoices,
    isLoading,
    invalidateAll,
  } = useErpData();

  const initialTabParam = searchParams.get('tab') as PurchasingTab | null;
  const [activeTab, setActiveTab] = useState<PurchasingTab>(
    initialTabParam && ['requests', 'orders', 'receipts', 'invoices'].includes(initialTabParam)
      ? initialTabParam
      : 'orders'
  );
  const [search, setSearch] = useState('');
  const [poStatusFilter, setPoStatusFilter] = useState<'ALL' | PurchaseOrder['status']>('ALL');
  const [submitting, setSubmitting] = useState(false);

  // Modals
  const [prModalOpen, setPrModalOpen] = useState(false);
  const [rfqTarget, setRfqTarget] = useState<PurchaseRequest | null>(null);
  const [poModalOpen, setPoModalOpen] = useState(false);
  const [sourceRequestIdForPo, setSourceRequestIdForPo] = useState<string | undefined>(undefined);
  const [confirmImmediately, setConfirmImmediately] = useState(true);
  const [cancelOrderTarget, setCancelOrderTarget] = useState<PurchaseOrder | null>(null);
  const [printOrderTarget, setPrintOrderTarget] = useState<PurchaseOrder | null>(null);

  // Receipt Modal state
  const [receiptOrderTarget, setReceiptOrderTarget] = useState<PurchaseOrder | null>(null);
  const [receiptLines, setReceiptLines] = useState<ReceiptInputLine[]>([]);
  const [receiptInspection, setReceiptInspection] = useState<InspectionStatus>('passed');
  const [receiptDeliveryNote, setReceiptDeliveryNote] = useState('');
  const [receiptNotes, setReceiptNotes] = useState('');
  const [receiptDetailTarget, setReceiptDetailTarget] = useState<(typeof goodsReceipts)[number] | null>(
    null
  );

  // RFQ Offer form state
  const [rfqSupplierId, setRfqSupplierId] = useState('');
  const [rfqTotalHt, setRfqTotalHt] = useState<number>(0);
  const [rfqLeadTime, setRfqLeadTime] = useState<number>(5);
  const [rfqValidUntil, setRfqValidUntil] = useState<string>(
    new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10)
  );
  const [rfqNotes, setRfqNotes] = useState('');

  // Invoice & Payment Modals
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [paymentInvoiceTarget, setPaymentInvoiceTarget] = useState<SupplierInvoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);

  const currency = activeOrg?.currency ?? 'EUR';
  const memberUids = activeOrg?.memberUids ?? (user ? [user.uid] : []);
  const actor = {
    uid: user?.uid ?? '',
    email: user?.email ?? '',
    displayName: user?.displayName || user?.email || 'Utilisateur',
  };

  // Forms
  const prForm = useForm<PurchaseRequestInput>({
    resolver: zodResolver(purchaseRequestSchema) as never,
    defaultValues: {
      title: '',
      warehouseId: warehouses[0]?.id ?? '',
      priority: 'normal',
      notes: '',
      lines: [{ productId: '', quantity: 10, estimatedUnitCost: 0 }],
    },
  });
  const prLinesField = useFieldArray({ control: prForm.control, name: 'lines' });

  const poForm = useForm<PurchaseOrderInput>({
    resolver: zodResolver(purchaseOrderSchema) as never,
    defaultValues: {
      supplierId: '',
      warehouseId: warehouses[0]?.id ?? '',
      expectedDate: new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10),
      paymentTerms: '30 jours fin de mois',
      shippingCost: 0,
      notes: '',
      lines: [{ productId: '', quantity: 10, unitPrice: 0, discountPct: 0, vatRate: 20 }],
    },
  });
  const poLinesField = useFieldArray({ control: poForm.control, name: 'lines' });

  const invoiceForm = useForm<SupplierInvoiceInput>({
    resolver: zodResolver(supplierInvoiceSchema) as never,
    defaultValues: {
      invoiceNumber: '',
      purchaseOrderId: '',
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
      totalHt: 0,
      totalVat: 0,
      totalTtc: 0,
      notes: '',
    },
  });

  // Handle ?supplierId= shortcut from SuppliersPage
  useEffect(() => {
    const supId = searchParams.get('supplierId');
    if (supId && suppliers.length > 0) {
      const sup = suppliers.find((s) => s.id === supId);
      if (sup) {
        setActiveTab('orders');
        openCreatePoModal({ supplierId: sup.id });
        searchParams.delete('supplierId');
        setSearchParams(searchParams, { replace: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, suppliers]);

  // Low-stock / Out-of-stock replenishment candidates
  const replenishmentNeeds = useMemo(() => {
    const qtyByProd = new Map<string, number>();
    for (const b of balances) {
      qtyByProd.set(b.productId, (qtyByProd.get(b.productId) ?? 0) + b.availableQty);
    }
    return products
      .filter((p) => p.status === 'active')
      .map((p) => {
        const available = qtyByProd.get(p.id) ?? 0;
        const suggestedQty = Math.max(1, p.maxStock - available);
        return { product: p, available, suggestedQty };
      })
      .filter((item) => item.available <= item.product.minStock)
      .sort((a, b) => a.available - b.available);
  }, [products, balances]);

  // KPIs
  const kpis = useMemo(() => {
    const openOrders = purchaseOrders.filter(
      (po) => po.status === 'confirmed' || po.status === 'partially_received'
    );
    const committedTtc = openOrders.reduce((acc, po) => acc + po.totalTtc, 0);
    const unpaidInvoices = supplierInvoices.filter((inv) => inv.status !== 'paid');
    const unpaidTtc = unpaidInvoices.reduce(
      (acc, inv) => acc + Math.max(0, inv.totalTtc - inv.paidAmount),
      0
    );
    return {
      openOrderCount: openOrders.length,
      committedTtc,
      receiptCount: goodsReceipts.length,
      unpaidTtc,
      unpaidInvoiceCount: unpaidInvoices.length,
    };
  }, [purchaseOrders, goodsReceipts, supplierInvoices]);

  // Watch PO form for live totals
  const watchedPoLines = poForm.watch('lines');
  const watchedShipping = poForm.watch('shippingCost');
  const poPreviewTotals = useMemo(() => {
    const normalized: PurchaseOrderLine[] = (watchedPoLines ?? []).map((l) => ({
      productId: l.productId || '',
      productSku: '',
      productName: '',
      unit: '',
      quantity: Number(l.quantity || 0),
      receivedQty: 0,
      unitPrice: Number(l.unitPrice || 0),
      discountPct: Number(l.discountPct || 0),
      vatRate: Number(l.vatRate || 0),
    }));
    return computeOrderTotals(normalized, Number(watchedShipping || 0));
  }, [watchedPoLines, watchedShipping]);

  const openCreatePrModal = (prefillProduct?: { productId: string; quantity: number }) => {
    const p = prefillProduct
      ? products.find((item) => item.id === prefillProduct.productId)
      : products[0];
    prForm.reset({
      title: prefillProduct && p ? `Réapprovisionnement ${p.sku} — ${p.name}` : '',
      warehouseId: warehouses[0]?.id ?? '',
      priority: prefillProduct ? 'urgent' : 'normal',
      notes: '',
      lines: [
        {
          productId: p?.id ?? '',
          quantity: prefillProduct?.quantity ?? 10,
          estimatedUnitCost: p?.purchasePrice ?? 0,
        },
      ],
    });
    setPrModalOpen(true);
  };

  const openCreatePoModal = (opts?: {
    supplierId?: string;
    warehouseId?: string;
    sourceRequestId?: string;
    lines?: Array<{
      productId: string;
      quantity: number;
      unitPrice: number;
      discountPct?: number;
      vatRate?: number;
    }>;
    notes?: string;
  }) => {
    const sup =
      suppliers.find((s) => s.id === opts?.supplierId) ??
      suppliers.find((s) => s.status === 'active') ??
      suppliers[0];
    const leadDays = sup?.leadTimeDays ?? 5;
    const expected = new Date(Date.now() + leadDays * 86400_000).toISOString().slice(0, 10);
    const defaultProd = products[0];

    setSourceRequestIdForPo(opts?.sourceRequestId);
    setConfirmImmediately(true);
    poForm.reset({
      supplierId: sup?.id ?? '',
      warehouseId: opts?.warehouseId ?? warehouses[0]?.id ?? '',
      expectedDate: expected,
      paymentTerms: sup?.paymentTerms ?? '30 jours fin de mois',
      shippingCost: 0,
      notes: opts?.notes ?? '',
      lines: opts?.lines?.length
        ? opts.lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountPct: l.discountPct ?? 0,
            vatRate: l.vatRate ?? 20,
          }))
        : [
            {
              productId: defaultProd?.id ?? '',
              quantity: 10,
              unitPrice: defaultProd?.purchasePrice ?? 0,
              discountPct: 0,
              vatRate: defaultProd?.vatRate ?? 20,
            },
          ],
    });
    setPoModalOpen(true);
  };

  const handleSeedDemo = async () => {
    if (!activeOrg || !user) return;
    const wh = warehouses[0];
    if (!wh) {
      toast({
        title: 'Entrepôt requis',
        description: 'Créez un entrepôt avant de charger les données achats de démonstration.',
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
        warehouse: wh,
        actor,
      });
      toast({
        title: 'Données achats de démonstration ajoutées',
        description: '3 fournisseurs et 1 commande fournisseur confirmée ont été créés.',
        variant: 'success',
      });
      await invalidateAll();
    } catch (err) {
      toast({
        title: 'Erreur lors de l’initialisation',
        description: err instanceof Error ? err.message : 'Erreur inconnue',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Submit PR
  const onSubmitPr = prForm.handleSubmit(async (data) => {
    if (!activeOrg || !user) return;
    const wh = warehouses.find((w) => w.id === data.warehouseId);
    if (!wh) {
      toast({ title: 'Entrepôt introuvable', variant: 'error' });
      return;
    }
    setSubmitting(true);
    try {
      const ref = await createPurchaseRequest({
        orgId: activeOrg.id,
        memberUids,
        input: data,
        products,
        warehouse: wh,
        actor,
      });
      toast({
        title: 'Demande d’achat créée',
        description: `Référence ${ref} enregistrée.`,
        variant: 'success',
      });
      setPrModalOpen(false);
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

  // Submit PO
  const onSubmitPo = poForm.handleSubmit(async (data) => {
    if (!activeOrg || !user) return;
    const sup = suppliers.find((s) => s.id === data.supplierId);
    const wh = warehouses.find((w) => w.id === data.warehouseId);
    if (!sup || !wh) {
      toast({ title: 'Fournisseur ou entrepôt invalide', variant: 'error' });
      return;
    }
    setSubmitting(true);
    try {
      const { reference } = await createPurchaseOrder({
        orgId: activeOrg.id,
        memberUids,
        input: data,
        products,
        supplier: sup,
        warehouse: wh,
        actor,
        sourceRequestId: sourceRequestIdForPo,
        confirmImmediately,
      });
      toast({
        title: confirmImmediately ? 'Commande confirmée' : 'Brouillon de commande enregistré',
        description: `Référence ${reference} — ${sup.name}. Aucun stock ne sera créé avant réception validée.`,
        variant: 'success',
      });
      setPoModalOpen(false);
      setSourceRequestIdForPo(undefined);
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

  // Open Receipt Modal for a PO
  const openReceiptModal = (po: PurchaseOrder) => {
    const whLocations = locations.filter(
      (l) => l.warehouseId === po.warehouseId && l.status === 'active'
    );
    if (whLocations.length === 0) {
      toast({
        title: 'Aucun emplacement actif',
        description: `Veuillez créer au moins un emplacement actif dans l’entrepôt ${po.warehouseName} avant de réceptionner.`,
        variant: 'warning',
      });
      return;
    }
    const preferredLoc =
      whLocations.find((l) => l.zoneType === 'receiving') ??
      whLocations.find((l) => l.zoneType === 'storage') ??
      whLocations[0];

    const initialLines: ReceiptInputLine[] = po.lines
      .filter((ol) => ol.quantity - ol.receivedQty > 0.0001)
      .map((ol) => {
        const remaining = Number((ol.quantity - ol.receivedQty).toFixed(3));
        return {
          productId: ol.productId,
          locationId: preferredLoc.id,
          receivedQty: remaining,
          acceptedQty: remaining,
          rejectedQty: 0,
        };
      });

    if (initialLines.length === 0) {
      toast({
        title: 'Commande déjà réceptionnée',
        description: 'Tous les articles de cette commande ont déjà été réceptionnés.',
        variant: 'info',
      });
      return;
    }

    setReceiptOrderTarget(po);
    setReceiptLines(initialLines);
    setReceiptInspection('passed');
    setReceiptDeliveryNote('');
    setReceiptNotes('');
  };

  const handleValidateReceipt = async () => {
    if (!activeOrg || !user || !receiptOrderTarget) return;
    const wh = warehouses.find((w) => w.id === receiptOrderTarget.warehouseId);
    if (!wh) {
      toast({ title: 'Entrepôt de destination introuvable', variant: 'error' });
      return;
    }
    setSubmitting(true);
    try {
      const ref = await validateGoodsReceipt({
        orgId: activeOrg.id,
        memberUids,
        order: receiptOrderTarget,
        warehouse: wh,
        locations,
        linesInput: receiptLines,
        inspectionStatus: receiptInspection,
        deliveryNoteRef: receiptDeliveryNote,
        notes: receiptNotes,
        actor,
      });
      toast({
        title: `Réception ${ref} validée`,
        description:
          'Les mouvements d’entrée en stock (IN) et les soldes entrepôt ont été mis à jour atomiquement.',
        variant: 'success',
      });
      setReceiptOrderTarget(null);
      await invalidateAll();
    } catch (err) {
      toast({
        title: 'Validation réception impossible',
        description: err instanceof Error ? err.message : 'Erreur inconnue',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Add RFQ Offer
  const handleAddRfqOffer = async () => {
    if (!activeOrg || !rfqTarget) return;
    const sup = suppliers.find((s) => s.id === rfqSupplierId);
    if (!sup) {
      toast({ title: 'Sélectionnez un fournisseur', variant: 'warning' });
      return;
    }
    setSubmitting(true);
    try {
      await addRfqOfferToRequest(activeOrg.id, rfqTarget, {
        supplierId: sup.id,
        supplierName: sup.name,
        totalHt: Number(rfqTotalHt),
        leadTimeDays: Number(rfqLeadTime),
        validUntil: rfqValidUntil,
        notes: rfqNotes,
      });
      toast({ title: 'Offre fournisseur ajoutée', variant: 'success' });
      setRfqNotes('');
      await invalidateAll();
      // Refresh local modal copy
      setRfqTarget((prev) =>
        prev
          ? {
              ...prev,
              status: 'rfq_sent',
              rfqOffers: [
                ...(prev.rfqOffers ?? []),
                {
                  supplierId: sup.id,
                  supplierName: sup.name,
                  totalHt: Number(rfqTotalHt),
                  leadTimeDays: Number(rfqLeadTime),
                  validUntil: rfqValidUntil,
                  notes: rfqNotes,
                },
              ],
            }
          : null
      );
    } catch (err) {
      toast({
        title: 'Impossible d’ajouter l’offre',
        description: err instanceof Error ? err.message : 'Erreur inconnue',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Open Invoice modal prefilled from PO
  const openInvoiceFromPo = (po: PurchaseOrder) => {
    invoiceForm.reset({
      invoiceNumber: `FF-${new Date().getFullYear()}-${String(supplierInvoices.length + 1).padStart(4, '0')}`,
      purchaseOrderId: po.id,
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
      totalHt: po.subtotalHt,
      totalVat: po.vatTotal,
      totalTtc: po.totalTtc,
      notes: '',
    });
    setInvoiceModalOpen(true);
  };

  const onSubmitInvoice = invoiceForm.handleSubmit(async (data) => {
    if (!activeOrg || !user) return;
    const po = purchaseOrders.find((o) => o.id === data.purchaseOrderId);
    if (!po) {
      toast({ title: 'Commande introuvable', variant: 'error' });
      return;
    }
    setSubmitting(true);
    try {
      await createSupplierInvoice({
        orgId: activeOrg.id,
        memberUids,
        order: po,
        input: data,
        actor: { uid: user.uid, email: user.email ?? '' },
      });
      toast({
        title: 'Facture fournisseur enregistrée',
        description: `${data.invoiceNumber} liée à ${po.reference}.`,
        variant: 'success',
      });
      setInvoiceModalOpen(false);
      setActiveTab('invoices');
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

  const handleRecordPayment = async () => {
    if (!activeOrg || !user || !paymentInvoiceTarget) return;
    if (paymentAmount <= 0) {
      toast({ title: 'Montant invalide', variant: 'warning' });
      return;
    }
    setSubmitting(true);
    try {
      await recordSupplierInvoicePayment({
        orgId: activeOrg.id,
        memberUids,
        invoice: paymentInvoiceTarget,
        amount: Number(paymentAmount),
        actor: { uid: user.uid, email: user.email ?? '' },
      });
      toast({
        title: 'Règlement fournisseur enregistré',
        description: `${formatCurrency(paymentAmount, currency)} imputé sur ${paymentInvoiceTarget.invoiceNumber}.`,
        variant: 'success',
      });
      setPaymentInvoiceTarget(null);
      await invalidateAll();
    } catch (err) {
      toast({
        title: 'Erreur lors du règlement',
        description: err instanceof Error ? err.message : 'Erreur inconnue',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return purchaseOrders.filter((po) => {
      if (poStatusFilter !== 'ALL' && po.status !== poStatusFilter) return false;
      if (!q) return true;
      return (
        po.reference.toLowerCase().includes(q) ||
        po.supplierName.toLowerCase().includes(q) ||
        po.warehouseName.toLowerCase().includes(q)
      );
    });
  }, [purchaseOrders, search, poStatusFilter]);

  const filteredRequests = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return purchaseRequests;
    return purchaseRequests.filter(
      (pr) =>
        pr.reference.toLowerCase().includes(q) ||
        pr.title.toLowerCase().includes(q) ||
        pr.warehouseName.toLowerCase().includes(q)
    );
  }, [purchaseRequests, search]);

  const filteredReceipts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return goodsReceipts;
    return goodsReceipts.filter(
      (gr) =>
        gr.reference.toLowerCase().includes(q) ||
        gr.purchaseOrderRef.toLowerCase().includes(q) ||
        gr.supplierName.toLowerCase().includes(q)
    );
  }, [goodsReceipts, search]);

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return supplierInvoices;
    return supplierInvoices.filter(
      (inv) =>
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.purchaseOrderRef.toLowerCase().includes(q) ||
        inv.supplierName.toLowerCase().includes(q)
    );
  }, [supplierInvoices, search]);

  const billableOrders = useMemo(
    () =>
      purchaseOrders.filter(
        (po) =>
          po.status === 'partially_received' ||
          po.status === 'received' ||
          po.status === 'confirmed'
      ),
    [purchaseOrders]
  );

  const poWarehouseLocations = useMemo(() => {
    if (!receiptOrderTarget) return [];
    return locations.filter(
      (l) => l.warehouseId === receiptOrderTarget.warehouseId && l.status === 'active'
    );
  }, [receiptOrderTarget, locations]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Accueil / Achats &amp; Approvisionnements
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Achats &amp; Réceptions
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
          <Button type="button" variant="outline" onClick={() => openCreatePrModal()}>
            <Plus className="h-4 w-4" />
            <span>Demande d’achat</span>
          </Button>
          <Button
            type="button"
            onClick={() => openCreatePoModal()}
            disabled={suppliers.length === 0 || products.length === 0}
          >
            <ShoppingCart className="h-4 w-4" />
            <span>Nouvelle commande</span>
          </Button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Commandes en cours</span>
            <ShoppingCart className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <p className="mt-2 font-mono text-xl font-semibold text-slate-900 dark:text-white tabular-nums">
            {kpis.openOrderCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">En attente de réception</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Montant engagé TTC</span>
            <Scale className="h-4 w-4 text-slate-400" />
          </div>
          <p className="mt-2 font-mono text-xl font-semibold text-slate-900 dark:text-white tabular-nums">
            {formatCurrency(kpis.committedTtc, currency)}
          </p>
          <p className="mt-1 text-xs text-slate-500">Commandes confirmées / partielles</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Bons de réception</span>
            <PackageCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="mt-2 font-mono text-xl font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
            {kpis.receiptCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">Entrées stock atomiques validées</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Factures à régler</span>
            <CreditCard className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <p className="mt-2 font-mono text-xl font-semibold text-slate-900 dark:text-white tabular-nums">
            {formatCurrency(kpis.unpaidTtc, currency)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {kpis.unpaidInvoiceCount} facture(s) ouverte(s)
          </p>
        </div>
      </div>

      {/* Tabs + Search */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist">
          {(
            [
              { id: 'requests', label: `Besoins & Demandes (${purchaseRequests.length})` },
              { id: 'orders', label: `Commandes (${purchaseOrders.length})` },
              { id: 'receipts', label: `Réceptions (${goodsReceipts.length})` },
              { id: 'invoices', label: `Factures (${supplierInvoices.length})` },
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
              placeholder="Rechercher référence, fournisseur..."
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
          {activeTab === 'orders' && (
            <select
              aria-label="Filtrer par statut de commande"
              value={poStatusFilter}
              onChange={(e) =>
                setPoStatusFilter(e.target.value as 'ALL' | PurchaseOrder['status'])
              }
              className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value="ALL">Tous statuts</option>
              <option value="draft">Brouillon</option>
              <option value="confirmed">Confirmée</option>
              <option value="partially_received">Réception partielle</option>
              <option value="received">Réceptionnée</option>
              <option value="invoiced">Facturée</option>
              <option value="closed">Clôturée</option>
              <option value="canceled">Annulée</option>
            </select>
          )}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <TableSkeleton rows={5} />
      ) : (
        <>
          {/* TAB 1: BESOINS & DEMANDES */}
          {activeTab === 'requests' && (
            <div className="space-y-6">
              {/* Automatic Low-Stock Detection */}
              <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
                  <div className="flex items-center gap-2.5">
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                        Détection automatique des besoins de réapprovisionnement (
                        {replenishmentNeeds.length})
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Articles actifs en rupture ou sous le seuil minimum configuré
                      </p>
                    </div>
                  </div>
                </div>
                {replenishmentNeeds.length === 0 ? (
                  <div className="flex items-center gap-2.5 px-5 py-6 text-xs text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Tous les articles actifs disposent d’un stock supérieur au seuil minimum.</span>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50/70 text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
                        <tr>
                          <th className="px-4 py-2.5 font-medium">Produit</th>
                          <th className="px-4 py-2.5 font-medium text-right">Dispo / Min / Max</th>
                          <th className="px-4 py-2.5 font-medium text-right">Qté suggérée</th>
                          <th className="px-4 py-2.5 font-medium text-right">Actions rapides</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {replenishmentNeeds.map(({ product, available, suggestedQty }) => (
                          <tr key={product.id}>
                            <td className="px-4 py-2.5">
                              <p className="font-medium text-slate-900 dark:text-slate-100">
                                {product.name}
                              </p>
                              <p className="font-mono text-slate-500">{product.sku}</p>
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                              <span
                                className={
                                  available <= 0
                                    ? 'font-semibold text-red-600 dark:text-red-400'
                                    : 'font-semibold text-amber-600 dark:text-amber-400'
                                }
                              >
                                {formatNumber(available)}
                              </span>
                              {' / '}
                              {formatNumber(product.minStock)}
                              {' / '}
                              {formatNumber(product.maxStock)} {product.unit}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-semibold text-blue-600 dark:text-blue-400 tabular-nums">
                              +{formatNumber(suggestedQty)} {product.unit}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <div className="inline-flex items-center gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    openCreatePrModal({
                                      productId: product.id,
                                      quantity: suggestedQty,
                                    })
                                  }
                                >
                                  Créer demande
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={suppliers.length === 0}
                                  onClick={() =>
                                    openCreatePoModal({
                                      lines: [
                                        {
                                          productId: product.id,
                                          quantity: suggestedQty,
                                          unitPrice: product.purchasePrice,
                                          vatRate: product.vatRate,
                                        },
                                      ],
                                      notes: `Réapprovisionnement automatique (${product.sku})`,
                                    })
                                  }
                                >
                                  Commander
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Purchase Requests List */}
              {filteredRequests.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="Aucune demande d’achat"
                  description="Créez une demande d’achat manuelle ou depuis une alerte de seuil ci-dessus pour lancer un workflow d’approbation et comparer des offres fournisseurs (RFQ)."
                  action={
                    <Button type="button" onClick={() => openCreatePrModal()}>
                      <Plus className="h-4 w-4" />
                      <span>Nouvelle demande d’achat</span>
                    </Button>
                  }
                />
              ) : (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50/80 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
                        <tr>
                          <th className="px-4 py-3 font-medium">Référence &amp; Objet</th>
                          <th className="px-4 py-3 font-medium">Entrepôt</th>
                          <th className="px-4 py-3 font-medium text-right">Estimation HT</th>
                          <th className="px-4 py-3 font-medium">Offres RFQ</th>
                          <th className="px-4 py-3 font-medium">Statut</th>
                          <th className="px-4 py-3 font-medium text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {filteredRequests.map((pr) => {
                          const estHt = pr.lines.reduce(
                            (acc, l) => acc + l.quantity * l.estimatedUnitCost,
                            0
                          );
                          const statusMeta = PR_STATUS_META[pr.status];
                          return (
                            <tr key={pr.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                              <td className="px-4 py-3">
                                <p className="font-medium text-slate-900 dark:text-slate-100">
                                  {pr.title}
                                </p>
                                <p className="text-xs text-slate-500 font-mono">
                                  {pr.reference} · {pr.lines.length} ligne(s)
                                  {pr.priority === 'urgent' ? ' · URGENT' : ''}
                                </p>
                              </td>
                              <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                                {pr.warehouseName}
                              </td>
                              <td className="px-4 py-3 text-right font-mono tabular-nums">
                                {formatCurrency(estHt, currency)}
                              </td>
                              <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">
                                {pr.rfqOffers?.length ?? 0} devis
                              </td>
                              <td className="px-4 py-3">
                                <StatusText tone={statusMeta.tone} label={statusMeta.label} />
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                  {pr.status === 'pending_approval' && activeOrg && (
                                    <>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={async () => {
                                          await updatePurchaseRequest(activeOrg.id, pr.id, {
                                            status: 'approved',
                                          });
                                          toast({ title: 'Demande approuvée', variant: 'success' });
                                          await invalidateAll();
                                        }}
                                      >
                                        Approuver
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        onClick={async () => {
                                          await updatePurchaseRequest(activeOrg.id, pr.id, {
                                            status: 'rejected',
                                          });
                                          toast({ title: 'Demande rejetée', variant: 'info' });
                                          await invalidateAll();
                                        }}
                                      >
                                        Rejeter
                                      </Button>
                                    </>
                                  )}
                                  {pr.status !== 'rejected' && pr.status !== 'converted' && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => {
                                        setRfqTarget(pr);
                                        setRfqSupplierId(suppliers[0]?.id ?? '');
                                        setRfqTotalHt(Number(estHt.toFixed(2)));
                                      }}
                                    >
                                      Comparer RFQ
                                    </Button>
                                  )}
                                  {(pr.status === 'approved' || pr.status === 'rfq_sent') && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      disabled={suppliers.length === 0}
                                      onClick={() =>
                                        openCreatePoModal({
                                          warehouseId: pr.warehouseId,
                                          sourceRequestId: pr.id,
                                          lines: pr.lines.map((l) => ({
                                            productId: l.productId,
                                            quantity: l.quantity,
                                            unitPrice: l.estimatedUnitCost,
                                          })),
                                          notes: `Issue de la demande ${pr.reference}`,
                                        })
                                      }
                                    >
                                      Convertir CF
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
            </div>
          )}

          {/* TAB 2: COMMANDES FOURNISSEURS */}
          {activeTab === 'orders' &&
            (filteredOrders.length === 0 ? (
              <EmptyState
                icon={ShoppingCart}
                title={
                  purchaseOrders.length === 0
                    ? 'Aucune commande fournisseur'
                    : 'Aucune commande trouvée'
                }
                description={
                  purchaseOrders.length === 0
                    ? 'Passez votre première commande fournisseur. Pour préserver l’intégrité des stocks, les quantités ne seront ajoutées à l’entrepôt qu’après réception et contrôle qualité.'
                    : 'Aucune commande ne correspond à vos filtres actuels.'
                }
                action={
                  purchaseOrders.length === 0 ? (
                    <div className="flex flex-wrap items-center justify-center gap-2.5">
                      {suppliers.length === 0 && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void handleSeedDemo()}
                        >
                          <Sparkles className="h-4 w-4 text-blue-600" />
                          <span>Charger données démo</span>
                        </Button>
                      )}
                      <Button
                        type="button"
                        onClick={() => openCreatePoModal()}
                        disabled={suppliers.length === 0 || products.length === 0}
                      >
                        <Plus className="h-4 w-4" />
                        <span>Créer une commande</span>
                      </Button>
                    </div>
                  ) : undefined
                }
              />
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50/80 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
                      <tr>
                        <th className="px-4 py-3 font-medium">Commande</th>
                        <th className="px-4 py-3 font-medium">Fournisseur</th>
                        <th className="px-4 py-3 font-medium">Entrepôt &amp; Livraison</th>
                        <th className="px-4 py-3 font-medium text-right">Avancement</th>
                        <th className="px-4 py-3 font-medium text-right">Total TTC</th>
                        <th className="px-4 py-3 font-medium">Statut</th>
                        <th className="px-4 py-3 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredOrders.map((po) => {
                        const statusMeta = PO_STATUS_META[po.status];
                        const orderedQty = po.lines.reduce((a, l) => a + l.quantity, 0);
                        const receivedQty = po.lines.reduce((a, l) => a + l.receivedQty, 0);
                        return (
                          <tr key={po.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                            <td className="px-4 py-3">
                              <p className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                                {po.reference}
                                {po.isDemo && (
                                  <span className="ml-2 font-sans text-[11px] font-normal text-slate-400">
                                    (Démo)
                                  </span>
                                )}
                              </p>
                              <p className="text-xs text-slate-500 font-mono">
                                {formatDateShort(po.createdAt)} · {po.lines.length} article(s)
                              </p>
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-medium text-slate-900 dark:text-slate-100">
                                {po.supplierName}
                              </p>
                              <p className="text-xs text-slate-500">{po.paymentTerms || '—'}</p>
                            </td>
                            <td className="px-4 py-3">
                              <p className="text-slate-800 dark:text-slate-200">{po.warehouseName}</p>
                              <p className="text-xs text-slate-500 font-mono">
                                Prévue : {po.expectedDate ? formatDateShort(po.expectedDate) : '—'}
                              </p>
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                              {formatNumber(receivedQty)} / {formatNumber(orderedQty)} u.
                            </td>
                            <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                              {formatCurrency(po.totalTtc, currency)}
                            </td>
                            <td className="px-4 py-3">
                              <StatusText tone={statusMeta.tone} label={statusMeta.label} />
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                {po.status === 'draft' && activeOrg && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={async () => {
                                      await updatePurchaseOrderStatus(
                                        activeOrg.id,
                                        po,
                                        'confirmed',
                                        memberUids,
                                        { uid: actor.uid, email: actor.email }
                                      );
                                      toast({ title: 'Commande confirmée', variant: 'success' });
                                      await invalidateAll();
                                    }}
                                  >
                                    Confirmer
                                  </Button>
                                )}
                                {(po.status === 'confirmed' ||
                                  po.status === 'partially_received') && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => openReceiptModal(po)}
                                  >
                                    <PackageCheck className="h-3.5 w-3.5" />
                                    <span>Réceptionner</span>
                                  </Button>
                                )}
                                {(po.status === 'partially_received' ||
                                  po.status === 'received') && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => openInvoiceFromPo(po)}
                                  >
                                    Facturer
                                  </Button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setPrintOrderTarget(po)}
                                  title="Aperçu / Imprimer"
                                  aria-label={`Imprimer ${po.reference}`}
                                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white cursor-pointer"
                                >
                                  <Printer className="h-4 w-4" />
                                </button>
                                {(po.status === 'draft' || po.status === 'confirmed') && (
                                  <button
                                    type="button"
                                    onClick={() => setCancelOrderTarget(po)}
                                    title="Annuler la commande"
                                    aria-label={`Annuler ${po.reference}`}
                                    className="rounded-lg p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-400 cursor-pointer"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
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

          {/* TAB 3: RÉCEPTIONS & CONTRÔLES */}
          {activeTab === 'receipts' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3 text-xs text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200">
                <ClipboardCheck className="h-4 w-4 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
                <div>
                  <span className="font-semibold">Règle d’intégrité des stocks :</span>{' '}
                  aucune commande fournisseur ne génère de stock avant la validation d’un bon de réception. Chaque quantité acceptée crée automatiquement un mouvement <span className="font-mono font-semibold">IN</span> traçable dans le module{' '}
                  <Link to="/stocks" className="underline font-medium">
                    Stocks
                  </Link>
                  .
                </div>
              </div>

              {filteredReceipts.length === 0 ? (
                <EmptyState
                  icon={PackageCheck}
                  title="Aucune réception enregistrée"
                  description="Sélectionnez une commande confirmée dans l’onglet « Commandes » et cliquez sur « Réceptionner » pour contrôler les quantités et alimenter le stock."
                  action={
                    <Button type="button" variant="outline" onClick={() => setActiveTab('orders')}>
                      Voir les commandes à réceptionner
                    </Button>
                  }
                />
              ) : (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50/80 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
                        <tr>
                          <th className="px-4 py-3 font-medium">Bon de réception</th>
                          <th className="px-4 py-3 font-medium">Commande &amp; BL</th>
                          <th className="px-4 py-3 font-medium">Fournisseur &amp; Entrepôt</th>
                          <th className="px-4 py-3 font-medium text-right">Accepté / Rejeté</th>
                          <th className="px-4 py-3 font-medium">Contrôle qualité</th>
                          <th className="px-4 py-3 font-medium text-right">Détail</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {filteredReceipts.map((gr) => {
                          const insp = INSPECTION_META[gr.inspectionStatus];
                          const accSum = gr.lines.reduce((a, l) => a + l.acceptedQty, 0);
                          const rejSum = gr.lines.reduce((a, l) => a + l.rejectedQty, 0);
                          return (
                            <tr key={gr.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                              <td className="px-4 py-3">
                                <p className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                                  {gr.reference}
                                </p>
                                <p className="text-xs text-slate-500 font-mono">
                                  {formatDateTime(gr.createdAt)}
                                </p>
                              </td>
                              <td className="px-4 py-3">
                                <p className="font-mono text-xs font-medium text-slate-800 dark:text-slate-200">
                                  {gr.purchaseOrderRef}
                                </p>
                                <p className="text-xs text-slate-500">
                                  BL : {gr.deliveryNoteRef || '—'}
                                </p>
                              </td>
                              <td className="px-4 py-3">
                                <p className="font-medium text-slate-900 dark:text-slate-100">
                                  {gr.supplierName}
                                </p>
                                <p className="text-xs text-slate-500">{gr.warehouseName}</p>
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                                  +{formatNumber(accSum)}
                                </span>
                                {rejSum > 0 && (
                                  <span className="ml-2 text-red-600 dark:text-red-400">
                                    (-{formatNumber(rejSum)} rej.)
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <StatusText tone={insp.tone} label={insp.label} />
                              </td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => setReceiptDetailTarget(gr)}
                                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white cursor-pointer"
                                  aria-label={`Voir ${gr.reference}`}
                                >
                                  <Eye className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: FACTURES FOURNISSEURS */}
          {activeTab === 'invoices' && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  disabled={billableOrders.length === 0}
                  onClick={() => openInvoiceFromPo(billableOrders[0])}
                >
                  <Plus className="h-4 w-4" />
                  <span>Enregistrer une facture fournisseur</span>
                </Button>
              </div>

              {filteredInvoices.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="Aucune facture fournisseur"
                  description="Saisissez les factures reçues de vos fournisseurs en les rapprochant d’une commande d’achat, puis suivez les règlements partiels ou complets."
                  action={
                    billableOrders.length > 0 ? (
                      <Button type="button" onClick={() => openInvoiceFromPo(billableOrders[0])}>
                        <Plus className="h-4 w-4" />
                        <span>Enregistrer une facture</span>
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
                          <th className="px-4 py-3 font-medium">N° Facture</th>
                          <th className="px-4 py-3 font-medium">Fournisseur &amp; Commande</th>
                          <th className="px-4 py-3 font-medium">Échéance</th>
                          <th className="px-4 py-3 font-medium text-right">Total TTC</th>
                          <th className="px-4 py-3 font-medium text-right">Reste à payer</th>
                          <th className="px-4 py-3 font-medium">Statut</th>
                          <th className="px-4 py-3 font-medium text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {filteredInvoices.map((inv) => {
                          const remaining = Math.max(0, inv.totalTtc - inv.paidAmount);
                          const st = INVOICE_STATUS_META[inv.status];
                          const isOverdue =
                            inv.status !== 'paid' &&
                            new Date(inv.dueDate).getTime() < Date.now();
                          return (
                            <tr key={inv.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                              <td className="px-4 py-3 font-mono font-semibold text-slate-900 dark:text-slate-100">
                                {inv.invoiceNumber}
                              </td>
                              <td className="px-4 py-3">
                                <p className="font-medium text-slate-900 dark:text-slate-100">
                                  {inv.supplierName}
                                </p>
                                <p className="text-xs font-mono text-slate-500">
                                  {inv.purchaseOrderRef}
                                </p>
                              </td>
                              <td className="px-4 py-3 font-mono text-xs">
                                <p
                                  className={
                                    isOverdue
                                      ? 'font-semibold text-red-600 dark:text-red-400'
                                      : 'text-slate-700 dark:text-slate-300'
                                  }
                                >
                                  {formatDateShort(inv.dueDate)}
                                  {isOverdue ? ' (Échue)' : ''}
                                </p>
                                <p className="text-slate-400">
                                  Émise : {formatDateShort(inv.issueDate)}
                                </p>
                              </td>
                              <td className="px-4 py-3 text-right font-mono tabular-nums">
                                {formatCurrency(inv.totalTtc, currency)}
                              </td>
                              <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                                {formatCurrency(remaining, currency)}
                              </td>
                              <td className="px-4 py-3">
                                <StatusText tone={st.tone} label={st.label} />
                              </td>
                              <td className="px-4 py-3 text-right">
                                {inv.status !== 'paid' && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setPaymentInvoiceTarget(inv);
                                      setPaymentAmount(Number(remaining.toFixed(2)));
                                    }}
                                  >
                                    Régler
                                  </Button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* MODAL: NEW PURCHASE REQUEST */}
      <Modal
        open={prModalOpen}
        onClose={() => setPrModalOpen(false)}
        title="Nouvelle demande d’achat"
        subtitle="Expression de besoin interne avant validation et consultation fournisseurs."
        size="lg"
      >
        <form onSubmit={onSubmitPr} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Objet de la demande *
              </label>
              <input
                {...prForm.register('title')}
                placeholder="Ex. Réapprovisionnement capteurs Q2"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              {prForm.formState.errors.title && (
                <p className="mt-1 text-xs text-red-600">
                  {prForm.formState.errors.title.message}
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Priorité
              </label>
              <select
                {...prForm.register('priority')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="normal">Normale</option>
                <option value="urgent">Urgente</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Entrepôt demandeur *
              </label>
              <select
                {...prForm.register('warehouseId')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
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
                Commentaire
              </label>
              <input
                {...prForm.register('notes')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Lignes d’articles ({prLinesField.fields.length})
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  prLinesField.append({
                    productId: products[0]?.id ?? '',
                    quantity: 10,
                    estimatedUnitCost: products[0]?.purchasePrice ?? 0,
                  })
                }
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Ajouter ligne</span>
              </Button>
            </div>

            {prLinesField.fields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-6">
                  <select
                    {...prForm.register(`lines.${index}.productId`)}
                    onChange={(e) => {
                      const p = products.find((item) => item.id === e.target.value);
                      prForm.setValue(`lines.${index}.productId`, e.target.value);
                      if (p) prForm.setValue(`lines.${index}.estimatedUnitCost`, p.purchasePrice);
                    }}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="">Sélectionner produit...</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <input
                    type="number"
                    step="any"
                    {...prForm.register(`lines.${index}.quantity`)}
                    placeholder="Qté"
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div className="col-span-3">
                  <input
                    type="number"
                    step="0.01"
                    {...prForm.register(`lines.${index}.estimatedUnitCost`)}
                    placeholder="Coût HT"
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div className="col-span-1 text-right">
                  {prLinesField.fields.length > 1 && (
                    <button
                      type="button"
                      onClick={() => prLinesField.remove(index)}
                      className="rounded p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
            <Button type="button" variant="outline" onClick={() => setPrModalOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Enregistrement...' : 'Soumettre la demande'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL: RFQ SUPPLIER COMPARISON */}
      <Modal
        open={Boolean(rfqTarget)}
        onClose={() => setRfqTarget(null)}
        title={rfqTarget ? `Comparaison fournisseurs (RFQ) — ${rfqTarget.reference}` : ''}
        subtitle={rfqTarget?.title}
        size="xl"
      >
        {rfqTarget && (
          <div className="space-y-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/50 space-y-3">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Enregistrer un devis fournisseur reçu
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                <div className="sm:col-span-2">
                  <select
                    value={rfqSupplierId}
                    onChange={(e) => {
                      const s = suppliers.find((x) => x.id === e.target.value);
                      setRfqSupplierId(e.target.value);
                      if (s) setRfqLeadTime(s.leadTimeDays);
                    }}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.leadTimeDays} j)
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <input
                    type="number"
                    step="0.01"
                    value={rfqTotalHt}
                    onChange={(e) => setRfqTotalHt(Number(e.target.value))}
                    placeholder="Total HT"
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <input
                    type="number"
                    value={rfqLeadTime}
                    onChange={(e) => setRfqLeadTime(Number(e.target.value))}
                    placeholder="Délai (j)"
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <Button
                    type="button"
                    size="sm"
                    className="w-full h-9"
                    onClick={() => void handleAddRfqOffer()}
                    disabled={submitting}
                  >
                    Ajouter offre
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="date"
                  value={rfqValidUntil}
                  onChange={(e) => setRfqValidUntil(e.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <input
                  type="text"
                  value={rfqNotes}
                  onChange={(e) => setRfqNotes(e.target.value)}
                  placeholder="Remarques (franco de port, conditions...)"
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            {!rfqTarget.rfqOffers || rfqTarget.rfqOffers.length === 0 ? (
              <p className="text-center text-xs text-slate-500 py-4">
                Aucune offre saisie pour cette consultation. Ajoutez au moins 2 devis pour comparer les prix et délais.
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60 text-slate-500">
                    <tr>
                      <th className="px-3 py-2.5 font-medium">Fournisseur</th>
                      <th className="px-3 py-2.5 font-medium text-right">Montant HT</th>
                      <th className="px-3 py-2.5 font-medium text-right">Délai</th>
                      <th className="px-3 py-2.5 font-medium">Validité</th>
                      <th className="px-3 py-2.5 font-medium">Notes</th>
                      <th className="px-3 py-2.5 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {rfqTarget.rfqOffers.map((offer, idx) => {
                      const minPrice = Math.min(...(rfqTarget.rfqOffers ?? []).map((o) => o.totalHt));
                      const isBestPrice = offer.totalHt === minPrice;
                      return (
                        <tr key={`${offer.supplierId}-${idx}`}>
                          <td className="px-3 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                            {offer.supplierName}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                            <span
                              className={
                                isBestPrice
                                  ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                                  : ''
                              }
                            >
                              {formatCurrency(offer.totalHt, currency)}
                            </span>
                            {isBestPrice && (
                              <span className="ml-1.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                                (Meilleur prix)
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono">
                            {offer.leadTimeDays} j
                          </td>
                          <td className="px-3 py-2.5 font-mono">{formatDateShort(offer.validUntil)}</td>
                          <td className="px-3 py-2.5 text-slate-500">{offer.notes || '—'}</td>
                          <td className="px-3 py-2.5 text-right">
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => {
                                const target = rfqTarget;
                                setRfqTarget(null);
                                openCreatePoModal({
                                  supplierId: offer.supplierId,
                                  warehouseId: target.warehouseId,
                                  sourceRequestId: target.id,
                                  lines: target.lines.map((l) => ({
                                    productId: l.productId,
                                    quantity: l.quantity,
                                    unitPrice: l.estimatedUnitCost,
                                  })),
                                  notes: `Offre retenue sur ${target.reference} (${offer.supplierName})`,
                                });
                              }}
                            >
                              Retenir &amp; Commander
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* MODAL: NEW PURCHASE ORDER */}
      <Modal
        open={poModalOpen}
        onClose={() => setPoModalOpen(false)}
        title="Nouvelle commande fournisseur"
        subtitle="La validation crée une commande engagée ; les entrées en stock s’effectuent exclusivement lors de la réception."
        size="xl"
      >
        <form onSubmit={onSubmitPo} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Fournisseur *
              </label>
              <select
                {...poForm.register('supplierId')}
                onChange={(e) => {
                  const sup = suppliers.find((s) => s.id === e.target.value);
                  poForm.setValue('supplierId', e.target.value);
                  if (sup) {
                    poForm.setValue('paymentTerms', sup.paymentTerms);
                    poForm.setValue(
                      'expectedDate',
                      new Date(Date.now() + sup.leadTimeDays * 86400_000).toISOString().slice(0, 10)
                    );
                  }
                }}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="">Sélectionner fournisseur...</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Entrepôt de livraison *
              </label>
              <select
                {...poForm.register('warehouseId')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
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
                Date livraison prévue
              </label>
              <input
                type="date"
                {...poForm.register('expectedDate')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Conditions de paiement
              </label>
              <input
                {...poForm.register('paymentTerms')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Frais de port HT
              </label>
              <input
                type="number"
                step="0.01"
                {...poForm.register('shippingCost')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Notes / Instructions livraison
              </label>
              <input
                {...poForm.register('notes')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Lignes de commande ({poLinesField.fields.length})
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  poLinesField.append({
                    productId: products[0]?.id ?? '',
                    quantity: 10,
                    unitPrice: products[0]?.purchasePrice ?? 0,
                    discountPct: 0,
                    vatRate: products[0]?.vatRate ?? 20,
                  })
                }
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Ajouter produit</span>
              </Button>
            </div>

            <div className="grid grid-cols-12 gap-2 text-[11px] font-medium text-slate-500 px-1">
              <span className="col-span-5">Produit</span>
              <span className="col-span-2">Quantité</span>
              <span className="col-span-2">PU HT</span>
              <span className="col-span-1">Rem.%</span>
              <span className="col-span-1">TVA%</span>
              <span className="col-span-1" />
            </div>

            {poLinesField.fields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-5">
                  <select
                    {...poForm.register(`lines.${index}.productId`)}
                    onChange={(e) => {
                      const p = products.find((item) => item.id === e.target.value);
                      poForm.setValue(`lines.${index}.productId`, e.target.value);
                      if (p) {
                        poForm.setValue(`lines.${index}.unitPrice`, p.purchasePrice);
                        poForm.setValue(`lines.${index}.vatRate`, p.vatRate);
                      }
                    }}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="">Produit...</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <input
                    type="number"
                    step="any"
                    {...poForm.register(`lines.${index}.quantity`)}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div className="col-span-2">
                  <input
                    type="number"
                    step="0.01"
                    {...poForm.register(`lines.${index}.unitPrice`)}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div className="col-span-1">
                  <input
                    type="number"
                    step="0.1"
                    {...poForm.register(`lines.${index}.discountPct`)}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div className="col-span-1">
                  <input
                    type="number"
                    step="0.1"
                    {...poForm.register(`lines.${index}.vatRate`)}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div className="col-span-1 text-right">
                  {poLinesField.fields.length > 1 && (
                    <button
                      type="button"
                      onClick={() => poLinesField.remove(index)}
                      className="rounded p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center gap-4 font-mono tabular-nums">
              <span>
                Total HT : <strong>{formatCurrency(poPreviewTotals.subtotalHt, currency)}</strong>
              </span>
              <span>
                TVA : <strong>{formatCurrency(poPreviewTotals.vatTotal, currency)}</strong>
              </span>
              <span className="text-sm text-slate-900 dark:text-white">
                Total TTC : <strong>{formatCurrency(poPreviewTotals.totalTtc, currency)}</strong>
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <Button
                type="submit"
                variant="outline"
                disabled={submitting}
                onClick={() => setConfirmImmediately(false)}
              >
                Enregistrer brouillon
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                onClick={() => setConfirmImmediately(true)}
              >
                {submitting ? 'Création...' : 'Valider la commande'}
              </Button>
            </div>
          </div>
        </form>
      </Modal>

      {/* MODAL: GOODS RECEIPT & QUALITY INSPECTION */}
      <Modal
        open={Boolean(receiptOrderTarget)}
        onClose={() => setReceiptOrderTarget(null)}
        title={
          receiptOrderTarget
            ? `Réception & Contrôle qualité — ${receiptOrderTarget.reference}`
            : ''
        }
        subtitle={
          receiptOrderTarget
            ? `${receiptOrderTarget.supplierName} · Entrepôt ${receiptOrderTarget.warehouseName}`
            : ''
        }
        size="xl"
      >
        {receiptOrderTarget && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  N° Bon de livraison fournisseur
                </label>
                <input
                  value={receiptDeliveryNote}
                  onChange={(e) => setReceiptDeliveryNote(e.target.value)}
                  placeholder="BL-2026-884"
                  className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Résultat contrôle qualité
                </label>
                <select
                  value={receiptInspection}
                  onChange={(e) => setReceiptInspection(e.target.value as InspectionStatus)}
                  className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="passed">Conforme (Passed)</option>
                  <option value="partial_issue">Réserve partielle (Colis abîmé/manquant)</option>
                  <option value="rejected">Non conforme (Rejeté)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Observations réception
                </label>
                <input
                  value={receiptNotes}
                  onChange={(e) => setReceiptNotes(e.target.value)}
                  placeholder="Remarques contrôleur..."
                  className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Produit</th>
                    <th className="px-3 py-2 font-medium">Emplacement cible</th>
                    <th className="px-3 py-2 font-medium text-right">Reliquat</th>
                    <th className="px-3 py-2 font-medium text-right">Reçue</th>
                    <th className="px-3 py-2 font-medium text-right">Acceptée (Stock)</th>
                    <th className="px-3 py-2 font-medium text-right">Rejetée</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {receiptLines.map((rl, idx) => {
                    const poLine = receiptOrderTarget.lines.find(
                      (l) => l.productId === rl.productId
                    );
                    const remaining = poLine ? poLine.quantity - poLine.receivedQty : 0;
                    return (
                      <tr key={rl.productId}>
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-slate-900 dark:text-slate-100">
                            {poLine?.productName}
                          </p>
                          <p className="font-mono text-slate-500">{poLine?.productSku}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          <select
                            value={rl.locationId}
                            onChange={(e) => {
                              const next = [...receiptLines];
                              next[idx] = { ...rl, locationId: e.target.value };
                              setReceiptLines(next);
                            }}
                            className="h-8 rounded border border-slate-200 bg-white px-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                          >
                            {poWarehouseLocations.map((loc) => (
                              <option key={loc.id} value={loc.id}>
                                {loc.code} ({loc.zoneType})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-500">
                          {formatNumber(remaining)}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <input
                            type="number"
                            min="0"
                            max={remaining}
                            step="any"
                            value={rl.receivedQty}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              const next = [...receiptLines];
                              next[idx] = {
                                ...rl,
                                receivedQty: val,
                                acceptedQty: val,
                                rejectedQty: 0,
                              };
                              setReceiptLines(next);
                            }}
                            className="h-8 w-20 rounded border border-slate-200 bg-white px-2 text-right font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                          />
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <input
                            type="number"
                            min="0"
                            max={rl.receivedQty}
                            step="any"
                            value={rl.acceptedQty}
                            onChange={(e) => {
                              const acc = Math.min(rl.receivedQty, Math.max(0, Number(e.target.value)));
                              const next = [...receiptLines];
                              next[idx] = {
                                ...rl,
                                acceptedQty: acc,
                                rejectedQty: Number((rl.receivedQty - acc).toFixed(3)),
                              };
                              setReceiptLines(next);
                            }}
                            className="h-8 w-20 rounded border border-emerald-300 bg-white px-2 text-right font-mono text-xs font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-slate-950 dark:text-emerald-400"
                          />
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <input
                            type="number"
                            min="0"
                            max={rl.receivedQty}
                            step="any"
                            value={rl.rejectedQty}
                            onChange={(e) => {
                              const rej = Math.min(rl.receivedQty, Math.max(0, Number(e.target.value)));
                              const next = [...receiptLines];
                              next[idx] = {
                                ...rl,
                                rejectedQty: rej,
                                acceptedQty: Number((rl.receivedQty - rej).toFixed(3)),
                              };
                              setReceiptLines(next);
                            }}
                            className="h-8 w-20 rounded border border-slate-200 bg-white px-2 text-right font-mono text-xs text-red-600 dark:border-slate-700 dark:bg-slate-950 dark:text-red-400"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 pt-4 dark:border-slate-800">
              <p className="text-xs text-slate-500">
                Seules les quantités « Acceptées » incrémenteront le stock physique et généreront des mouvements <span className="font-mono font-semibold">IN</span>.
              </p>
              <div className="flex items-center gap-2.5">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setReceiptOrderTarget(null)}
                >
                  Annuler
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleValidateReceipt()}
                  disabled={submitting}
                >
                  <PackageCheck className="h-4 w-4" />
                  <span>{submitting ? 'Validation...' : 'Valider l’entrée en stock'}</span>
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* MODAL: RECEIPT DETAIL */}
      <Modal
        open={Boolean(receiptDetailTarget)}
        onClose={() => setReceiptDetailTarget(null)}
        title={receiptDetailTarget ? `Bon de réception ${receiptDetailTarget.reference}` : ''}
        subtitle={
          receiptDetailTarget
            ? `Commande ${receiptDetailTarget.purchaseOrderRef} · ${receiptDetailTarget.supplierName}`
            : ''
        }
        size="lg"
      >
        {receiptDetailTarget && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
              <div>
                <p className="text-slate-500">Entrepôt</p>
                <p className="font-medium text-slate-900 dark:text-slate-100">
                  {receiptDetailTarget.warehouseName}
                </p>
              </div>
              <div>
                <p className="text-slate-500">BL Fournisseur</p>
                <p className="font-mono">{receiptDetailTarget.deliveryNoteRef || '—'}</p>
              </div>
              <div>
                <p className="text-slate-500">Contrôleur</p>
                <p>{receiptDetailTarget.receivedByName}</p>
              </div>
              <div>
                <p className="text-slate-500">Date</p>
                <p className="font-mono">{formatDateTime(receiptDetailTarget.createdAt)}</p>
              </div>
            </div>
            <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Produit</th>
                    <th className="px-3 py-2 font-medium">Emplacement</th>
                    <th className="px-3 py-2 font-medium text-right">Reçue</th>
                    <th className="px-3 py-2 font-medium text-right">Acceptée</th>
                    <th className="px-3 py-2 font-medium text-right">Rejetée</th>
                    <th className="px-3 py-2 font-medium text-right">Coût unit. HT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {receiptDetailTarget.lines.map((l) => (
                    <tr key={`${l.productId}-${l.locationId}`}>
                      <td className="px-3 py-2">
                        <span className="font-mono font-medium">{l.productSku}</span> —{' '}
                        {l.productName}
                      </td>
                      <td className="px-3 py-2 font-mono">{l.locationCode}</td>
                      <td className="px-3 py-2 text-right font-mono">{l.receivedQty}</td>
                      <td className="px-3 py-2 text-right font-mono text-emerald-600 font-semibold">
                        +{l.acceptedQty}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-red-600">
                        {l.rejectedQty}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {formatCurrency(l.unitCost, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      {/* MODAL: PRINTABLE PO VIEW */}
      <Modal
        open={Boolean(printOrderTarget)}
        onClose={() => setPrintOrderTarget(null)}
        title={printOrderTarget ? `Bon de commande ${printOrderTarget.reference}` : ''}
        size="xl"
      >
        {printOrderTarget && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800 text-xs">
              <div>
                <p className="text-sm font-bold text-slate-900 dark:text-white">
                  {activeOrg?.name}
                </p>
                {activeOrg?.siret && (
                  <p className="font-mono text-slate-500">SIRET : {activeOrg.siret}</p>
                )}
                <p className="mt-2 text-slate-500">
                  Livraison : <strong className="text-slate-800 dark:text-slate-200">{printOrderTarget.warehouseName}</strong>
                </p>
              </div>
              <div className="sm:text-right">
                <p className="font-semibold text-slate-900 dark:text-white">
                  Fournisseur : {printOrderTarget.supplierName}
                </p>
                <p className="font-mono text-slate-500">
                  Date : {formatDateShort(printOrderTarget.createdAt)}
                </p>
                <p className="font-mono text-slate-500">
                  Livraison souhaitée :{' '}
                  {printOrderTarget.expectedDate
                    ? formatDateShort(printOrderTarget.expectedDate)
                    : 'Dès que possible'}
                </p>
                <p className="text-slate-500">
                  Règlement : {printOrderTarget.paymentTerms || 'Standard'}
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Réf. SKU</th>
                    <th className="px-3 py-2 font-medium">Désignation</th>
                    <th className="px-3 py-2 font-medium text-right">Qté</th>
                    <th className="px-3 py-2 font-medium text-right">PU HT</th>
                    <th className="px-3 py-2 font-medium text-right">Rem.%</th>
                    <th className="px-3 py-2 font-medium text-right">TVA%</th>
                    <th className="px-3 py-2 font-medium text-right">Total HT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {printOrderTarget.lines.map((l) => {
                    const netHt = l.quantity * l.unitPrice * (1 - l.discountPct / 100);
                    return (
                      <tr key={l.productId}>
                        <td className="px-3 py-2 font-mono">{l.productSku}</td>
                        <td className="px-3 py-2">{l.productName}</td>
                        <td className="px-3 py-2 text-right font-mono">
                          {l.quantity} {l.unit}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatCurrency(l.unitPrice, currency)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">{l.discountPct}%</td>
                        <td className="px-3 py-2 text-right font-mono">{l.vatRate}%</td>
                        <td className="px-3 py-2 text-right font-mono font-medium">
                          {formatCurrency(netHt, currency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <p className="text-xs text-slate-500 max-w-md">
                {printOrderTarget.notes || 'Merci de rappeler la référence commande sur votre bon de livraison et facture.'}
              </p>
              <div className="space-y-1 text-right font-mono text-xs tabular-nums">
                <p>Frais de port HT : {formatCurrency(printOrderTarget.shippingCost, currency)}</p>
                <p>Total HT : {formatCurrency(printOrderTarget.subtotalHt, currency)}</p>
                <p>Total TVA : {formatCurrency(printOrderTarget.vatTotal, currency)}</p>
                <p className="text-base font-bold text-slate-900 dark:text-white">
                  Net à payer TTC : {formatCurrency(printOrderTarget.totalTtc, currency)}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
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

      {/* MODAL: CREATE SUPPLIER INVOICE */}
      <Modal
        open={invoiceModalOpen}
        onClose={() => setInvoiceModalOpen(false)}
        title="Enregistrer une facture fournisseur"
        subtitle="Rapprochement avec une commande fournisseur et suivi des échéances."
        size="md"
      >
        <form onSubmit={onSubmitInvoice} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Commande associée *
            </label>
            <select
              {...invoiceForm.register('purchaseOrderId')}
              onChange={(e) => {
                const po = purchaseOrders.find((o) => o.id === e.target.value);
                invoiceForm.setValue('purchaseOrderId', e.target.value);
                if (po) {
                  invoiceForm.setValue('totalHt', po.subtotalHt);
                  invoiceForm.setValue('totalVat', po.vatTotal);
                  invoiceForm.setValue('totalTtc', po.totalTtc);
                }
              }}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {billableOrders.map((po) => (
                <option key={po.id} value={po.id}>
                  {po.reference} — {po.supplierName} ({formatCurrency(po.totalTtc, currency)})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                N° Facture *
              </label>
              <input
                {...invoiceForm.register('invoiceNumber')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Date émission
              </label>
              <input
                type="date"
                {...invoiceForm.register('issueDate')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Date échéance
              </label>
              <input
                type="date"
                {...invoiceForm.register('dueDate')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Total HT
              </label>
              <input
                type="number"
                step="0.01"
                {...invoiceForm.register('totalHt')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                TVA
              </label>
              <input
                type="number"
                step="0.01"
                {...invoiceForm.register('totalVat')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Total TTC
              </label>
              <input
                type="number"
                step="0.01"
                {...invoiceForm.register('totalTtc')}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm font-semibold dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
            <Button type="button" variant="outline" onClick={() => setInvoiceModalOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Enregistrement...' : 'Enregistrer la facture'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL: RECORD PAYMENT */}
      <Modal
        open={Boolean(paymentInvoiceTarget)}
        onClose={() => setPaymentInvoiceTarget(null)}
        title={
          paymentInvoiceTarget
            ? `Règlement facture ${paymentInvoiceTarget.invoiceNumber}`
            : ''
        }
        subtitle={paymentInvoiceTarget?.supplierName}
        size="md"
      >
        {paymentInvoiceTarget && (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs font-mono space-y-1 dark:border-slate-800 dark:bg-slate-950">
              <p>Total TTC : {formatCurrency(paymentInvoiceTarget.totalTtc, currency)}</p>
              <p>Déjà réglé : {formatCurrency(paymentInvoiceTarget.paidAmount, currency)}</p>
              <p className="font-semibold text-slate-900 dark:text-white">
                Solde restant :{' '}
                {formatCurrency(
                  Math.max(0, paymentInvoiceTarget.totalTtc - paymentInvoiceTarget.paidAmount),
                  currency
                )}
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Montant du règlement ({currency})
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(Number(e.target.value))}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPaymentInvoiceTarget(null)}
              >
                Annuler
              </Button>
              <Button
                type="button"
                onClick={() => void handleRecordPayment()}
                disabled={submitting}
              >
                {submitting ? 'Traitement...' : 'Valider le règlement'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* CANCEL ORDER CONFIRM */}
      <ConfirmDialog
        open={Boolean(cancelOrderTarget)}
        onClose={() => setCancelOrderTarget(null)}
        onConfirm={async () => {
          if (!activeOrg || !cancelOrderTarget) return;
          setSubmitting(true);
          try {
            await updatePurchaseOrderStatus(
              activeOrg.id,
              cancelOrderTarget,
              'canceled',
              memberUids,
              { uid: actor.uid, email: actor.email }
            );
            toast({ title: 'Commande annulée', variant: 'info' });
            setCancelOrderTarget(null);
            await invalidateAll();
          } finally {
            setSubmitting(false);
          }
        }}
        title="Annuler la commande fournisseur"
        description={
          cancelOrderTarget
            ? `Confirmez-vous l’annulation de la commande ${cancelOrderTarget.reference} (${cancelOrderTarget.supplierName}) ?`
            : ''
        }
        confirmLabel="Annuler la commande"
        loading={submitting}
      />
    </div>
  );
}
