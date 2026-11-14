import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase.ts';
import { handleFirestoreError, OperationType } from '../lib/firestoreError.ts';
import { generateSafeId, toDate } from '../shared/formatters.ts';
import type {
  CustomerInput,
  PaymentInput,
  QuoteInput,
  SalesInvoiceInput,
  SalesOrderInput,
} from '../shared/schemas.ts';
import type {
  Customer,
  DeliveryNote,
  DeliveryNoteLine,
  Payment,
  Product,
  Quote,
  SalesInvoice,
  SalesInvoiceType,
  SalesLine,
  SalesOrder,
  SalesOrderLine,
  StockBalance,
  SupplierInvoice,
  Warehouse,
  WarehouseLocation,
} from '../shared/types.ts';

// ---------------------------------------------------------------------------
// Queries (client-side sort to avoid composite index requirements)
// ---------------------------------------------------------------------------
export async function listCustomers(orgId: string, uid: string): Promise<Customer[]> {
  const path = `organizations/${orgId}/customers`;
  try {
    const q = query(
      collection(db, 'organizations', orgId, 'customers'),
      where('memberUids', 'array-contains', uid)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as Customer).sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listQuotes(orgId: string, uid: string): Promise<Quote[]> {
  const path = `organizations/${orgId}/quotes`;
  try {
    const q = query(
      collection(db, 'organizations', orgId, 'quotes'),
      where('memberUids', 'array-contains', uid)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as Quote)
      .sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listSalesOrders(orgId: string, uid: string): Promise<SalesOrder[]> {
  const path = `organizations/${orgId}/salesOrders`;
  try {
    const q = query(
      collection(db, 'organizations', orgId, 'salesOrders'),
      where('memberUids', 'array-contains', uid)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as SalesOrder)
      .sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listDeliveryNotes(orgId: string, uid: string): Promise<DeliveryNote[]> {
  const path = `organizations/${orgId}/deliveryNotes`;
  try {
    const q = query(
      collection(db, 'organizations', orgId, 'deliveryNotes'),
      where('memberUids', 'array-contains', uid)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as DeliveryNote)
      .sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listSalesInvoices(orgId: string, uid: string): Promise<SalesInvoice[]> {
  const path = `organizations/${orgId}/salesInvoices`;
  try {
    const q = query(
      collection(db, 'organizations', orgId, 'salesInvoices'),
      where('memberUids', 'array-contains', uid)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as SalesInvoice)
      .sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listPayments(orgId: string, uid: string): Promise<Payment[]> {
  const path = `organizations/${orgId}/payments`;
  try {
    const q = query(
      collection(db, 'organizations', orgId, 'payments'),
      where('memberUids', 'array-contains', uid)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as Payment)
      .sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

// ---------------------------------------------------------------------------
// Totals Helper
// ---------------------------------------------------------------------------
export function computeSalesTotals(lines: SalesLine[], shippingCost: number) {
  let subtotalHt = 0;
  let vatTotal = 0;
  for (const l of lines) {
    const netLine = l.quantity * l.unitPrice * (1 - l.discountPct / 100);
    subtotalHt += netLine;
    vatTotal += netLine * (l.vatRate / 100);
  }
  const ship = Number(shippingCost || 0);
  const shipVat = ship * 0.2;
  const finalHt = Number((subtotalHt + ship).toFixed(2));
  const finalVat = Number((vatTotal + shipVat).toFixed(2));
  const totalTtc = Number((finalHt + finalVat).toFixed(2));
  return { subtotalHt: finalHt, vatTotal: finalVat, totalTtc };
}

// ---------------------------------------------------------------------------
// Customers CRUD
// ---------------------------------------------------------------------------
export async function createCustomer(
  orgId: string,
  memberUids: string[],
  input: CustomerInput,
  actor: { uid: string; email: string }
): Promise<string> {
  const id = generateSafeId('cust');
  const path = `organizations/${orgId}/customers/${id}`;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'organizations', orgId, 'customers', id), {
      id,
      orgId,
      code: input.code.toUpperCase(),
      type: input.type,
      name: input.name,
      contactName: input.contactName || '',
      email: input.email || '',
      phone: input.phone || '',
      billingAddress: input.billingAddress || '',
      shippingAddress: input.shippingAddress || input.billingAddress || '',
      city: input.city || '',
      country: input.country || 'France',
      siret: input.siret || '',
      vatNumber: input.vatNumber || '',
      paymentTerms: input.paymentTerms,
      creditLimit: Number(input.creditLimit),
      status: input.status,
      notes: input.notes || '',
      isDemo: false,
      memberUids,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const logId = generateSafeId('log');
    batch.set(doc(db, 'organizations', orgId, 'auditLogs', logId), {
      id: logId,
      orgId,
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: 'CUSTOMER_CREATED',
      entityType: 'customer',
      entityId: id,
      summary: `Création du client ${input.code.toUpperCase()} (${input.type}) — ${input.name}`,
      memberUids,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateCustomer(
  orgId: string,
  customerId: string,
  input: CustomerInput
): Promise<void> {
  const path = `organizations/${orgId}/customers/${customerId}`;
  try {
    await updateDoc(doc(db, 'organizations', orgId, 'customers', customerId), {
      code: input.code.toUpperCase(),
      type: input.type,
      name: input.name,
      contactName: input.contactName || '',
      email: input.email || '',
      phone: input.phone || '',
      billingAddress: input.billingAddress || '',
      shippingAddress: input.shippingAddress || input.billingAddress || '',
      city: input.city || '',
      country: input.country || 'France',
      siret: input.siret || '',
      vatNumber: input.vatNumber || '',
      paymentTerms: input.paymentTerms,
      creditLimit: Number(input.creditLimit),
      status: input.status,
      notes: input.notes || '',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteCustomer(orgId: string, customerId: string): Promise<void> {
  const path = `organizations/${orgId}/customers/${customerId}`;
  try {
    await deleteDoc(doc(db, 'organizations', orgId, 'customers', customerId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------
export async function createQuote(params: {
  orgId: string;
  memberUids: string[];
  input: QuoteInput;
  products: Product[];
  customer: Customer;
  warehouse: Warehouse;
  actor: { uid: string; email: string; displayName: string };
  sendImmediately?: boolean;
}): Promise<{ id: string; reference: string }> {
  const {
    orgId,
    memberUids,
    input,
    products,
    customer,
    warehouse,
    actor,
    sendImmediately = false,
  } = params;
  const id = generateSafeId('qt');
  const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const reference = `DEV-${nowStr}-${id.slice(-4).toUpperCase()}`;
  const productMap = new Map(products.map((p) => [p.id, p]));

  const lines: SalesLine[] = input.lines.map((l) => {
    const p = productMap.get(l.productId);
    return {
      productId: l.productId,
      productSku: p?.sku ?? 'SKU',
      productName: p?.name ?? 'Produit',
      unit: p?.unit ?? 'unité',
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      discountPct: Number(l.discountPct),
      vatRate: Number(l.vatRate),
    };
  });

  const totals = computeSalesTotals(lines, Number(input.shippingCost));
  const path = `organizations/${orgId}/quotes/${id}`;

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'organizations', orgId, 'quotes', id), {
      id,
      orgId,
      reference,
      customerId: customer.id,
      customerName: customer.name,
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      status: sendImmediately ? 'sent' : 'draft',
      validUntil: input.validUntil,
      paymentTerms: input.paymentTerms || customer.paymentTerms,
      shippingCost: Number(input.shippingCost || 0),
      subtotalHt: totals.subtotalHt,
      vatTotal: totals.vatTotal,
      totalTtc: totals.totalTtc,
      lines,
      notes: input.notes || '',
      createdByUid: actor.uid,
      createdByName: actor.displayName,
      isDemo: false,
      memberUids,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const logId = generateSafeId('log');
    batch.set(doc(db, 'organizations', orgId, 'auditLogs', logId), {
      id: logId,
      orgId,
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: 'QUOTE_CREATED',
      entityType: 'quote',
      entityId: id,
      summary: `Devis ${reference} (${customer.name}) — ${totals.totalTtc.toFixed(2)} TTC`,
      memberUids,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    return { id, reference };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateQuoteStatus(
  orgId: string,
  quoteId: string,
  status: Quote['status']
): Promise<void> {
  const path = `organizations/${orgId}/quotes/${quoteId}`;
  try {
    await updateDoc(doc(db, 'organizations', orgId, 'quotes', quoteId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// ---------------------------------------------------------------------------
// Sales Orders & Atomic Stock Reservation
// ---------------------------------------------------------------------------
export async function createSalesOrder(params: {
  orgId: string;
  memberUids: string[];
  input: SalesOrderInput;
  products: Product[];
  customer: Customer;
  warehouse: Warehouse;
  actor: { uid: string; email: string; displayName: string };
  quoteId?: string;
  confirmImmediately?: boolean;
}): Promise<{ id: string; reference: string }> {
  const {
    orgId,
    memberUids,
    input,
    products,
    customer,
    warehouse,
    actor,
    quoteId,
    confirmImmediately = true,
  } = params;

  const id = generateSafeId('so');
  const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const reference = `CC-${nowStr}-${id.slice(-4).toUpperCase()}`;
  const productMap = new Map(products.map((p) => [p.id, p]));

  const lines: SalesOrderLine[] = input.lines.map((l) => {
    const p = productMap.get(l.productId);
    return {
      productId: l.productId,
      productSku: p?.sku ?? 'SKU',
      productName: p?.name ?? 'Produit',
      unit: p?.unit ?? 'unité',
      quantity: Number(l.quantity),
      reservedQty: 0,
      deliveredQty: 0,
      unitPrice: Number(l.unitPrice),
      discountPct: Number(l.discountPct),
      vatRate: Number(l.vatRate),
    };
  });

  const totals = computeSalesTotals(lines, Number(input.shippingCost));
  const path = `organizations/${orgId}/salesOrders/${id}`;

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'organizations', orgId, 'salesOrders', id), {
      id,
      orgId,
      reference,
      ...(quoteId ? { quoteId } : {}),
      customerId: customer.id,
      customerName: customer.name,
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      status: confirmImmediately ? 'confirmed' : 'draft',
      stockReserved: false,
      expectedDeliveryDate: input.expectedDeliveryDate || '',
      paymentTerms: input.paymentTerms || customer.paymentTerms,
      shippingCost: Number(input.shippingCost || 0),
      subtotalHt: totals.subtotalHt,
      vatTotal: totals.vatTotal,
      totalTtc: totals.totalTtc,
      lines,
      notes: input.notes || '',
      createdByUid: actor.uid,
      createdByName: actor.displayName,
      isDemo: false,
      memberUids,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (quoteId) {
      batch.update(doc(db, 'organizations', orgId, 'quotes', quoteId), {
        status: 'converted',
        convertedOrderId: id,
        updatedAt: serverTimestamp(),
      });
    }

    const logId = generateSafeId('log');
    batch.set(doc(db, 'organizations', orgId, 'auditLogs', logId), {
      id: logId,
      orgId,
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: 'SALES_ORDER_CREATED',
      entityType: 'sales_order',
      entityId: id,
      summary: `Commande client ${reference} (${customer.name}) — ${totals.totalTtc.toFixed(2)} TTC`,
      memberUids,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
    return { id, reference };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function reserveSalesOrderStock(params: {
  orgId: string;
  memberUids: string[];
  order: SalesOrder;
  balances: StockBalance[];
  actor: { uid: string; email: string };
}): Promise<void> {
  const { orgId, memberUids, order, balances, actor } = params;
  const path = `organizations/${orgId}/salesOrders/${order.id}`;
  const candidateBalances = balances.filter((b) =>
    b.warehouseId === order.warehouseId && order.lines.some((line) => line.productId === b.productId)
  );

  try {
    await runTransaction(db, async (tx) => {
      const soRef = doc(db, 'organizations', orgId, 'salesOrders', order.id);
      const soSnap = await tx.get(soRef);
      if (!soSnap.exists()) throw new Error('Commande client introuvable.');
      const freshOrder = soSnap.data() as SalesOrder;
      if (['canceled', 'closed', 'delivered', 'invoiced'].includes(freshOrder.status)) {
        throw new Error('Impossible de réserver du stock pour cette commande.');
      }

      const uniqueBalanceIds = Array.from(new Set(candidateBalances.map((balance) => balance.id)));
      const balanceRefs = uniqueBalanceIds.map((id) => doc(db, 'organizations', orgId, 'stockBalances', id));
      const balanceSnaps = await Promise.all(balanceRefs.map((ref) => tx.get(ref)));
      const balanceMap = new Map<string, { ref: (typeof balanceRefs)[number]; data: StockBalance }>();
      balanceSnaps.forEach((snap, index) => {
        if (snap.exists()) balanceMap.set(uniqueBalanceIds[index], { ref: balanceRefs[index], data: snap.data() as StockBalance });
      });

      const updatedLines = freshOrder.lines.map((line) => ({
        ...line,
        reservationAllocations: [...(line.reservationAllocations ?? [])],
      }));
      const deltas = new Map<string, { ref: (typeof balanceRefs)[number]; data: StockBalance; add: number }>();

      for (const line of updatedLines) {
        const needed = Math.max(0, line.quantity - line.deliveredQty - line.reservedQty);
        if (needed <= 0) continue;
        let remaining = Number(needed.toFixed(3));
        const matching = Array.from(balanceMap.values()).filter((entry) => entry.data.productId === line.productId);
        for (const entry of matching) {
          const existingDelta = deltas.get(entry.data.id);
          const alreadyAllocated = existingDelta?.add ?? 0;
          const free = Math.max(0, entry.data.availableQty - alreadyAllocated);
          if (free <= 0) continue;
          const take = Number(Math.min(free, remaining).toFixed(3));
          if (take <= 0) continue;
          deltas.set(entry.data.id, { ...entry, add: alreadyAllocated + take });
          const existingAllocation = line.reservationAllocations!.find(
            (allocation) => allocation.warehouseId === entry.data.warehouseId && allocation.locationId === entry.data.locationId
          );
          if (existingAllocation) existingAllocation.quantity = Number((existingAllocation.quantity + take).toFixed(3));
          else line.reservationAllocations!.push({
            warehouseId: entry.data.warehouseId,
            locationId: entry.data.locationId,
            quantity: take,
          });
          line.reservedQty = Number((line.reservedQty + take).toFixed(3));
          remaining = Number((remaining - take).toFixed(3));
          if (remaining <= 0.0001) break;
        }
        if (remaining > 0.0001) {
          throw new Error(`Stock disponible insuffisant dans ${freshOrder.warehouseName} pour réserver ${line.productSku} (manque ${remaining}).`);
        }
      }

      for (const { ref, data, add } of deltas.values()) {
        const reservedQty = Number((data.reservedQty + add).toFixed(3));
        tx.update(ref, {
          reservedQty,
          availableQty: Number(Math.max(0, data.physicalQty - reservedQty).toFixed(3)),
          updatedAt: serverTimestamp(),
        });
      }

      tx.update(soRef, {
        lines: updatedLines,
        stockReserved: updatedLines.some((line) => line.reservedQty > 0),
        status: freshOrder.status === 'draft' ? 'confirmed' : 'preparing',
        updatedAt: serverTimestamp(),
      });
      const logId = generateSafeId('log');
      tx.set(doc(db, 'organizations', orgId, 'auditLogs', logId), {
        id: logId, orgId, actorUid: actor.uid, actorEmail: actor.email,
        action: 'SALES_ORDER_STOCK_RESERVED', entityType: 'sales_order', entityId: freshOrder.id,
        summary: `Réservation atomique et ventilée par emplacement pour la commande ${freshOrder.reference}`,
        memberUids, createdAt: serverTimestamp(),
      });
    });
  } catch (error) {
    if (error instanceof Error && (error.message.includes('Stock') || error.message.includes('Commande') || error.message.includes('Impossible'))) throw error;
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function cancelSalesOrder(params: {
  orgId: string;
  memberUids: string[];
  order: SalesOrder;
  balances: StockBalance[];
  actor: { uid: string; email: string };
}): Promise<void> {
  const { orgId, memberUids, order, actor } = params;
  const path = `organizations/${orgId}/salesOrders/${order.id}`;

  try {
    await runTransaction(db, async (tx) => {
      const soRef = doc(db, 'organizations', orgId, 'salesOrders', order.id);
      const soSnap = await tx.get(soRef);
      if (!soSnap.exists()) throw new Error('Commande client introuvable.');
      const freshOrder = soSnap.data() as SalesOrder;
      if (freshOrder.status === 'closed' || freshOrder.status === 'canceled') {
        throw new Error('Commande déjà clôturée ou annulée.');
      }

      const allocations = freshOrder.lines.flatMap((line) =>
        (line.reservationAllocations ?? []).filter((allocation) => allocation.quantity > 0).map((allocation) => ({
          productId: line.productId,
          allocation,
        }))
      );
      if (freshOrder.lines.some((line) => line.reservedQty > 0 && !(line.reservationAllocations?.length))) {
        throw new Error('Réservation historique sans détail par emplacement : réconciliation nécessaire avant annulation.');
      }

      const grouped = new Map<string, { productId: string; warehouseId: string; locationId: string; quantity: number }>();
      for (const item of allocations) {
        const key = `${item.productId}_${item.allocation.warehouseId}_${item.allocation.locationId}`;
        const current = grouped.get(key);
        if (current) current.quantity = Number((current.quantity + item.allocation.quantity).toFixed(3));
        else grouped.set(key, {
          productId: item.productId,
          warehouseId: item.allocation.warehouseId,
          locationId: item.allocation.locationId,
          quantity: item.allocation.quantity,
        });
      }

      const refs = Array.from(grouped.entries()).map(([id]) => ({
        id,
        ref: doc(db, 'organizations', orgId, 'stockBalances', id),
      }));
      const snaps = await Promise.all(refs.map((entry) => tx.get(entry.ref)));
      const writes: Array<{ ref: (typeof refs)[number]['ref']; reservedQty: number; physicalQty: number }> = [];
      for (let index = 0; index < refs.length; index++) {
        const group = grouped.get(refs[index].id)!;
        const snap = snaps[index];
        if (!snap.exists()) throw new Error('Solde de stock introuvable pour libérer une réservation.');
        const balance = snap.data() as StockBalance;
        if (balance.reservedQty + 0.0001 < group.quantity) {
          throw new Error(`Réservation incohérente pour ${balance.productSku} sur ${balance.locationCode}.`);
        }
        writes.push({
          ref: refs[index].ref,
          reservedQty: Number((balance.reservedQty - group.quantity).toFixed(3)),
          physicalQty: balance.physicalQty,
        });
      }

      for (const write of writes) {
        tx.update(write.ref, {
          reservedQty: write.reservedQty,
          availableQty: Number(Math.max(0, write.physicalQty - write.reservedQty).toFixed(3)),
          updatedAt: serverTimestamp(),
        });
      }
      const updatedLines = freshOrder.lines.map((line) => ({
        ...line,
        reservedQty: 0,
        reservationAllocations: [],
      }));
      tx.update(soRef, { lines: updatedLines, stockReserved: false, status: 'canceled', updatedAt: serverTimestamp() });
      const logId = generateSafeId('log');
      tx.set(doc(db, 'organizations', orgId, 'auditLogs', logId), {
        id: logId, orgId, actorUid: actor.uid, actorEmail: actor.email,
        action: 'SALES_ORDER_CANCELED', entityType: 'sales_order', entityId: freshOrder.id,
        summary: `Annulation commande ${freshOrder.reference} (réservations exactes libérées par emplacement)`,
        memberUids, createdAt: serverTimestamp(),
      });
    });
  } catch (error) {
    if (error instanceof Error && (error.message.includes('Commande') || error.message.includes('Réservation') || error.message.includes('réservation') || error.message.includes('Solde'))) throw error;
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// ---------------------------------------------------------------------------
// Delivery Note -> Atomic Stock Exit (OUT)
// ---------------------------------------------------------------------------
export interface DeliveryInputLine {
  productId: string;
  locationId: string;
  deliveredQty: number;
}

export async function shipSalesOrder(params: {
  orgId: string;
  memberUids: string[];
  order: SalesOrder;
  warehouse: Warehouse;
  locations: WarehouseLocation[];
  linesInput: DeliveryInputLine[];
  carrier?: string;
  trackingNumber?: string;
  notes?: string;
  actor: { uid: string; email: string; displayName: string };
}): Promise<string> {
  const { orgId, memberUids, order, warehouse, locations, linesInput, carrier, trackingNumber, notes, actor } = params;
  const activeLines = linesInput.filter((line) => line.deliveredQty > 0);
  if (!activeLines.length) throw new Error('Saisissez au moins une quantité à expédier supérieure à 0.');
  const lineKeys = activeLines.map((line) => `${line.productId}_${line.locationId}`);
  if (new Set(lineKeys).size !== lineKeys.length) throw new Error('Une seule ligne de livraison est autorisée par produit et emplacement.');
  if (activeLines.some((line) => !Number.isFinite(line.deliveredQty) || line.deliveredQty <= 0)) {
    throw new Error('Les quantités expédiées doivent être des nombres positifs.');
  }

  const locMap = new Map(locations.map((location) => [location.id, location]));
  const deliveryId = generateSafeId('dn');
  const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const deliveryRef = `BL-${nowStr}-${deliveryId.slice(-4).toUpperCase()}`;
  const path = `organizations/${orgId}/deliveryNotes/${deliveryId}`;

  try {
    await runTransaction(db, async (tx) => {
      const soRef = doc(db, 'organizations', orgId, 'salesOrders', order.id);
      const soSnap = await tx.get(soRef);
      if (!soSnap.exists()) throw new Error('Commande client introuvable.');
      const freshOrder = soSnap.data() as SalesOrder;
      if (['canceled', 'closed', 'invoiced', 'delivered'].includes(freshOrder.status)) {
        throw new Error('Impossible d’expédier une commande clôturée, annulée, facturée ou déjà livrée.');
      }
      if (freshOrder.warehouseId !== warehouse.id) throw new Error('Entrepôt de livraison différent de celui de la commande.');

      const balanceReads = await Promise.all(activeLines.map(async (line) => {
        const balanceId = `${line.productId}_${warehouse.id}_${line.locationId}`;
        const balanceRef = doc(db, 'organizations', orgId, 'stockBalances', balanceId);
        return { line, balanceId, balanceRef, snapshot: await tx.get(balanceRef) };
      }));

      const updatedOrderLines = freshOrder.lines.map((line) => ({
        ...line,
        reservationAllocations: [...(line.reservationAllocations ?? [])],
      }));
      const deliveryLines: DeliveryNoteLine[] = [];
      const balanceWrites: Array<{
        ref: (typeof balanceReads)[number]['balanceRef'];
        nextPhysical: number;
        nextReserved: number;
        nextAvailable: number;
        movementId: string;
        line: DeliveryInputLine;
        sku: string;
        name: string;
        unitCost: number;
        locationCode: string;
      }> = [];

      for (const { line, snapshot, balanceRef } of balanceReads) {
        const orderLine = updatedOrderLines.find((item) => item.productId === line.productId);
        if (!orderLine) throw new Error(`Produit ${line.productId} absent de la commande.`);
        const remaining = Math.max(0, orderLine.quantity - orderLine.deliveredQty);
        if (line.deliveredQty > remaining + 0.0001) throw new Error(`Quantité expédiée supérieure au reliquat pour ${orderLine.productSku}.`);
        if (!snapshot.exists()) throw new Error(`Aucun stock trouvé pour ${orderLine.productSku}.`);
        const balance = snapshot.data() as StockBalance;
        const location = locMap.get(line.locationId);
        if (!location || location.warehouseId !== warehouse.id) throw new Error('Emplacement source invalide.');

        const allocation = orderLine.reservationAllocations?.find(
          (item) => item.warehouseId === warehouse.id && item.locationId === line.locationId
        );
        const allocatedHere = allocation?.quantity ?? 0;
        if (orderLine.reservedQty > 0 && !orderLine.reservationAllocations?.length) {
          throw new Error(`Réservation historique non ventilée pour ${orderLine.productSku} : réconciliez la commande avant expédition.`);
        }
        const usable = Number((balance.availableQty + allocatedHere).toFixed(3));
        if (line.deliveredQty > usable + 0.0001) {
          throw new Error(`Stock disponible insuffisant sur ${location.code} pour ${orderLine.productSku} (disponible pour cette commande : ${usable}).`);
        }

        const consumeReservation = Math.min(allocatedHere, line.deliveredQty);
        if (allocation && consumeReservation > 0) {
          allocation.quantity = Number((allocation.quantity - consumeReservation).toFixed(3));
        }
        orderLine.reservationAllocations = (orderLine.reservationAllocations ?? []).filter((item) => item.quantity > 0.0001);
        orderLine.reservedQty = Number(Math.max(0, orderLine.reservedQty - consumeReservation).toFixed(3));
        orderLine.deliveredQty = Number((orderLine.deliveredQty + line.deliveredQty).toFixed(3));

        const nextPhysical = Number((balance.physicalQty - line.deliveredQty).toFixed(3));
        const nextReserved = Number((balance.reservedQty - consumeReservation).toFixed(3));
        if (nextPhysical < nextReserved - 0.0001 || nextPhysical < -0.0001) {
          throw new Error(`La livraison ferait passer le stock physique sous les réservations restantes pour ${orderLine.productSku}.`);
        }
        const movementId = generateSafeId('mvt');
        balanceWrites.push({
          ref: balanceRef,
          nextPhysical: Math.max(0, nextPhysical),
          nextReserved: Math.max(0, nextReserved),
          nextAvailable: Number(Math.max(0, nextPhysical - nextReserved).toFixed(3)),
          movementId,
          line,
          sku: orderLine.productSku,
          name: orderLine.productName,
          unitCost: balance.unitCost,
          locationCode: location.code,
        });
        deliveryLines.push({
          productId: orderLine.productId,
          productSku: orderLine.productSku,
          productName: orderLine.productName,
          locationId: location.id,
          locationCode: location.code,
          deliveredQty: line.deliveredQty,
          unitCost: balance.unitCost,
        });
      }

      const allDelivered = updatedOrderLines.every((line) => line.deliveredQty >= line.quantity - 0.0001);
      const anyDelivered = updatedOrderLines.some((line) => line.deliveredQty > 0);
      const stillReserved = updatedOrderLines.some((line) => line.reservedQty > 0.0001);
      const nextStatus: SalesOrder['status'] = allDelivered ? 'delivered' : anyDelivered ? 'partially_delivered' : freshOrder.status;

      tx.set(doc(db, 'organizations', orgId, 'deliveryNotes', deliveryId), {
        id: deliveryId, orgId, reference: deliveryRef,
        salesOrderId: freshOrder.id, salesOrderRef: freshOrder.reference,
        customerId: freshOrder.customerId, customerName: freshOrder.customerName,
        warehouseId: warehouse.id, warehouseName: warehouse.name,
        carrier: carrier || '', trackingNumber: trackingNumber || '', notes: notes || '',
        lines: deliveryLines, deliveredByUid: actor.uid, deliveredByName: actor.displayName,
        memberUids, createdAt: serverTimestamp(),
      });
      tx.update(soRef, {
        lines: updatedOrderLines, stockReserved: stillReserved,
        status: nextStatus, updatedAt: serverTimestamp(),
      });

      for (let index = 0; index < balanceWrites.length; index++) {
        const write = balanceWrites[index];
        const deliveryLine = deliveryLines[index];
        tx.update(write.ref, {
          physicalQty: write.nextPhysical,
          reservedQty: write.nextReserved,
          availableQty: write.nextAvailable,
          lastMovementId: write.movementId,
          updatedAt: serverTimestamp(),
        });
        tx.set(doc(db, 'organizations', orgId, 'stockMovements', write.movementId), {
          id: write.movementId, orgId,
          reference: `MVT-${nowStr}-${write.movementId.slice(-5).toUpperCase()}`,
          movementType: 'OUT',
          productId: deliveryLine.productId, productSku: deliveryLine.productSku, productName: deliveryLine.productName,
          warehouseId: warehouse.id, warehouseName: warehouse.name,
          locationId: deliveryLine.locationId, locationCode: deliveryLine.locationCode,
          quantity: -deliveryLine.deliveredQty, unitCost: deliveryLine.unitCost,
          reason: `Expédition commande ${freshOrder.reference} (${freshOrder.customerName})`,
          sourceDocumentType: 'Bon de livraison client', sourceDocumentRef: deliveryRef,
          performedByUid: actor.uid, performedByName: actor.displayName,
          isDemo: false, memberUids, createdAt: serverTimestamp(),
        });
      }

      const logId = generateSafeId('log');
      tx.set(doc(db, 'organizations', orgId, 'auditLogs', logId), {
        id: logId, orgId, actorUid: actor.uid, actorEmail: actor.email,
        action: 'DELIVERY_NOTE_SHIPPED', entityType: 'delivery_note', entityId: deliveryId,
        summary: `Bon de livraison ${deliveryRef} sur commande ${freshOrder.reference}`,
        memberUids, createdAt: serverTimestamp(),
      });
    });
    return deliveryRef;
  } catch (error) {
    if (error instanceof Error && (
      error.message.includes('Quantité') || error.message.includes('Stock') ||
      error.message.includes('stock') || error.message.includes('Commande') ||
      error.message.includes('Emplacement') || error.message.includes('Réservation') ||
      error.message.includes('réservation') || error.message.includes('livraison')
    )) throw error;
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// ---------------------------------------------------------------------------
// Sequential French-Compliant Customer Invoices & Credit Notes
// ---------------------------------------------------------------------------
export function getNextInvoiceSequence(
  existingInvoices: SalesInvoice[],
  invoiceType: SalesInvoiceType
): { sequenceNumber: number; invoiceNumber: string } {
  const year = new Date().getFullYear();
  const prefix =
    invoiceType === 'credit_note' ? 'AV' : invoiceType === 'deposit' ? 'ACP' : 'FAC';
  const sameTypeYear = existingInvoices.filter(
    (inv) => inv.invoiceType === invoiceType && inv.invoiceNumber.includes(`-${year}-`)
  );
  const maxSeq = sameTypeYear.reduce((max, inv) => Math.max(max, inv.sequenceNumber), 0);
  const sequenceNumber = maxSeq + 1;
  const invoiceNumber = `${prefix}-${year}-${String(sequenceNumber).padStart(5, '0')}`;
  return { sequenceNumber, invoiceNumber };
}

export async function createSalesInvoice(params: {
  orgId: string;
  memberUids: string[];
  existingInvoices: SalesInvoice[];
  input: SalesInvoiceInput;
  products: Product[];
  customer: Customer;
  linkedOrder?: SalesOrder;
  relatedInvoiceId?: string;
  actor: { uid: string; email: string; displayName: string };
}): Promise<{ id: string; invoiceNumber: string }> {
  const { orgId, memberUids, input, products, customer, linkedOrder, relatedInvoiceId, actor } = params;
  const id = generateSafeId('inv');
  const issueYear = Number(input.issueDate.slice(0, 4));
  if (!Number.isInteger(issueYear) || issueYear < 2000 || issueYear > 2100) {
    throw new Error('Année de facture invalide.');
  }
  const prefix = input.invoiceType === 'credit_note' ? 'AV' : input.invoiceType === 'deposit' ? 'ACP' : 'FAC';
  const productMap = new Map(products.map((product) => [product.id, product]));
  const lines: SalesLine[] = input.lines.map((line) => {
    const product = productMap.get(line.productId);
    if (!product) throw new Error(`Produit introuvable dans le catalogue : ${line.productId}.`);
    if (product.status !== 'active') throw new Error(`Le produit ${product.sku} n’est pas actif.`);
    return {
      productId: product.id,
      productSku: product.sku,
      productName: product.name,
      unit: product.unit,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
      discountPct: Number(line.discountPct),
      vatRate: Number(line.vatRate),
    };
  });
  const totals = computeSalesTotals(lines, Number(input.shippingCost));
  const fullAddress = [customer.billingAddress, customer.city, customer.country].filter(Boolean).join(', ');
  const path = `organizations/${orgId}/salesInvoices/${id}`;
  const counterId = `sequence_${issueYear}_${input.invoiceType}`;

  try {
    const invoiceNumber = await runTransaction(db, async (tx) => {
      const counterRef = doc(db, 'organizations', orgId, 'invoiceCounters', counterId);
      const counterSnap = await tx.get(counterRef);
      const sequenceNumber = counterSnap.exists()
        ? Number(counterSnap.data().sequenceNumber || 0) + 1
        : 1;
      const nextInvoiceNumber = `${prefix}-${issueYear}-${String(sequenceNumber).padStart(5, '0')}`;

      tx.set(counterRef, {
        id: counterId,
        orgId,
        year: issueYear,
        invoiceType: input.invoiceType,
        sequenceNumber,
        createdByUid: counterSnap.exists() ? counterSnap.data().createdByUid : actor.uid,
        createdAt: counterSnap.exists() ? counterSnap.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      tx.set(doc(db, 'organizations', orgId, 'salesInvoices', id), {
        id, orgId, invoiceNumber: nextInvoiceNumber, invoiceType: input.invoiceType, sequenceNumber,
        ...(linkedOrder ? { salesOrderId: linkedOrder.id, salesOrderRef: linkedOrder.reference } : {}),
        customerId: customer.id, customerName: customer.name,
        customerSiret: customer.siret || '', customerVatNumber: customer.vatNumber || '',
        customerAddress: fullAddress,
        issueDate: input.issueDate, dueDate: input.dueDate,
        shippingCost: Number(input.shippingCost || 0),
        totalHt: totals.subtotalHt, totalVat: totals.vatTotal, totalTtc: totals.totalTtc,
        paidAmount: 0, status: 'issued', lines,
        ...(relatedInvoiceId ? { relatedInvoiceId } : {}),
        notes: input.notes || '', createdByUid: actor.uid, createdByName: actor.displayName,
        isDemo: false, memberUids, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });

      if (
        linkedOrder && input.invoiceType === 'invoice' &&
        ['delivered', 'partially_delivered', 'confirmed'].includes(linkedOrder.status)
      ) {
        tx.update(doc(db, 'organizations', orgId, 'salesOrders', linkedOrder.id), {
          status: 'invoiced', updatedAt: serverTimestamp(),
        });
      }

      const logId = generateSafeId('log');
      tx.set(doc(db, 'organizations', orgId, 'auditLogs', logId), {
        id: logId, orgId, actorUid: actor.uid, actorEmail: actor.email,
        action: input.invoiceType === 'credit_note' ? 'CREDIT_NOTE_ISSUED' : 'SALES_INVOICE_ISSUED',
        entityType: 'sales_invoice', entityId: id,
        summary: `${nextInvoiceNumber} (${customer.name}) — ${totals.totalTtc.toFixed(2)} TTC`,
        memberUids, createdAt: serverTimestamp(),
      });
      return nextInvoiceNumber;
    });
    return { id, invoiceNumber };
  } catch (error) {
    if (error instanceof Error && (error.message.includes('introuvable') || error.message.includes('Année') || error.message.includes('actif'))) throw error;
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

// ---------------------------------------------------------------------------
// Unified Treasury Payments (Incoming Client + Outgoing Supplier)
// ---------------------------------------------------------------------------
export async function recordTreasuryPayment(params: {
  orgId: string;
  memberUids: string[];
  input: PaymentInput;
  salesInvoice?: SalesInvoice;
  supplierInvoice?: SupplierInvoice;
  actor: { uid: string; email: string; displayName: string };
}): Promise<string> {
  const { orgId, memberUids, input, actor } = params;
  const id = generateSafeId('pay');
  const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const reference = `PAY-${nowStr}-${id.slice(-4).toUpperCase()}`;
  const path = `organizations/${orgId}/payments/${id}`;
  const invoiceCollection = input.direction === 'incoming' ? 'salesInvoices' : 'supplierInvoices';

  try {
    await runTransaction(db, async (tx) => {
      const invoiceRef = doc(db, 'organizations', orgId, invoiceCollection, input.invoiceId);
      const invoiceSnap = await tx.get(invoiceRef);
      if (!invoiceSnap.exists()) throw new Error('Facture cible introuvable.');
      const invoiceData = invoiceSnap.data() as SalesInvoice | SupplierInvoice;
      if (input.direction === 'incoming' && (invoiceData as SalesInvoice).invoiceType === 'credit_note') {
        throw new Error('Un avoir ne peut pas recevoir un encaissement.');
      }
      if (invoiceData.status === 'paid') throw new Error('Cette facture est déjà intégralement soldée.');

      const amount = Number(input.amount);
      const remaining = Number(Math.max(0, invoiceData.totalTtc - invoiceData.paidAmount).toFixed(2));
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Montant de paiement invalide.');
      if (amount > remaining + 0.005) throw new Error(`Le paiement dépasse le solde restant (${remaining.toFixed(2)}).`);
      const nextPaid = Number((invoiceData.paidAmount + amount).toFixed(2));
      const fullyPaid = nextPaid >= invoiceData.totalTtc - 0.005;
      const nextStatus = fullyPaid ? 'paid' : 'partially_paid';

      let relatedOrderRef: ReturnType<typeof doc> | null = null;
      let relatedOrderSnap: Awaited<ReturnType<typeof tx.get>> | null = null;
      if (fullyPaid && input.direction === 'incoming') {
        const salesOrderId = (invoiceData as SalesInvoice).salesOrderId;
        if (salesOrderId) {
          relatedOrderRef = doc(db, 'organizations', orgId, 'salesOrders', salesOrderId);
          relatedOrderSnap = await tx.get(relatedOrderRef);
        }
      } else if (fullyPaid && input.direction === 'outgoing') {
        const purchaseOrderId = (invoiceData as SupplierInvoice).purchaseOrderId;
        if (purchaseOrderId) {
          relatedOrderRef = doc(db, 'organizations', orgId, 'purchaseOrders', purchaseOrderId);
          relatedOrderSnap = await tx.get(relatedOrderRef);
        }
      }

      const partyId = input.direction === 'incoming'
        ? (invoiceData as SalesInvoice).customerId
        : (invoiceData as SupplierInvoice).supplierId;
      const partyName = input.direction === 'incoming'
        ? (invoiceData as SalesInvoice).customerName
        : (invoiceData as SupplierInvoice).supplierName;

      tx.set(doc(db, 'organizations', orgId, 'payments', id), {
        id, orgId, reference, direction: input.direction,
        invoiceId: invoiceData.id, invoiceNumber: invoiceData.invoiceNumber,
        partyId, partyName, amount, method: input.method,
        paymentDate: input.paymentDate, notes: input.notes || '',
        recordedByUid: actor.uid, recordedByName: actor.displayName,
        memberUids, createdAt: serverTimestamp(),
      });
      tx.update(invoiceRef, {
        paidAmount: nextPaid, status: nextStatus, updatedAt: serverTimestamp(),
      });
      if (relatedOrderRef && relatedOrderSnap?.exists()) {
        const relatedOrderData = relatedOrderSnap.data() as { status?: string } | undefined;
        const currentStatus = String(relatedOrderData?.status || '');
        if (!['canceled', 'closed'].includes(currentStatus)) {
          tx.update(relatedOrderRef, { status: 'closed', updatedAt: serverTimestamp() });
        }
      }

      const logId = generateSafeId('log');
      tx.set(doc(db, 'organizations', orgId, 'auditLogs', logId), {
        id: logId, orgId, actorUid: actor.uid, actorEmail: actor.email,
        action: input.direction === 'incoming' ? 'CLIENT_PAYMENT_RECEIVED' : 'SUPPLIER_PAYMENT_SENT',
        entityType: 'payment', entityId: id,
        summary: `${reference} (${input.direction === 'incoming' ? 'Encaissement' : 'Décaissement'}) ${amount.toFixed(2)} sur ${invoiceData.invoiceNumber}`,
        memberUids, createdAt: serverTimestamp(),
      });
    });
    return reference;
  } catch (error) {
    if (error instanceof Error && (
      error.message.includes('Facture') || error.message.includes('solde') ||
      error.message.includes('Montant') || error.message.includes('avoir') ||
      error.message.includes('dépasse')
    )) throw error;
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// ---------------------------------------------------------------------------
// Demo Seed Helper for Phase 4 (explicitly tagged isDemo: true)
// ---------------------------------------------------------------------------
export async function seedSalesDemoData(params: {
  orgId: string;
  memberUids: string[];
  products: Product[];
  warehouse: Warehouse;
  actor: { uid: string; email: string; displayName: string };
}): Promise<void> {
  const { orgId, memberUids, products, warehouse, actor } = params;
  const batch = writeBatch(db);

  const demoCustomers = [
    {
      id: 'cust_valmont',
      code: 'CL-VALM',
      type: 'B2B' as const,
      name: 'Atelier Valmont Industrie SAS',
      contactName: 'Thomas Girard',
      email: 'achats@valmont-demo.fr',
      phone: '+33 4 78 44 19 20',
      billingAddress: '45 Avenue Jean Jaurès',
      shippingAddress: '45 Avenue Jean Jaurès, Quai B',
      city: 'Villeurbanne',
      country: 'France',
      siret: '798 441 220 00018',
      vatNumber: 'FR22798441220',
      paymentTerms: '30 jours fin de mois',
      creditLimit: 25000,
    },
    {
      id: 'cust_logimed',
      code: 'CL-LMED',
      type: 'B2B' as const,
      name: 'LogiMed Distribution Santé',
      contactName: 'Nadia Benali',
      email: 'commandes@logimed-demo.fr',
      phone: '+33 1 55 82 40 12',
      billingAddress: '12 Rue des Entrepreneurs',
      shippingAddress: 'Plateforme Nord Entrepôt 3',
      city: 'Nanterre',
      country: 'France',
      siret: '842 119 504 00027',
      vatNumber: 'FR61842119504',
      paymentTerms: '45 jours',
      creditLimit: 50000,
    },
    {
      id: 'cust_dupuis',
      code: 'CL-B2C01',
      type: 'B2C' as const,
      name: 'Jean Dupuis',
      contactName: 'Jean Dupuis',
      email: 'jean.dupuis-demo@exemple.fr',
      phone: '+33 6 12 34 56 78',
      billingAddress: '8 Impasse des Lilas',
      shippingAddress: '8 Impasse des Lilas',
      city: 'Bordeaux',
      country: 'France',
      siret: '',
      vatNumber: '',
      paymentTerms: 'Comptant à la commande',
      creditLimit: 2500,
    },
  ];

  for (const c of demoCustomers) {
    batch.set(doc(db, 'organizations', orgId, 'customers', c.id), {
      ...c,
      orgId,
      status: 'active',
      notes: 'Client de démonstration (Phase 4)',
      isDemo: true,
      memberUids,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const p0 = products[0];
  if (p0) {
    const quoteLines: SalesLine[] = [
      {
        productId: p0.id,
        productSku: p0.sku,
        productName: p0.name,
        unit: p0.unit,
        quantity: 5,
        unitPrice: p0.salePrice,
        discountPct: 5,
        vatRate: p0.vatRate,
      },
    ];
    const qTotals = computeSalesTotals(quoteLines, 25);
    batch.set(doc(db, 'organizations', orgId, 'quotes', 'qt_demo_01'), {
      id: 'qt_demo_01',
      orgId,
      reference: 'DEV-DEMO-0001',
      customerId: 'cust_logimed',
      customerName: 'LogiMed Distribution Santé',
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      status: 'sent',
      validUntil: new Date(Date.now() + 21 * 86400_000).toISOString().slice(0, 10),
      paymentTerms: '45 jours',
      shippingCost: 25,
      subtotalHt: qTotals.subtotalHt,
      vatTotal: qTotals.vatTotal,
      totalTtc: qTotals.totalTtc,
      lines: quoteLines,
      notes: 'Devis de démonstration prêt à être converti en commande client',
      createdByUid: actor.uid,
      createdByName: actor.displayName,
      isDemo: true,
      memberUids,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const soLines: SalesOrderLine[] = [
      {
        productId: p0.id,
        productSku: p0.sku,
        productName: p0.name,
        unit: p0.unit,
        quantity: 2,
        reservedQty: 0,
        deliveredQty: 0,
        unitPrice: p0.salePrice,
        discountPct: 0,
        vatRate: p0.vatRate,
      },
    ];
    const soTotals = computeSalesTotals(soLines, 0);
    batch.set(doc(db, 'organizations', orgId, 'salesOrders', 'so_demo_01'), {
      id: 'so_demo_01',
      orgId,
      reference: 'CC-DEMO-0001',
      customerId: 'cust_valmont',
      customerName: 'Atelier Valmont Industrie SAS',
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      status: 'confirmed',
      stockReserved: false,
      expectedDeliveryDate: new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10),
      paymentTerms: '30 jours fin de mois',
      shippingCost: 0,
      subtotalHt: soTotals.subtotalHt,
      vatTotal: soTotals.vatTotal,
      totalTtc: soTotals.totalTtc,
      lines: soLines,
      notes: 'Commande client de démonstration prête pour réservation de stock et expédition',
      createdByUid: actor.uid,
      createdByName: actor.displayName,
      isDemo: true,
      memberUids,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const logId = generateSafeId('log');
  batch.set(doc(db, 'organizations', orgId, 'auditLogs', logId), {
    id: logId,
    orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    action: 'SALES_DEMO_SEEDED',
    entityType: 'customer',
    entityId: orgId,
    summary: 'Initialisation CRM clients, devis et commande client de démonstration (Phase 4)',
    memberUids,
    createdAt: serverTimestamp(),
  });

  await batch.commit();
}
