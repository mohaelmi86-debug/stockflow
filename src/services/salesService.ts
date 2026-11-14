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

  const candidateBalances = balances.filter(
    (b) =>
      b.warehouseId === order.warehouseId &&
      order.lines.some((l) => l.productId === b.productId)
  );

  try {
    await runTransaction(db, async (tx) => {
      // 1. ALL READS FIRST
      const soRef = doc(db, 'organizations', orgId, 'salesOrders', order.id);
      const soSnap = await tx.get(soRef);
      if (!soSnap.exists()) throw new Error('Commande client introuvable.');
      const freshOrder = soSnap.data() as SalesOrder;
      if (freshOrder.status === 'canceled' || freshOrder.status === 'closed') {
        throw new Error('Impossible de réserver du stock sur une commande annulée ou clôturée.');
      }

      const balRefs = candidateBalances.map((b) =>
        doc(db, 'organizations', orgId, 'stockBalances', b.id)
      );
      const balSnaps = await Promise.all(balRefs.map((ref) => tx.get(ref)));

      // 2. VALIDATIONS & ALLOCATIONS
      const freshBalances = balSnaps
        .filter((s) => s.exists())
        .map((s) => ({ ref: s.ref, data: s.data() as StockBalance }));

      const updatedLines = freshOrder.lines.map((ol) => ({ ...ol }));
      const balanceDeltas = new Map<string, { ref: (typeof balRefs)[number]; bal: StockBalance; addReserved: number }>();

      for (const line of updatedLines) {
        const needed = Math.max(0, line.quantity - line.deliveredQty - line.reservedQty);
        if (needed <= 0) continue;

        const matching = freshBalances.filter((fb) => fb.data.productId === line.productId);
        let remainingToReserve = needed;
        for (const item of matching) {
          const curEntry = balanceDeltas.get(item.data.id);
          const alreadyAllocated = curEntry?.addReserved ?? 0;
          const avail = Math.max(0, item.data.availableQty - alreadyAllocated);
          if (avail <= 0) continue;

          const take = Math.min(avail, remainingToReserve);
          balanceDeltas.set(item.data.id, {
            ref: item.ref,
            bal: item.data,
            addReserved: alreadyAllocated + take,
          });
          remainingToReserve = Number((remainingToReserve - take).toFixed(3));
          line.reservedQty = Number((line.reservedQty + take).toFixed(3));
          if (remainingToReserve <= 0) break;
        }

        if (remainingToReserve > 0.0001) {
          throw new Error(
            `Stock disponible insuffisant dans ${freshOrder.warehouseName} pour réserver ${line.productSku} (manque ${remainingToReserve}).`
          );
        }
      }

      // 3. ALL WRITES
      for (const { ref, bal, addReserved } of balanceDeltas.values()) {
        if (addReserved <= 0) continue;
        const nextReserved = Number((bal.reservedQty + addReserved).toFixed(3));
        const nextAvailable = Number(Math.max(0, bal.physicalQty - nextReserved).toFixed(3));
        tx.update(ref, {
          reservedQty: nextReserved,
          availableQty: nextAvailable,
          updatedAt: serverTimestamp(),
        });
      }

      tx.update(soRef, {
        lines: updatedLines,
        stockReserved: true,
        status: freshOrder.status === 'draft' ? 'confirmed' : 'preparing',
        updatedAt: serverTimestamp(),
      });

      const logId = generateSafeId('log');
      tx.set(doc(db, 'organizations', orgId, 'auditLogs', logId), {
        id: logId,
        orgId,
        actorUid: actor.uid,
        actorEmail: actor.email,
        action: 'SALES_ORDER_STOCK_RESERVED',
        entityType: 'sales_order',
        entityId: freshOrder.id,
        summary: `Réservation atomique de stock pour commande ${freshOrder.reference}`,
        memberUids,
        createdAt: serverTimestamp(),
      });
    });
  } catch (error) {
    if (error instanceof Error && (error.message.includes('Stock') || error.message.includes('Commande') || error.message.includes('Impossible'))) {
      throw error;
    }
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
  const { orgId, memberUids, order, balances, actor } = params;
  const path = `organizations/${orgId}/salesOrders/${order.id}`;

  const candidateBalances = balances.filter(
    (b) => b.warehouseId === order.warehouseId && b.reservedQty > 0
  );

  try {
    await runTransaction(db, async (tx) => {
      const soRef = doc(db, 'organizations', orgId, 'salesOrders', order.id);
      const soSnap = await tx.get(soRef);
      if (!soSnap.exists()) throw new Error('Commande client introuvable.');
      const freshOrder = soSnap.data() as SalesOrder;
      if (freshOrder.status === 'closed' || freshOrder.status === 'canceled') {
        throw new Error('Commande déjà clôturée ou annulée.');
      }

      const balRefs = candidateBalances.map((b) =>
        doc(db, 'organizations', orgId, 'stockBalances', b.id)
      );
      const balSnaps = await Promise.all(balRefs.map((r) => tx.get(r)));
      const freshBalances = balSnaps
        .filter((s) => s.exists())
        .map((s) => ({ ref: s.ref, data: s.data() as StockBalance }));

      const updatedLines = freshOrder.lines.map((l) => ({ ...l }));

      // Release reserved stock if any
      for (const line of updatedLines) {
        let toRelease = line.reservedQty;
        if (toRelease <= 0) continue;
        const matching = freshBalances.filter((fb) => fb.data.productId === line.productId);
        for (const item of matching) {
          if (toRelease <= 0) break;
          const releaseNow = Math.min(item.data.reservedQty, toRelease);
          if (releaseNow <= 0) continue;
          const nextReserved = Number(Math.max(0, item.data.reservedQty - releaseNow).toFixed(3));
          const nextAvail = Number(Math.max(0, item.data.physicalQty - nextReserved).toFixed(3));
          tx.update(item.ref, {
            reservedQty: nextReserved,
            availableQty: nextAvail,
            updatedAt: serverTimestamp(),
          });
          item.data.reservedQty = nextReserved;
          toRelease = Number((toRelease - releaseNow).toFixed(3));
        }
        line.reservedQty = 0;
      }

      tx.update(soRef, {
        lines: updatedLines,
        stockReserved: false,
        status: 'canceled',
        updatedAt: serverTimestamp(),
      });

      const logId = generateSafeId('log');
      tx.set(doc(db, 'organizations', orgId, 'auditLogs', logId), {
        id: logId,
        orgId,
        actorUid: actor.uid,
        actorEmail: actor.email,
        action: 'SALES_ORDER_CANCELED',
        entityType: 'sales_order',
        entityId: freshOrder.id,
        summary: `Annulation commande ${freshOrder.reference} (réservations libérées)`,
        memberUids,
        createdAt: serverTimestamp(),
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Commande')) throw error;
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
  const {
    orgId,
    memberUids,
    order,
    warehouse,
    locations,
    linesInput,
    carrier,
    trackingNumber,
    notes,
    actor,
  } = params;

  const activeLines = linesInput.filter((l) => l.deliveredQty > 0);
  if (activeLines.length === 0) {
    throw new Error('Saisissez au moins une quantité à expédier supérieure à 0.');
  }

  const locMap = new Map(locations.map((l) => [l.id, l]));
  const deliveryId = generateSafeId('dn');
  const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const deliveryRef = `BL-${nowStr}-${deliveryId.slice(-4).toUpperCase()}`;
  const path = `organizations/${orgId}/deliveryNotes/${deliveryId}`;

  try {
    await runTransaction(db, async (tx) => {
      // 1. ALL READS FIRST
      const soRef = doc(db, 'organizations', orgId, 'salesOrders', order.id);
      const soSnap = await tx.get(soRef);
      if (!soSnap.exists()) throw new Error('Commande client introuvable.');
      const freshOrder = soSnap.data() as SalesOrder;
      if (freshOrder.status === 'canceled' || freshOrder.status === 'closed') {
        throw new Error('Impossible d’expédier une commande annulée ou clôturée.');
      }

      const balReads = await Promise.all(
        activeLines.map(async (line) => {
          const balId = `${line.productId}_${warehouse.id}_${line.locationId}`;
          const balRef = doc(db, 'organizations', orgId, 'stockBalances', balId);
          const snap = await tx.get(balRef);
          return { line, balId, balRef, snap };
        })
      );

      // 2. VALIDATIONS
      const dnLines: DeliveryNoteLine[] = [];
      const updatedOrderLines = freshOrder.lines.map((ol) => ({ ...ol }));

      for (const { line, snap } of balReads) {
        const orderLine = updatedOrderLines.find((ol) => ol.productId === line.productId);
        if (!orderLine) throw new Error(`Produit ${line.productId} absent de la commande.`);

        const remaining = Math.max(0, orderLine.quantity - orderLine.deliveredQty);
        if (line.deliveredQty > remaining + 0.0001) {
          throw new Error(
            `Quantité expédiée (${line.deliveredQty}) supérieure au reliquat (${remaining}) pour ${orderLine.productSku}.`
          );
        }
        if (!snap.exists()) {
          throw new Error(`Aucun stock trouvé sur cet emplacement pour ${orderLine.productSku}.`);
        }
        const existingBal = snap.data() as StockBalance;
        if (existingBal.physicalQty < line.deliveredQty - 0.0001) {
          throw new Error(
            `Stock physique insuffisant sur ${existingBal.locationCode} pour ${orderLine.productSku} (dispo physique : ${existingBal.physicalQty}).`
          );
        }

        const loc = locMap.get(line.locationId);
        if (!loc) throw new Error('Emplacement source invalide.');

        // Deduct from order reservation if reserved
        const consumeReservation = Math.min(orderLine.reservedQty, line.deliveredQty);
        orderLine.reservedQty = Number((orderLine.reservedQty - consumeReservation).toFixed(3));
        orderLine.deliveredQty = Number((orderLine.deliveredQty + line.deliveredQty).toFixed(3));

        dnLines.push({
          productId: orderLine.productId,
          productSku: orderLine.productSku,
          productName: orderLine.productName,
          locationId: loc.id,
          locationCode: loc.code,
          deliveredQty: line.deliveredQty,
          unitCost: existingBal.unitCost,
        });
      }

      const allDelivered = updatedOrderLines.every((ol) => ol.deliveredQty >= ol.quantity - 0.0001);
      const anyDelivered = updatedOrderLines.some((ol) => ol.deliveredQty > 0);
      const stillReserved = updatedOrderLines.some((ol) => ol.reservedQty > 0);
      const nextStatus: SalesOrder['status'] = allDelivered
        ? 'delivered'
        : anyDelivered
          ? 'partially_delivered'
          : freshOrder.status;

      // 3. ALL WRITES
      tx.set(doc(db, 'organizations', orgId, 'deliveryNotes', deliveryId), {
        id: deliveryId,
        orgId,
        reference: deliveryRef,
        salesOrderId: freshOrder.id,
        salesOrderRef: freshOrder.reference,
        customerId: freshOrder.customerId,
        customerName: freshOrder.customerName,
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        carrier: carrier || '',
        trackingNumber: trackingNumber || '',
        notes: notes || '',
        lines: dnLines,
        deliveredByUid: actor.uid,
        deliveredByName: actor.displayName,
        memberUids,
        createdAt: serverTimestamp(),
      });

      tx.update(soRef, {
        lines: updatedOrderLines,
        stockReserved: stillReserved,
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });

      for (let i = 0; i < balReads.length; i++) {
        const { balRef, snap } = balReads[i];
        const dnLine = dnLines[i];
        const existingBal = snap.data() as StockBalance;

        const nextPhysical = Number(Math.max(0, existingBal.physicalQty - dnLine.deliveredQty).toFixed(3));
        const releaseBalRes = Math.min(existingBal.reservedQty, dnLine.deliveredQty);
        const nextReserved = Number(Math.max(0, existingBal.reservedQty - releaseBalRes).toFixed(3));
        const nextAvailable = Number(Math.max(0, nextPhysical - nextReserved).toFixed(3));

        tx.update(balRef, {
          physicalQty: nextPhysical,
          reservedQty: nextReserved,
          availableQty: nextAvailable,
          updatedAt: serverTimestamp(),
        });

        const mvtId = generateSafeId('mvt');
        tx.set(doc(db, 'organizations', orgId, 'stockMovements', mvtId), {
          id: mvtId,
          orgId,
          reference: `MVT-${nowStr}-${mvtId.slice(-5).toUpperCase()}`,
          movementType: 'OUT',
          productId: dnLine.productId,
          productSku: dnLine.productSku,
          productName: dnLine.productName,
          warehouseId: warehouse.id,
          warehouseName: warehouse.name,
          locationId: dnLine.locationId,
          locationCode: dnLine.locationCode,
          quantity: -dnLine.deliveredQty,
          unitCost: dnLine.unitCost,
          reason: `Expédition commande ${freshOrder.reference} (${freshOrder.customerName})`,
          sourceDocumentType: 'Bon de livraison client',
          sourceDocumentRef: deliveryRef,
          performedByUid: actor.uid,
          performedByName: actor.displayName,
          isDemo: false,
          memberUids,
          createdAt: serverTimestamp(),
        });
      }

      const logId = generateSafeId('log');
      tx.set(doc(db, 'organizations', orgId, 'auditLogs', logId), {
        id: logId,
        orgId,
        actorUid: actor.uid,
        actorEmail: actor.email,
        action: 'DELIVERY_NOTE_SHIPPED',
        entityType: 'delivery_note',
        entityId: deliveryId,
        summary: `Bon de livraison ${deliveryRef} sur commande ${freshOrder.reference}`,
        memberUids,
        createdAt: serverTimestamp(),
      });
    });

    return deliveryRef;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('Quantité') ||
        error.message.includes('Stock') ||
        error.message.includes('Aucun stock') ||
        error.message.includes('Commande') ||
        error.message.includes('Emplacement'))
    ) {
      throw error;
    }
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
  const {
    orgId,
    memberUids,
    existingInvoices,
    input,
    products,
    customer,
    linkedOrder,
    relatedInvoiceId,
    actor,
  } = params;

  const id = generateSafeId('inv');
  const { sequenceNumber, invoiceNumber } = getNextInvoiceSequence(
    existingInvoices,
    input.invoiceType
  );
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
  const fullAddress = [customer.billingAddress, customer.city, customer.country]
    .filter(Boolean)
    .join(', ');
  const path = `organizations/${orgId}/salesInvoices/${id}`;

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'organizations', orgId, 'salesInvoices', id), {
      id,
      orgId,
      invoiceNumber,
      invoiceType: input.invoiceType,
      sequenceNumber,
      ...(linkedOrder ? { salesOrderId: linkedOrder.id, salesOrderRef: linkedOrder.reference } : {}),
      customerId: customer.id,
      customerName: customer.name,
      customerSiret: customer.siret || '',
      customerVatNumber: customer.vatNumber || '',
      customerAddress: fullAddress,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      shippingCost: Number(input.shippingCost || 0),
      totalHt: totals.subtotalHt,
      totalVat: totals.vatTotal,
      totalTtc: totals.totalTtc,
      paidAmount: 0,
      status: 'issued',
      lines,
      ...(relatedInvoiceId ? { relatedInvoiceId } : {}),
      notes: input.notes || '',
      createdByUid: actor.uid,
      createdByName: actor.displayName,
      isDemo: false,
      memberUids,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (
      linkedOrder &&
      input.invoiceType === 'invoice' &&
      (linkedOrder.status === 'delivered' ||
        linkedOrder.status === 'partially_delivered' ||
        linkedOrder.status === 'confirmed')
    ) {
      batch.update(doc(db, 'organizations', orgId, 'salesOrders', linkedOrder.id), {
        status: 'invoiced',
        updatedAt: serverTimestamp(),
      });
    }

    const logId = generateSafeId('log');
    batch.set(doc(db, 'organizations', orgId, 'auditLogs', logId), {
      id: logId,
      orgId,
      actorUid: actor.uid,
      actorEmail: actor.email,
      action:
        input.invoiceType === 'credit_note'
          ? 'CREDIT_NOTE_ISSUED'
          : 'SALES_INVOICE_ISSUED',
      entityType: 'sales_invoice',
      entityId: id,
      summary: `${invoiceNumber} (${customer.name}) — ${totals.totalTtc.toFixed(2)} TTC`,
      memberUids,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
    return { id, invoiceNumber };
  } catch (error) {
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
  const { orgId, memberUids, input, salesInvoice, supplierInvoice, actor } = params;
  const id = generateSafeId('pay');
  const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const reference = `PAY-${nowStr}-${id.slice(-4).toUpperCase()}`;
  const path = `organizations/${orgId}/payments/${id}`;

  const target = input.direction === 'incoming' ? salesInvoice : supplierInvoice;
  if (!target) {
    throw new Error('Facture cible introuvable pour ce paiement.');
  }

  const remaining = Math.max(0, target.totalTtc - target.paidAmount);
  const appliedAmount = Number(Math.min(remaining, Number(input.amount)).toFixed(2));
  if (appliedAmount <= 0) {
    throw new Error('Cette facture est déjà intégralement soldée.');
  }
  const nextPaid = Number((target.paidAmount + appliedAmount).toFixed(2));
  const partyId =
    input.direction === 'incoming'
      ? (target as SalesInvoice).customerId
      : (target as SupplierInvoice).supplierId;
  const partyName =
    input.direction === 'incoming'
      ? (target as SalesInvoice).customerName
      : (target as SupplierInvoice).supplierName;

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'organizations', orgId, 'payments', id), {
      id,
      orgId,
      reference,
      direction: input.direction,
      invoiceId: target.id,
      invoiceNumber: target.invoiceNumber,
      partyId,
      partyName,
      amount: appliedAmount,
      method: input.method,
      paymentDate: input.paymentDate,
      notes: input.notes || '',
      recordedByUid: actor.uid,
      recordedByName: actor.displayName,
      memberUids,
      createdAt: serverTimestamp(),
    });

    if (input.direction === 'incoming' && salesInvoice) {
      const nextStatus: SalesInvoice['status'] =
        nextPaid >= salesInvoice.totalTtc - 0.005 ? 'paid' : 'partially_paid';
      batch.update(doc(db, 'organizations', orgId, 'salesInvoices', salesInvoice.id), {
        paidAmount: nextPaid,
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
      if (nextStatus === 'paid' && salesInvoice.salesOrderId) {
        batch.update(doc(db, 'organizations', orgId, 'salesOrders', salesInvoice.salesOrderId), {
          status: 'closed',
          updatedAt: serverTimestamp(),
        });
      }
    } else if (input.direction === 'outgoing' && supplierInvoice) {
      const nextStatus: SupplierInvoice['status'] =
        nextPaid >= supplierInvoice.totalTtc - 0.005 ? 'paid' : 'partially_paid';
      batch.update(doc(db, 'organizations', orgId, 'supplierInvoices', supplierInvoice.id), {
        paidAmount: nextPaid,
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
      if (nextStatus === 'paid') {
        batch.update(
          doc(db, 'organizations', orgId, 'purchaseOrders', supplierInvoice.purchaseOrderId),
          {
            status: 'closed',
            updatedAt: serverTimestamp(),
          }
        );
      }
    }

    const logId = generateSafeId('log');
    batch.set(doc(db, 'organizations', orgId, 'auditLogs', logId), {
      id: logId,
      orgId,
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: input.direction === 'incoming' ? 'CLIENT_PAYMENT_RECEIVED' : 'SUPPLIER_PAYMENT_SENT',
      entityType: 'payment',
      entityId: id,
      summary: `${reference} (${input.direction === 'incoming' ? 'Encaissement' : 'Décaissement'}) ${appliedAmount.toFixed(2)} sur ${target.invoiceNumber}`,
      memberUids,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
    return reference;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
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
