import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase.ts';
import { handleFirestoreError, OperationType } from '../lib/firestoreError.ts';
import { generateSafeId, toDate } from '../shared/formatters.ts';
import type {
  PurchaseOrderInput,
  PurchaseRequestInput,
  SupplierInput,
  SupplierInvoiceInput,
} from '../shared/schemas.ts';
import type {
  GoodsReceipt,
  GoodsReceiptLine,
  InspectionStatus,
  Product,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseRequest,
  PurchaseRequestLine,
  RfqSupplierOffer,
  StockBalance,
  Supplier,
  SupplierInvoice,
  Warehouse,
  WarehouseLocation,
} from '../shared/types.ts';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export async function listSuppliers(orgId: string, uid: string): Promise<Supplier[]> {
  const path = `organizations/${orgId}/suppliers`;
  try {
    const q = query(collection(db, 'organizations', orgId, 'suppliers'), where('memberUids', 'array-contains', uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as Supplier).sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listPurchaseRequests(orgId: string, uid: string): Promise<PurchaseRequest[]> {
  const path = `organizations/${orgId}/purchaseRequests`;
  try {
    const q = query(
      collection(db, 'organizations', orgId, 'purchaseRequests'),
      where('memberUids', 'array-contains', uid)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as PurchaseRequest)
      .sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listPurchaseOrders(orgId: string, uid: string): Promise<PurchaseOrder[]> {
  const path = `organizations/${orgId}/purchaseOrders`;
  try {
    const q = query(
      collection(db, 'organizations', orgId, 'purchaseOrders'),
      where('memberUids', 'array-contains', uid)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as PurchaseOrder)
      .sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listGoodsReceipts(orgId: string, uid: string): Promise<GoodsReceipt[]> {
  const path = `organizations/${orgId}/goodsReceipts`;
  try {
    const q = query(
      collection(db, 'organizations', orgId, 'goodsReceipts'),
      where('memberUids', 'array-contains', uid)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as GoodsReceipt)
      .sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listSupplierInvoices(orgId: string, uid: string): Promise<SupplierInvoice[]> {
  const path = `organizations/${orgId}/supplierInvoices`;
  try {
    const q = query(
      collection(db, 'organizations', orgId, 'supplierInvoices'),
      where('memberUids', 'array-contains', uid)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as SupplierInvoice)
      .sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

// ---------------------------------------------------------------------------
// Suppliers CRUD
// ---------------------------------------------------------------------------
export async function createSupplier(
  orgId: string,
  memberUids: string[],
  input: SupplierInput,
  actor: { uid: string; email: string }
): Promise<string> {
  const id = generateSafeId('sup');
  const path = `organizations/${orgId}/suppliers/${id}`;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'organizations', orgId, 'suppliers', id), {
      id,
      orgId,
      code: input.code.toUpperCase(),
      name: input.name,
      contactName: input.contactName || '',
      email: input.email || '',
      phone: input.phone || '',
      address: input.address || '',
      city: input.city || '',
      country: input.country || 'France',
      siret: input.siret || '',
      vatNumber: input.vatNumber || '',
      paymentTerms: input.paymentTerms,
      leadTimeDays: Number(input.leadTimeDays),
      rating: Number(input.rating),
      onTimeRate: Number(input.onTimeRate),
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
      action: 'SUPPLIER_CREATED',
      entityType: 'supplier',
      entityId: id,
      summary: `Création du fournisseur ${input.code.toUpperCase()} — ${input.name}`,
      memberUids,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateSupplier(
  orgId: string,
  supplierId: string,
  input: SupplierInput
): Promise<void> {
  const path = `organizations/${orgId}/suppliers/${supplierId}`;
  try {
    await updateDoc(doc(db, 'organizations', orgId, 'suppliers', supplierId), {
      code: input.code.toUpperCase(),
      name: input.name,
      contactName: input.contactName || '',
      email: input.email || '',
      phone: input.phone || '',
      address: input.address || '',
      city: input.city || '',
      country: input.country || 'France',
      siret: input.siret || '',
      vatNumber: input.vatNumber || '',
      paymentTerms: input.paymentTerms,
      leadTimeDays: Number(input.leadTimeDays),
      rating: Number(input.rating),
      onTimeRate: Number(input.onTimeRate),
      status: input.status,
      notes: input.notes || '',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteSupplier(orgId: string, supplierId: string): Promise<void> {
  const path = `organizations/${orgId}/suppliers/${supplierId}`;
  try {
    await deleteDoc(doc(db, 'organizations', orgId, 'suppliers', supplierId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// ---------------------------------------------------------------------------
// Purchase Requests & RFQ Comparison
// ---------------------------------------------------------------------------
export async function createPurchaseRequest(params: {
  orgId: string;
  memberUids: string[];
  input: PurchaseRequestInput;
  products: Product[];
  warehouse: Warehouse;
  actor: { uid: string; email: string; displayName: string };
}): Promise<string> {
  const { orgId, memberUids, input, products, warehouse, actor } = params;
  const id = generateSafeId('pr');
  const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const reference = `DA-${nowStr}-${id.slice(-4).toUpperCase()}`;
  const productMap = new Map(products.map((p) => [p.id, p]));

  const lines: PurchaseRequestLine[] = input.lines.map((l) => {
    const p = productMap.get(l.productId);
    return {
      productId: l.productId,
      productSku: p?.sku ?? 'SKU',
      productName: p?.name ?? 'Produit',
      unit: p?.unit ?? 'unité',
      quantity: Number(l.quantity),
      estimatedUnitCost: Number(l.estimatedUnitCost || p?.purchasePrice || 0),
    };
  });

  const path = `organizations/${orgId}/purchaseRequests/${id}`;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'organizations', orgId, 'purchaseRequests', id), {
      id,
      orgId,
      reference,
      title: input.title,
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      priority: input.priority,
      status: 'pending_approval',
      lines,
      rfqOffers: [],
      notes: input.notes || '',
      requestedByUid: actor.uid,
      requestedByName: actor.displayName,
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
      action: 'PURCHASE_REQUEST_CREATED',
      entityType: 'purchase_request',
      entityId: id,
      summary: `Demande d'achat ${reference} — ${input.title}`,
      memberUids,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    return reference;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updatePurchaseRequest(
  orgId: string,
  requestId: string,
  patch: Partial<Pick<PurchaseRequest, 'status' | 'rfqOffers' | 'convertedOrderId' | 'notes'>>
): Promise<void> {
  const path = `organizations/${orgId}/purchaseRequests/${requestId}`;
  try {
    await updateDoc(doc(db, 'organizations', orgId, 'purchaseRequests', requestId), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function addRfqOfferToRequest(
  orgId: string,
  request: PurchaseRequest,
  offer: RfqSupplierOffer
): Promise<void> {
  const offers = [...(request.rfqOffers ?? []), offer];
  await updatePurchaseRequest(orgId, request.id, {
    rfqOffers: offers,
    status: request.status === 'pending_approval' || request.status === 'approved' ? 'rfq_sent' : request.status,
  });
}

// ---------------------------------------------------------------------------
// Purchase Orders
// ---------------------------------------------------------------------------
export function computeOrderTotals(lines: PurchaseOrderLine[], shippingCost: number) {
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

export async function createPurchaseOrder(params: {
  orgId: string;
  memberUids: string[];
  input: PurchaseOrderInput;
  products: Product[];
  supplier: Supplier;
  warehouse: Warehouse;
  actor: { uid: string; email: string; displayName: string };
  sourceRequestId?: string;
  confirmImmediately?: boolean;
}): Promise<{ id: string; reference: string }> {
  const {
    orgId,
    memberUids,
    input,
    products,
    supplier,
    warehouse,
    actor,
    sourceRequestId,
    confirmImmediately = true,
  } = params;

  const id = generateSafeId('po');
  const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const reference = `CF-${nowStr}-${id.slice(-4).toUpperCase()}`;
  const productMap = new Map(products.map((p) => [p.id, p]));

  const lines: PurchaseOrderLine[] = input.lines.map((l) => {
    const p = productMap.get(l.productId);
    return {
      productId: l.productId,
      productSku: p?.sku ?? 'SKU',
      productName: p?.name ?? 'Produit',
      unit: p?.unit ?? 'unité',
      quantity: Number(l.quantity),
      receivedQty: 0,
      unitPrice: Number(l.unitPrice),
      discountPct: Number(l.discountPct),
      vatRate: Number(l.vatRate),
    };
  });

  const totals = computeOrderTotals(lines, Number(input.shippingCost));
  const path = `organizations/${orgId}/purchaseOrders/${id}`;

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'organizations', orgId, 'purchaseOrders', id), {
      id,
      orgId,
      reference,
      supplierId: supplier.id,
      supplierName: supplier.name,
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      status: confirmImmediately ? 'confirmed' : 'draft',
      expectedDate: input.expectedDate || '',
      paymentTerms: input.paymentTerms || supplier.paymentTerms,
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

    if (sourceRequestId) {
      batch.update(doc(db, 'organizations', orgId, 'purchaseRequests', sourceRequestId), {
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
      action: 'PURCHASE_ORDER_CREATED',
      entityType: 'purchase_order',
      entityId: id,
      summary: `Commande fournisseur ${reference} (${supplier.name}) — ${totals.totalTtc.toFixed(2)} TTC`,
      memberUids,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
    return { id, reference };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updatePurchaseOrderStatus(
  orgId: string,
  order: PurchaseOrder,
  status: PurchaseOrder['status'],
  memberUids: string[],
  actor: { uid: string; email: string }
): Promise<void> {
  const path = `organizations/${orgId}/purchaseOrders/${order.id}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'organizations', orgId, 'purchaseOrders', order.id), {
      status,
      updatedAt: serverTimestamp(),
    });
    const logId = generateSafeId('log');
    batch.set(doc(db, 'organizations', orgId, 'auditLogs', logId), {
      id: logId,
      orgId,
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: 'PURCHASE_ORDER_STATUS',
      entityType: 'purchase_order',
      entityId: order.id,
      summary: `Commande ${order.reference} passée au statut « ${status} »`,
      memberUids,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// ---------------------------------------------------------------------------
// Goods Receipt -> Atomic Stock Entry Transaction
// ---------------------------------------------------------------------------
export interface ReceiptInputLine {
  productId: string;
  locationId: string;
  receivedQty: number;
  acceptedQty: number;
  rejectedQty: number;
}

export async function validateGoodsReceipt(params: {
  orgId: string;
  memberUids: string[];
  order: PurchaseOrder;
  warehouse: Warehouse;
  locations: WarehouseLocation[];
  linesInput: ReceiptInputLine[];
  inspectionStatus: InspectionStatus;
  deliveryNoteRef?: string;
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
    inspectionStatus,
    deliveryNoteRef,
    notes,
    actor,
  } = params;

  const activeLines = linesInput.filter((l) => l.receivedQty > 0);
  if (activeLines.length === 0) {
    throw new Error('Veuillez saisir au moins une quantité reçue supérieure à 0.');
  }

  const locMap = new Map(locations.map((l) => [l.id, l]));
  const receiptId = generateSafeId('gr');
  const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const receiptRef = `BR-${nowStr}-${receiptId.slice(-4).toUpperCase()}`;
  const path = `organizations/${orgId}/goodsReceipts/${receiptId}`;

  try {
    await runTransaction(db, async (tx) => {
      // 1. ALL READS FIRST
      const poRef = doc(db, 'organizations', orgId, 'purchaseOrders', order.id);
      const poSnap = await tx.get(poRef);
      if (!poSnap.exists()) {
        throw new Error('Commande fournisseur introuvable.');
      }
      const freshOrder = poSnap.data() as PurchaseOrder;
      if (freshOrder.status === 'canceled' || freshOrder.status === 'closed') {
        throw new Error('Impossible de réceptionner une commande annulée ou clôturée.');
      }

      const balanceReads = await Promise.all(
        activeLines.map(async (line) => {
          const balId = `${line.productId}_${warehouse.id}_${line.locationId}`;
          const balRef = doc(db, 'organizations', orgId, 'stockBalances', balId);
          const snap = await tx.get(balRef);
          return { line, balId, balRef, snap };
        })
      );

      // 2. VALIDATIONS & COMPUTATIONS
      const receiptLines: GoodsReceiptLine[] = [];
      const updatedOrderLines = freshOrder.lines.map((ol) => ({ ...ol }));

      for (const { line } of balanceReads) {
        const orderLine = updatedOrderLines.find((ol) => ol.productId === line.productId);
        if (!orderLine) {
          throw new Error(`Produit ${line.productId} absent de la commande.`);
        }
        const remaining = Math.max(0, orderLine.quantity - orderLine.receivedQty);
        if (line.receivedQty > remaining + 0.0001) {
          throw new Error(
            `Quantité reçue (${line.receivedQty}) supérieure au reliquat (${remaining}) pour ${orderLine.productSku}.`
          );
        }
        if (line.acceptedQty + line.rejectedQty > line.receivedQty + 0.0001) {
          throw new Error(`Somme acceptée + rejetée invalide pour ${orderLine.productSku}.`);
        }

        const loc = locMap.get(line.locationId);
        if (!loc) {
          throw new Error('Emplacement de réception invalide.');
        }

        // Only acceptedQty increases physical stock & counts toward fulfilled order qty
        orderLine.receivedQty = Number((orderLine.receivedQty + line.acceptedQty).toFixed(3));
        const unitCost = Number((orderLine.unitPrice * (1 - orderLine.discountPct / 100)).toFixed(4));

        receiptLines.push({
          productId: orderLine.productId,
          productSku: orderLine.productSku,
          productName: orderLine.productName,
          locationId: loc.id,
          locationCode: loc.code,
          receivedQty: line.receivedQty,
          acceptedQty: line.acceptedQty,
          rejectedQty: line.rejectedQty,
          unitCost,
        });
      }

      const allFulfilled = updatedOrderLines.every((ol) => ol.receivedQty >= ol.quantity);
      const anyReceived = updatedOrderLines.some((ol) => ol.receivedQty > 0);
      const nextStatus: PurchaseOrder['status'] = allFulfilled
        ? 'received'
        : anyReceived
          ? 'partially_received'
          : freshOrder.status;

      // 3. ALL WRITES
      tx.set(doc(db, 'organizations', orgId, 'goodsReceipts', receiptId), {
        id: receiptId,
        orgId,
        reference: receiptRef,
        purchaseOrderId: freshOrder.id,
        purchaseOrderRef: freshOrder.reference,
        supplierId: freshOrder.supplierId,
        supplierName: freshOrder.supplierName,
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        inspectionStatus,
        deliveryNoteRef: deliveryNoteRef || '',
        notes: notes || '',
        lines: receiptLines,
        receivedByUid: actor.uid,
        receivedByName: actor.displayName,
        memberUids,
        createdAt: serverTimestamp(),
      });

      tx.update(poRef, {
        lines: updatedOrderLines,
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });

      for (let i = 0; i < balanceReads.length; i++) {
        const { line, balId, balRef, snap } = balanceReads[i];
        const rLine = receiptLines[i];
        if (rLine.acceptedQty <= 0) continue;

        const existingBal = snap.exists() ? (snap.data() as StockBalance) : null;
        const newPhysical = (existingBal?.physicalQty ?? 0) + rLine.acceptedQty;
        const reserved = existingBal?.reservedQty ?? 0;
        const newOnOrder = Math.max(0, (existingBal?.onOrderQty ?? 0) - rLine.acceptedQty);
        const mvtId = generateSafeId('mvt');

        if (snap.exists()) {
          tx.update(balRef, {
            physicalQty: newPhysical,
            availableQty: Math.max(0, newPhysical - reserved),
            onOrderQty: newOnOrder,
            unitCost: rLine.unitCost,
            lastMovementId: mvtId,
            updatedAt: serverTimestamp(),
          });
        } else {
          tx.set(balRef, {
            id: balId,
            orgId,
            productId: rLine.productId,
            productSku: rLine.productSku,
            productName: rLine.productName,
            warehouseId: warehouse.id,
            warehouseName: warehouse.name,
            locationId: rLine.locationId,
            locationCode: rLine.locationCode,
            physicalQty: newPhysical,
            reservedQty: 0,
            onOrderQty: 0,
            inTransitQty: 0,
            availableQty: newPhysical,
            unitCost: rLine.unitCost,
            lastMovementId: mvtId,
            memberUids,
            updatedAt: serverTimestamp(),
          });
        }

        tx.set(doc(db, 'organizations', orgId, 'stockMovements', mvtId), {
          id: mvtId,
          orgId,
          reference: `MVT-${nowStr}-${mvtId.slice(-5).toUpperCase()}`,
          movementType: 'IN',
          productId: rLine.productId,
          productSku: rLine.productSku,
          productName: rLine.productName,
          warehouseId: warehouse.id,
          warehouseName: warehouse.name,
          locationId: rLine.locationId,
          locationCode: rLine.locationCode,
          quantity: rLine.acceptedQty,
          unitCost: rLine.unitCost,
          reason: `Réception commande ${freshOrder.reference} (${freshOrder.supplierName})`,
          sourceDocumentType: 'Réception fournisseur',
          sourceDocumentRef: receiptRef,
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
        action: 'GOODS_RECEIPT_VALIDATED',
        entityType: 'goods_receipt',
        entityId: receiptId,
        summary: `Réception ${receiptRef} sur commande ${freshOrder.reference} (${inspectionStatus})`,
        memberUids,
        createdAt: serverTimestamp(),
      });
    });

    return receiptRef;
  } catch (error) {
    if (error instanceof Error && (error.message.includes('Quantité') || error.message.includes('Commande') || error.message.includes('Emplacement'))) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// ---------------------------------------------------------------------------
// Supplier Invoices & Payments
// ---------------------------------------------------------------------------
export async function createSupplierInvoice(params: {
  orgId: string;
  memberUids: string[];
  order: PurchaseOrder;
  input: SupplierInvoiceInput;
  actor: { uid: string; email: string };
}): Promise<string> {
  const { orgId, memberUids, order, input, actor } = params;
  const id = generateSafeId('sinv');
  const path = `organizations/${orgId}/supplierInvoices/${id}`;

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'organizations', orgId, 'supplierInvoices', id), {
      id,
      orgId,
      invoiceNumber: input.invoiceNumber,
      purchaseOrderId: order.id,
      purchaseOrderRef: order.reference,
      supplierId: order.supplierId,
      supplierName: order.supplierName,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      totalHt: Number(input.totalHt),
      totalVat: Number(input.totalVat),
      totalTtc: Number(input.totalTtc),
      paidAmount: 0,
      status: 'pending',
      notes: input.notes || '',
      createdByUid: actor.uid,
      memberUids,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (order.status === 'received' || order.status === 'partially_received') {
      batch.update(doc(db, 'organizations', orgId, 'purchaseOrders', order.id), {
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
      action: 'SUPPLIER_INVOICE_CREATED',
      entityType: 'supplier_invoice',
      entityId: id,
      summary: `Facture fournisseur ${input.invoiceNumber} (${order.supplierName}) — ${Number(input.totalTtc).toFixed(2)} TTC`,
      memberUids,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function recordSupplierInvoicePayment(params: {
  orgId: string;
  memberUids: string[];
  invoice: SupplierInvoice;
  amount: number;
  actor: { uid: string; email: string };
}): Promise<void> {
  const { orgId, memberUids, invoice, amount, actor } = params;
  const nextPaid = Number(Math.min(invoice.totalTtc, invoice.paidAmount + amount).toFixed(2));
  const nextStatus: SupplierInvoice['status'] =
    nextPaid >= invoice.totalTtc ? 'paid' : nextPaid > 0 ? 'partially_paid' : 'pending';
  const path = `organizations/${orgId}/supplierInvoices/${invoice.id}`;

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'organizations', orgId, 'supplierInvoices', invoice.id), {
      paidAmount: nextPaid,
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });

    if (nextStatus === 'paid') {
      batch.update(doc(db, 'organizations', orgId, 'purchaseOrders', invoice.purchaseOrderId), {
        status: 'closed',
        updatedAt: serverTimestamp(),
      });
    }

    const logId = generateSafeId('log');
    batch.set(doc(db, 'organizations', orgId, 'auditLogs', logId), {
      id: logId,
      orgId,
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: 'SUPPLIER_PAYMENT_RECORDED',
      entityType: 'supplier_invoice',
      entityId: invoice.id,
      summary: `Règlement de ${amount.toFixed(2)} sur facture ${invoice.invoiceNumber} (${nextStatus})`,
      memberUids,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// ---------------------------------------------------------------------------
// Demo Seed Helper for Phase 3 (explicitly tagged isDemo: true)
// ---------------------------------------------------------------------------
export async function seedPurchasingDemoData(params: {
  orgId: string;
  memberUids: string[];
  products: Product[];
  warehouse: Warehouse;
  actor: { uid: string; email: string; displayName: string };
}): Promise<void> {
  const { orgId, memberUids, products, warehouse, actor } = params;
  const batch = writeBatch(db);

  const demoSuppliers = [
    {
      id: 'sup_optisense',
      code: 'FR-OPTI',
      name: 'OptiSense Automation SAS',
      contactName: 'Claire Moreau',
      email: 'commandes@optisense-demo.fr',
      phone: '+33 1 42 68 55 10',
      address: '22 Rue Ampère',
      city: 'Massy',
      country: 'France',
      siret: '812 345 678 00024',
      vatNumber: 'FR45812345678',
      paymentTerms: '30 jours fin de mois',
      leadTimeDays: 4,
      rating: 4.8,
      onTimeRate: 97,
    },
    {
      id: 'sup_pneumax',
      code: 'FR-PNEU',
      name: 'Pneumax Distribution Europe',
      contactName: 'Marc Lefèvre',
      email: 'adv@pneumax-demo.eu',
      phone: '+33 4 72 19 88 40',
      address: '5 Parc Technologique',
      city: 'Lyon',
      country: 'France',
      siret: '529 887 412 00019',
      vatNumber: 'FR12529887412',
      paymentTerms: '45 jours',
      leadTimeDays: 6,
      rating: 4.4,
      onTimeRate: 92,
    },
    {
      id: 'sup_packnord',
      code: 'FR-PACK',
      name: 'PackNord Emballages Industriels',
      contactName: 'Sophie Laurent',
      email: 'devis@packnord-demo.fr',
      phone: '+33 3 20 55 12 90',
      address: '18 Zone Logistique Lesquin',
      city: 'Lille',
      country: 'France',
      siret: '490 112 334 00031',
      vatNumber: 'FR89490112334',
      paymentTerms: 'Comptant / 30 jours',
      leadTimeDays: 3,
      rating: 4.6,
      onTimeRate: 95,
    },
  ];

  for (const s of demoSuppliers) {
    batch.set(doc(db, 'organizations', orgId, 'suppliers', s.id), {
      ...s,
      orgId,
      status: 'active',
      notes: 'Fournisseur de démonstration (Phase 3)',
      isDemo: true,
      memberUids,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const p0 = products[0];
  if (p0) {
    const poLines: PurchaseOrderLine[] = [
      {
        productId: p0.id,
        productSku: p0.sku,
        productName: p0.name,
        unit: p0.unit,
        quantity: 20,
        receivedQty: 0,
        unitPrice: p0.purchasePrice,
        discountPct: 5,
        vatRate: p0.vatRate,
      },
    ];
    const totals = computeOrderTotals(poLines, 35);
    batch.set(doc(db, 'organizations', orgId, 'purchaseOrders', 'po_demo_01'), {
      id: 'po_demo_01',
      orgId,
      reference: 'CF-DEMO-0001',
      supplierId: 'sup_pneumax',
      supplierName: 'Pneumax Distribution Europe',
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      status: 'confirmed',
      expectedDate: new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10),
      paymentTerms: '45 jours',
      shippingCost: 35,
      subtotalHt: totals.subtotalHt,
      vatTotal: totals.vatTotal,
      totalTtc: totals.totalTtc,
      lines: poLines,
      notes: 'Commande de démonstration prête à être réceptionnée',
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
    action: 'PURCHASING_DEMO_SEEDED',
    entityType: 'supplier',
    entityId: orgId,
    summary: 'Initialisation des fournisseurs et commande de démonstration (Phase 3)',
    memberUids,
    createdAt: serverTimestamp(),
  });

  await batch.commit();
}
