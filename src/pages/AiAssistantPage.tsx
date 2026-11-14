import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bot,
  Check,
  RotateCcw,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useToast } from '../contexts/ToastContext.tsx';
import { useErpData } from '../hooks/useErpData.ts';
import { recordStockMovement } from '../services/erpService.ts';
import { createPurchaseRequest } from '../services/purchasingService.ts';
import { formatCurrency, formatNumber } from '../shared/formatters.ts';
import type {
  AiActionProposal,
  AiChatMessage,
  AiChatResponse,
  AiOrgContext,
} from '../shared/aiTypes.ts';
import { Button } from '../components/ui/Button.tsx';
import { Skeleton } from '../components/ui/Skeleton.tsx';
import { StatusText } from '../components/ui/StatusText.tsx';

const QUICK_PROMPTS = [
  'Analyse les produits en rupture ou sous seuil et propose une demande d’achat de réapprovisionnement.',
  'Quelles factures clients sont impayées ou en retard et quel est le risque de trésorerie ?',
  'Identifie les produits les plus rentables et ceux en surstock actuellement.',
  'Prépare un transfert de stock entre entrepôts pour rééquilibrer nos emplacements.',
];

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  IN: 'Entrée de stock',
  OUT: 'Sortie de stock',
  TRANSFER: 'Transfert inter-entrepôts',
  ADJUSTMENT: 'Ajustement d’inventaire',
};

