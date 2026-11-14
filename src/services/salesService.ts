import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase.ts';
import { callStockEngine } from '../lib/stockApi.ts';
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
  await callStockEngine('reserve', { orgId: params.orgId, orderId: params.order.id });
}

export async function cancelSalesOrder(params: {
  orgId: string;
  memberUids: string[];
  order: SalesOrder;
  balances: StockBalance[];
  actor: { uid: string; email: string };
}): Promise<void> {
  await callStockEngine('cancel', { orgId: params.orgId, orderId: params.order.id });
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
  const result = await callStockEngine<{ reference: string }>('ship', {
    orgId: params.orgId,
    orderId: params.order.id,
    warehouseId: params.warehouse.id,
    linesInput: params.linesInput,
    carrier: params.carrier ?? '',
    trackingNumber: params.trackingNumber ?? '',
    notes: params.notes ?? '',
  });
  return result.reference;
}

// Sequential French-Compliant// Sequential French-Compliant Customer Invoices & Credit Notes
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
    // Seed the first counter from the latest legacy invoice once. The actual
    // allocation remains serialized by the counter document transaction.
    const invoicePrefix = `${prefix}-${issueYear}-`;
    const latestInvoiceQuery = query(
      collection(db, 'organizations', orgId, 'salesInvoices'),
      where('invoiceNumber', '>=', invoicePrefix),
      where('invoiceNumber', '<=', `${invoicePrefix}\uf8ff`),
      orderBy('invoiceNumber', 'desc'),
      limit(1)
    );
    const latestInvoiceSnap = await getDocs(latestInvoiceQuery);
    const legacySequence = latestInvoiceSnap.empty
      ? 0
      : Number(latestInvoiceSnap.docs[0].data().sequenceNumber || 0);

    const invoiceNumber = await runTransaction(db, async (tx) => {
      const counterRef = doc(db, 'organizations', orgId, 'invoiceCounters', counterId);
      const counterSnap = await tx.get(counterRef);
      const sequenceNumber = counterSnap.exists()
        ? Number(counterSnap.data().sequenceNumber || 0) + 1
        : legacySequence + 1;
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