function renderCleanLines(text: string) {
  return text.split('\n').map((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return <div key={idx} className="h-2" />;
    }
    const clean = trimmed.replace(/\*\*(.*?)\*\*/g, '$1');
    if (clean.startsWith('- ') || clean.startsWith('• ')) {
      return (
        <p key={idx} className="pl-3 text-sm leading-relaxed text-slate-700 dark:text-slate-200">
          · {clean.slice(2)}
        </p>
      );
    }
    if (clean.startsWith('### ') || clean.startsWith('## ')) {
      return (
        <p key={idx} className="pt-1 text-sm font-semibold text-slate-900 dark:text-white">
          {clean.replace(/^#{2,3}\s+/, '')}
        </p>
      );
    }
    return (
      <p key={idx} className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
        {clean}
      </p>
    );
  });
}

export function AiAssistantPage() {
  const { user, activeOrg, activeRole } = useAuth();
  const { toast } = useToast();
  const {
    products,
    warehouses,
    locations,
    balances,
    movements,
    suppliers,
    purchaseOrders,
    salesOrders,
    salesInvoices,
    isLoading,
    invalidateAll,
  } = useErpData();

  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const currency = activeOrg?.currency ?? 'EUR';
  const userRole = activeRole ?? 'viewer';
  const canExecute = userRole !== 'viewer';
  const memberUids = activeOrg?.memberUids ?? (user ? [user.uid] : []);

  const orgStats = useMemo(() => {
    const qtyByProd = new Map<string, number>();
    let totalValue = 0;
    for (const b of balances) {
      qtyByProd.set(b.productId, (qtyByProd.get(b.productId) ?? 0) + b.availableQty);
      totalValue += b.physicalQty * b.unitCost;
    }
    const activeProds = products.filter((p) => p.status === 'active');
    const alertsCount = activeProds.filter((p) => (qtyByProd.get(p.id) ?? 0) <= p.minStock).length;
    const unpaidInvoices = salesInvoices.filter(
      (inv) => inv.invoiceType !== 'credit_note' && inv.status !== 'paid'
    );
    const unpaidTotal = unpaidInvoices.reduce(
      (s, inv) => s + Math.max(0, inv.totalTtc - inv.paidAmount),
      0
    );
    return {
      totalValue,
      activeProductsCount: activeProds.length,
      alertsCount,
      unpaidCount: unpaidInvoices.length,
      unpaidTotal,
      warehousesCount: warehouses.filter((w) => w.status === 'active').length,
    };
  }, [balances, products, salesInvoices, warehouses]);

  const buildContextSnapshot = (): AiOrgContext => {
    return {
      orgId: activeOrg?.id ?? '',
      orgName: activeOrg?.name ?? 'Organisation',
      currency,
      userRole,
      products: products.slice(0, 350).map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        categoryName: p.categoryName || 'Non classé',
        unit: p.unit,
        purchasePrice: p.purchasePrice,
        salePrice: p.salePrice,
        minStock: p.minStock,
        maxStock: p.maxStock,
        status: p.status,
      })),
      warehouses: warehouses.slice(0, 80).map((w) => ({
        id: w.id,
        code: w.code,
        name: w.name,
        city: w.city || '',
        status: w.status,
      })),
      locations: locations.slice(0, 400).map((l) => ({
        id: l.id,
        warehouseId: l.warehouseId,
        code: l.code,
        zoneType: l.zoneType,
        capacity: l.capacity,
      })),
      balances: balances.slice(0, 600).map((b) => ({
        productId: b.productId,
        warehouseId: b.warehouseId,
        locationId: b.locationId,
        locationCode: b.locationCode,
        physicalQty: b.physicalQty,
        reservedQty: b.reservedQty,
        availableQty: b.availableQty,
        unitCost: b.unitCost,
      })),
      suppliers: suppliers.slice(0, 150).map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        leadTimeDays: s.leadTimeDays,
        rating: s.rating,
        onTimeRate: s.onTimeRate,
        status: s.status,
      })),
      openPurchaseOrders: purchaseOrders
        .filter((po) => po.status !== 'closed' && po.status !== 'canceled')
        .slice(0, 80)
        .map((po) => ({
          reference: po.reference,
          supplierName: po.supplierName,
          status: po.status,
          totalTtc: po.totalTtc,
          expectedDate: po.expectedDate,
        })),
      openSalesOrders: salesOrders
        .filter((so) => so.status !== 'closed' && so.status !== 'canceled')
        .slice(0, 80)
        .map((so) => ({
          reference: so.reference,
          customerName: so.customerName,
          status: so.status,
          totalTtc: so.totalTtc,
          expectedDeliveryDate: so.expectedDeliveryDate,
        })),
      unpaidSalesInvoices: salesInvoices
        .filter((inv) => inv.invoiceType !== 'credit_note' && inv.status !== 'paid')
        .slice(0, 100)
        .map((inv) => ({
          invoiceNumber: inv.invoiceNumber,
          customerName: inv.customerName,
          dueDate: inv.dueDate,
          totalTtc: inv.totalTtc,
          paidAmount: inv.paidAmount,
          remainingTtc: Number(Math.max(0, inv.totalTtc - inv.paidAmount).toFixed(2)),
          status: inv.status,
        })),
      recentMovements: movements.slice(0, 40).map((m) => ({
        reference: m.reference,
        movementType: m.movementType,
        productSku: m.productSku,
        warehouseName: m.warehouseName,
        quantity: m.quantity,
        reason: m.reason,
      })),
    };
  };

  const sendMessage = async (rawPrompt?: string) => {
    const prompt = (rawPrompt ?? input).trim();
    if (!prompt || sending || !user || !activeOrg) return;

    const userMsg: AiChatMessage = {
      id: `msg_u_${Date.now()}`,
      role: 'user',
      text: prompt,
      createdAt: new Date().toISOString(),
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    if (!rawPrompt) setInput('');
    setSending(true);

    try {
      const idToken = await user.getIdToken();
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          message: prompt,
          history: messages.slice(-12).map((m) => ({ role: m.role, text: m.text })),
          orgContext: buildContextSnapshot(),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Erreur serveur lors de l’appel à l’assistant IA.');
      }

      const aiPayload = data as AiChatResponse;
      const assistantMsg: AiChatMessage = {
        id: `msg_a_${Date.now()}`,
        role: 'assistant',
        text: aiPayload.reply,
        createdAt: new Date().toISOString(),
        toolTrace: aiPayload.toolTrace,
        proposals: aiPayload.proposals,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
    } catch (err) {
      const errText = err instanceof Error ? err.message : 'Erreur inconnue.';
      toast({
        variant: 'error',
        title: 'Assistant IA indisponible',
        description: errText,
      });
      setMessages((prev) => [
        ...prev,
        {
          id: `msg_err_${Date.now()}`,
          role: 'assistant',
          text: `Impossible de traiter la demande : ${errText}`,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const updateProposalState = (
    messageId: string,
    proposalId: string,
    patch: Partial<AiActionProposal>
  ) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId || !m.proposals) return m;
        return {
          ...m,
          proposals: m.proposals.map((p) =>
            p.id === proposalId ? ({ ...p, ...patch } as AiActionProposal) : p
          ),
        };
      })
    );
  };

  const handleConfirmProposal = async (messageId: string, proposal: AiActionProposal) => {
    if (!activeOrg || !user || !canExecute || proposal.status !== 'pending') return;
    setExecutingId(proposal.id);

    try {
      const actor = {
        uid: user.uid,
        email: user.email ?? 'utilisateur@stockflow.local',
        displayName: user.displayName || user.email?.split('@')[0] || 'Utilisateur',
      };

      if (proposal.kind === 'purchase_request') {
        const warehouse = warehouses.find((w) => w.id === proposal.warehouseId);
        if (!warehouse) {
          throw new Error('Entrepôt de destination introuvable dans votre espace.');
        }
        const ref = await createPurchaseRequest({
          orgId: activeOrg.id,
          memberUids,
          input: {
            title: proposal.title,
            warehouseId: warehouse.id,
            priority: proposal.priority,
            notes: proposal.notes,
            lines: proposal.lines.map((l) => ({
              productId: l.productId,
              quantity: l.quantity,
              estimatedUnitCost: l.estimatedUnitCost,
            })),
          },
          products,
          warehouse,
          actor,
        });
        await invalidateAll();
        updateProposalState(messageId, proposal.id, {
          status: 'executed',
          executedRef: ref,
        });
        toast({
          variant: 'success',
          title: 'Demande d’achat créée',
          description: `Référence ${ref} enregistrée et tracée dans le journal d’audit.`,
        });
      } else {
        const product = products.find((p) => p.id === proposal.productId);
        const warehouse = warehouses.find((w) => w.id === proposal.warehouseId);
        const location = locations.find((l) => l.id === proposal.locationId);
        if (!product || !warehouse || !location) {
          throw new Error('Produit, entrepôt ou emplacement source introuvable.');
        }
        const targetWarehouse = proposal.targetWarehouseId
          ? warehouses.find((w) => w.id === proposal.targetWarehouseId)
          : undefined;
        const targetLocation = proposal.targetLocationId
          ? locations.find((l) => l.id === proposal.targetLocationId)
          : undefined;

        const ref = await recordStockMovement({
          orgId: activeOrg.id,
          memberUids,
          input: {
            movementType: proposal.movementType,
            productId: product.id,
            warehouseId: warehouse.id,
            locationId: location.id,
            targetWarehouseId: targetWarehouse?.id ?? '',
            targetLocationId: targetLocation?.id ?? '',
            quantity: proposal.quantity,
            unitCost: proposal.unitCost,
            reason: proposal.reason,
            sourceDocumentType: 'Proposition IA validée',
            sourceDocumentRef: '',
          },
          product,
          warehouse,
          location,
          targetWarehouse,
          targetLocation,
          actor,
        });
        await invalidateAll();
        updateProposalState(messageId, proposal.id, {
          status: 'executed',
          executedRef: ref,
        });
        toast({
          variant: 'success',
          title: 'Mouvement de stock exécuté',
          description: `Référence ${ref} validée sur ${warehouse.code}.`,
        });
      }
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Échec d’exécution',
        description: err instanceof Error ? err.message : 'Impossible d’exécuter cette proposition.',
      });
    } finally {
      setExecutingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Accueil / Intelligence Opérationnelle / Assistant IA
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Assistant IA StockFlow
          </h1>
        </div>
        {messages.length > 0 && (
          <Button type="button" variant="outline" size="sm" onClick={() => setMessages([])}>
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Nouvelle conversation</span>
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <Skeleton className="lg:col-span-8 h-[520px] rounded-xl" />
          <Skeleton className="lg:col-span-4 h-[520px] rounded-xl" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Conversation & Confirmation Column */}
          <div className="lg:col-span-8 flex flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 min-h-[540px] max-h-[calc(100vh-13rem)]">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
                  <Bot className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    Analyste StockFlow — {activeOrg?.name}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Connecté aux données réelles de votre organisation ({currency})
                  </p>
                </div>
              </div>
              <StatusText tone="info" label="Validation humaine requise" />
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {messages.length === 0 ? (
                <div className="py-10 text-center max-w-lg mx-auto space-y-3">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    Posez une question sur vos stocks, achats, ventes ou trésorerie
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    L’assistant inspecte vos soldes par entrepôt, factures clients et seuils d’alerte, et peut préparer des demandes d’achat ou mouvements de stock soumis à votre confirmation explicite.
                  </p>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[90%] rounded-xl px-4 py-3 ${
                        msg.role === 'user'
                          ? 'bg-blue-600 text-white text-sm'
                          : 'border border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-950/70 space-y-1.5'
                      }`}
                    >
                      {msg.role === 'user' ? (
                        <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                      ) : (
                        <>
                          {msg.toolTrace && msg.toolTrace.length > 0 && (
                            <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 pb-1 border-b border-slate-200 dark:border-slate-800">
                              Outils consultés : {msg.toolTrace.join(' · ')}
                            </p>
                          )}
                          <div className="space-y-1">{renderCleanLines(msg.text)}</div>
                        </>
                      )}
                    </div>

                    {/* Mandatory Human Confirmation Cards for AI Action Proposals */}
                    {msg.proposals && msg.proposals.length > 0 && (
                      <div className="mt-3 w-full max-w-[92%] space-y-3">
                        {msg.proposals.map((prop) => (
                          <div
                            key={prop.id}
                            className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5 dark:border-slate-800">
                              <div>
                                <p className="text-xs font-mono text-blue-600 dark:text-blue-400">
                                  {prop.kind === 'purchase_request'
                                    ? 'Proposition de demande d’achat'
                                    : `Proposition de mouvement · ${MOVEMENT_TYPE_LABELS[prop.movementType] ?? prop.movementType}`}
                                </p>
                                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                  {prop.kind === 'purchase_request'
                                    ? prop.title
                                    : `${prop.productSku} — ${prop.productName}`}
                                </p>
                              </div>
                              <StatusText
                                tone={
                                  prop.status === 'executed'
                                    ? 'success'
                                    : prop.status === 'rejected'
                                      ? 'neutral'
                                      : 'warning'
                                }
                                label={
                                  prop.status === 'executed'
                                    ? `Exécuté (${prop.executedRef ?? 'OK'})`
                                    : prop.status === 'rejected'
                                      ? 'Refusé'
                                      : 'En attente de confirmation'
                                }
                              />
                            </div>

                            {prop.kind === 'purchase_request' ? (
                              <div className="mt-3 space-y-2 text-xs">
                                <p className="text-slate-600 dark:text-slate-300">
                                  Entrepôt : <span className="font-semibold">{prop.warehouseName}</span> · Priorité :{' '}
                                  <span className="font-semibold">
                                    {prop.priority === 'urgent' ? 'Urgente' : 'Normale'}
                                  </span>
                                </p>
                                <div className="divide-y divide-slate-100 dark:divide-slate-800 border-t border-b border-slate-100 dark:border-slate-800">
                                  {prop.lines.map((line) => (
                                    <div
                                      key={line.productId}
                                      className="flex items-center justify-between py-1.5 font-mono tabular-nums"
                                    >
                                      <span className="truncate pr-3 text-slate-800 dark:text-slate-200">
                                        {line.productSku} — {line.productName}
                                      </span>
                                      <span className="shrink-0 text-slate-600 dark:text-slate-300">
                                        {formatNumber(line.quantity)} {line.unit} ×{' '}
                                        {formatCurrency(line.estimatedUnitCost, currency)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                                <div className="flex items-center justify-between font-mono font-semibold text-slate-900 dark:text-white">
                                  <span>Montant estimé HT</span>
                                  <span>{formatCurrency(prop.totalEstimatedCost, currency)}</span>
                                </div>
                              </div>
                            ) : (
                              <div className="mt-3 space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                                <p>
                                  Quantité :{' '}
                                  <span className="font-mono font-semibold text-slate-900 dark:text-white">
                                    {formatNumber(prop.quantity)}
                                  </span>{' '}
                                  · Source :{' '}
                                  <span className="font-mono font-semibold">
                                    {prop.warehouseName} / {prop.locationCode}
                                  </span>
                                </p>
                                {prop.targetWarehouseName && (
                                  <p>
                                    Destination :{' '}
                                    <span className="font-mono font-semibold">
                                      {prop.targetWarehouseName} / {prop.targetLocationCode}
                                    </span>
                                  </p>
                                )}
                                <p>Motif : {prop.reason}</p>
                              </div>
                            )}

                            {prop.status === 'pending' && (
                              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                                {!canExecute ? (
                                  <span className="text-xs text-amber-600 dark:text-amber-400">
                                    Rôle lecteur : exécution non autorisée.
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                    Génère une écriture transactionnelle avec journal d’audit.
                                  </span>
                                )}
                                <div className="flex items-center gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={executingId === prop.id}
                                    onClick={() =>
                                      updateProposalState(msg.id, prop.id, { status: 'rejected' })
                                    }
                                  >
                                    <X className="h-3.5 w-3.5" />
                                    <span>Refuser</span>
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    disabled={!canExecute || executingId === prop.id}
                                    onClick={() => handleConfirmProposal(msg.id, prop)}
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                    <span>
                                      {executingId === prop.id
                                        ? 'Exécution...'
                                        : 'Confirmer et exécuter'}
                                    </span>
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}

              {sending && (
                <div className="flex items-start">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                    Analyse des données de l’organisation en cours...
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Composer */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendMessage();
              }}
              className="border-t border-slate-200 p-3.5 dark:border-slate-800"
            >
              <div className="flex items-end gap-2.5">
                <textarea
                  rows={2}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void sendMessage();
                    }
                  }}
                  placeholder="Demandez une analyse de rupture, un état des impayés ou une proposition de réapprovisionnement..."
                  className="flex-1 resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
                <Button type="submit" disabled={sending || !input.trim()}>
                  <Send className="h-4 w-4" />
                  <span>Envoyer</span>
                </Button>
              </div>
            </form>
          </div>

          {/* Right Context & Starters Rail */}
          <aside className="lg:col-span-4 space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-3">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Périmètre analysé en temps réel
              </h2>
              <div className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
                <div className="flex items-center justify-between py-2">
                  <span className="text-slate-500 dark:text-slate-400">Valeur stock</span>
                  <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                    {formatCurrency(orgStats.totalValue, currency)}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-slate-500 dark:text-slate-400">Produits actifs</span>
                  <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                    {orgStats.activeProductsCount}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-slate-500 dark:text-slate-400">Alertes rupture / seuil</span>
                  <span className="font-mono font-semibold tabular-nums text-red-600 dark:text-red-400">
                    {orgStats.alertsCount}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-slate-500 dark:text-slate-400">Factures clients impayées</span>
                  <span className="font-mono font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                    {orgStats.unpaidCount} · {formatCurrency(orgStats.unpaidTotal, currency)}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-slate-500 dark:text-slate-400">Entrepôts actifs</span>
                  <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                    {orgStats.warehousesCount}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-2.5">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Analyses rapides suggérées
              </h2>
              <div className="space-y-2">
                {QUICK_PROMPTS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={sending}
                    onClick={() => void sendMessage(q)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 flex items-start gap-3">
              <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
              <div className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                <p className="font-semibold text-slate-900 dark:text-white">
                  Gouvernance &amp; sécurité multi-tenant
                </p>
                <p className="mt-0.5">
                  Aucune modification de stock ou création de commande n’est exécutée automatiquement. Chaque action proposée nécessite votre validation explicite.
                </p>
                <Link
                  to="/rapports"
                  className="mt-2 inline-block font-medium text-blue-600 hover:underline dark:text-blue-400"
                >
                  Ouvrir les rapports détaillés →
                </Link>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
