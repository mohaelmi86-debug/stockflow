import { Router, type Response } from 'express';
import { FieldValue, type DocumentData, type DocumentReference, type QueryDocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { requireAuth, type AuthRequest } from './authMiddleware.ts';
import { adminDb } from './firebaseAdmin.ts';
import {
  assertReservationConsistency,
  assertUniqueProductLines,
  computeAvailableQuantity,
  roundStock,
  validateReceiptQuantities,
} from './stockEngineCore.ts';

type Handler = (req: AuthRequest, res: Response) => Promise<void>;
type Actor = { uid: string; email: string; displayName: string };

const router = Router();
router.use(requireAuth);

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

function text(value: unknown, label: string, max = 128): string {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > max) {
    throw new Error(`${label} invalide.`);
  }
  return value.trim();
}

function documentId(value: unknown, label: string): string {
  const parsed = text(value, label);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(parsed)) throw new Error(`${label} invalide.`);
  return parsed;
}

function quantity(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} doit être un nombre fini.`);
  return parsed;
}

function wrap(handler: Handler): Handler {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur interne du moteur de stock.';
      const clientError = /invalide|insuffisant|introuvable|interdit|impossible|incohérent|réserv|quantité|commande|entrepôt|emplacement|refus|contrôle|produit|réception|déjà/i.test(message);
      if (!res.headersSent) res.status(clientError ? 400 : 500).json({ error: message });
    }
  };
}

function actorFrom(req: AuthRequest): Actor {
  const user = req.user;
  if (!user?.uid) throw new Error('Authentification requise.');
  return {
    uid: user.uid,
    email: user.email ?? '',
    displayName: typeof user.name === 'string' && user.name.trim() ? user.name.trim().slice(0, 120) : (user.email ?? 'Utilisateur').slice(0, 120),
  };
}

async function authorizeOrg(orgId: string, actor: Actor) {
  const [orgSnap, memberSnap] = await Promise.all([
    adminDb.doc(`organizations/${orgId}`).get(),
    adminDb.doc(`organizations/${orgId}/members/${actor.uid}`).get(),
  ]);
  if (!orgSnap.exists || !memberSnap.exists) throw new Error('Organisation ou adhésion introuvable.');
  const member = memberSnap.data()!;
  if (member.status !== 'active') throw new Error('Adhésion inactive : opération interdite.');
  if (!['owner', 'admin', 'manager', 'operator'].includes(String(member.role))) {
    throw new Error('Votre rôle ne permet pas cette opération.');
  }
  return { org: orgSnap.data()!, member };
}

function auditPayload(orgId: string, actor: Actor, action: string, entityType: string, entityId: string, summary: string, memberUids: string[]) {
  const logId = id('log');
  return {
    ref: adminDb.doc(`organizations/${orgId}/auditLogs/${logId}`),
    data: {
      id: logId, orgId, actorUid: actor.uid, actorEmail: actor.email,
      action, entityType, entityId, summary,
      memberUids, createdAt: FieldValue.serverTimestamp(),
    },
  };
}

function assertBalanceCoherent(balance: DocumentData) {
  const expected = computeAvailableQuantity(balance.physicalQty, balance.reservedQty);
  const available = Number(balance.availableQty);
  if (!Number.isFinite(available) || Math.abs(available - expected) > 0.001) {
    throw new Error(`Solde incohérent pour ${balance.productSku ?? balance.productId} : disponible enregistré différent du stock physique moins réservations. Une réconciliation est nécessaire.`);
  }
  return expected;
}

async function assertMemberInTransaction(
  tx: Transaction,
  orgId: string,
  actor: Actor,
  adminOnly = false,
): Promise<void> {
  const memberSnap = await tx.get(adminDb.doc(`organizations/${orgId}/members/${actor.uid}`));
  if (!memberSnap.exists || memberSnap.data()!.status !== 'active') throw new Error('Adhésion inactive : opération interdite.');
  const allowed = adminOnly ? ['owner', 'admin'] : ['owner', 'admin', 'manager', 'operator'];
  if (!allowed.includes(String(memberSnap.data()!.role))) throw new Error('Votre rôle ne permet pas cette opération.');
}

function nonTerminal(status: unknown, operation: string) {
  if (['canceled', 'closed', 'delivered', 'invoiced'].includes(String(status))) {
    throw new Error(`Impossible de ${operation} une commande terminée, annulée ou clôturée.`);
  }
}

router.post('/reserve', wrap(async (req, res) => {
  const actor = actorFrom(req);
  const orgId = documentId(req.body?.orgId, 'Organisation');
  const orderId = documentId(req.body?.orderId, 'Commande');
  const { org } = await authorizeOrg(orgId, actor);
  const memberUids = Array.isArray(org.memberUids) ? org.memberUids.slice(0, 50) : [actor.uid];
  const orderRef = adminDb.doc(`organizations/${orgId}/salesOrders/${orderId}`);

  const result = await adminDb.runTransaction(async (tx) => {
    await assertMemberInTransaction(tx, orgId, actor);
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) throw new Error('Commande client introuvable.');
    const order = orderSnap.data()!;
    nonTerminal(order.status, 'réserver');
    if (!Array.isArray(order.lines) || !order.lines.length) throw new Error('La commande ne contient aucune ligne.');
    assertUniqueProductLines(order.lines, 'Commande client');
    const lines = order.lines.map((line: any) => ({ ...line, reservationAllocations: [...(line.reservationAllocations ?? [])] }));
    for (const line of lines) {
      const allocations = assertReservationConsistency(line);
      if (allocations.some((allocation) => allocation.warehouseId !== order.warehouseId)) {
        throw new Error(`Allocation de réservation hors de l'entrepôt de la commande pour ${line.productSku}.`);
      }
      const unshipped = Math.max(0, Number(line.quantity) - Number(line.deliveredQty ?? 0));
      if (Number(line.reservedQty ?? 0) > unshipped + 0.0001) {
        throw new Error(`Réservation supérieure au reliquat de ${line.productSku}.`);
      }
    }

    const reads = new Map<string, QueryDocumentSnapshot[]>();
    for (const productId of [...new Set(lines.map((line: any) => line.productId))]) {
      const snapshot = await tx.get(adminDb.collection(`organizations/${orgId}/stockBalances`)
        .where('productId', '==', productId).where('warehouseId', '==', order.warehouseId));
      reads.set(productId, snapshot.docs);
    }

    const balances = new Map<string, { ref: DocumentReference; data: DocumentData; add: number }>();
    for (const docs of reads.values()) {
      for (const snap of docs) {
        const data = snap.data();
        assertBalanceCoherent(data);
        balances.set(snap.id, { ref: snap.ref, data, add: 0 });
      }
    }

    for (const line of lines) {
      const needed = Math.max(0, quantity(line.quantity, 'Quantité commandée') - quantity(line.deliveredQty ?? 0, 'Quantité livrée') - quantity(line.reservedQty ?? 0, 'Quantité réservée'));
      let remaining = roundStock(needed);
      if (remaining <= 0) continue;
      const candidates = [...balances.values()]
        .filter((entry) => entry.data.productId === line.productId && entry.data.warehouseId === order.warehouseId)
        .sort((a, b) => String(a.data.locationCode).localeCompare(String(b.data.locationCode)));
      for (const entry of candidates) {
        const free = Math.max(0, Number(entry.data.physicalQty) - Number(entry.data.reservedQty) - entry.add);
        if (free <= 0) continue;
        const take = roundStock(Math.min(free, remaining));
        if (take <= 0) continue;
        const existing = line.reservationAllocations.find((allocation: any) =>
          allocation.warehouseId === entry.data.warehouseId && allocation.locationId === entry.data.locationId);
        if (existing) existing.quantity = roundStock(existing.quantity + take);
        else line.reservationAllocations.push({ warehouseId: entry.data.warehouseId, locationId: entry.data.locationId, quantity: take });
        line.reservedQty = roundStock(Number(line.reservedQty ?? 0) + take);
        entry.add = roundStock(entry.add + take);
        remaining = roundStock(remaining - take);
        if (remaining <= 0.0001) break;
      }
      if (remaining > 0.0001) throw new Error(`Stock insuffisant dans ${order.warehouseName} pour ${line.productSku} (manque ${remaining}).`);
    }

    for (const entry of balances.values()) {
      if (entry.add <= 0) continue;
      const reservedQty = roundStock(Number(entry.data.reservedQty) + entry.add);
      tx.update(entry.ref, {
        reservedQty,
        availableQty: computeAvailableQuantity(entry.data.physicalQty, reservedQty),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    const stockReserved = lines.some((line: any) => Number(line.reservedQty) > 0);
    tx.update(orderRef, {
      lines, stockReserved,
      status: order.status === 'draft' ? 'confirmed' : order.status === 'confirmed' ? 'preparing' : order.status,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const log = auditPayload(orgId, actor, 'SALES_ORDER_STOCK_RESERVED', 'sales_order', orderId,
      `Réservation atomique de stock par emplacement pour ${order.reference}`, memberUids);
    tx.create(log.ref, log.data);
    return { reserved: lines.reduce((sum: number, line: any) => sum + Number(line.reservedQty ?? 0), 0) };
  });
  res.json({ ok: true, ...result });
}));

router.post('/cancel', wrap(async (req, res) => {
  const actor = actorFrom(req);
  const orgId = documentId(req.body?.orgId, 'Organisation');
  const orderId = documentId(req.body?.orderId, 'Commande');
  const { org } = await authorizeOrg(orgId, actor);
  const memberUids = Array.isArray(org.memberUids) ? org.memberUids.slice(0, 50) : [actor.uid];
  const orderRef = adminDb.doc(`organizations/${orgId}/salesOrders/${orderId}`);

  await adminDb.runTransaction(async (tx) => {
    await assertMemberInTransaction(tx, orgId, actor);
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) throw new Error('Commande client introuvable.');
    const order = orderSnap.data()!;
    if (['closed', 'canceled', 'delivered', 'invoiced'].includes(String(order.status))) throw new Error('Commande déjà terminée, clôturée ou annulée.');
    if (!Array.isArray(order.lines)) throw new Error('Lignes de commande invalides.');
    assertUniqueProductLines(order.lines, 'Commande client');

    const grouped = new Map<string, { productId: string; warehouseId: string; locationId: string; quantity: number }>();
    for (const line of order.lines) {
      const allocations = assertReservationConsistency(line);
      if (allocations.some((allocation) => allocation.warehouseId !== order.warehouseId)) throw new Error('Une allocation de réservation ne correspond pas à l’entrepôt de la commande.');
      for (const allocation of allocations) {
        const key = `${line.productId}_${allocation.warehouseId}_${allocation.locationId}`;
        const current = grouped.get(key);
        if (current) current.quantity = roundStock(current.quantity + allocation.quantity);
        else grouped.set(key, { productId: line.productId, warehouseId: allocation.warehouseId, locationId: allocation.locationId, quantity: allocation.quantity });
      }
    }
    const entries = [...grouped.entries()];
    const snaps = await Promise.all(entries.map(([key]) => tx.get(adminDb.doc(`organizations/${orgId}/stockBalances/${key}`))));
    for (let i = 0; i < entries.length; i++) {
      const [key, group] = entries[i];
      const snap = snaps[i];
      if (!snap.exists) throw new Error(`Solde introuvable pour libérer la réservation ${key}.`);
      const balance = snap.data()!;
      assertBalanceCoherent(balance);
      if (Number(balance.reservedQty) + 0.0001 < group.quantity) throw new Error(`Réservation incohérente pour ${balance.productSku} / ${balance.locationCode}.`);
    }
    for (let i = 0; i < entries.length; i++) {
      const [key, group] = entries[i];
      const balance = snaps[i].data()!;
      const reservedQty = roundStock(Number(balance.reservedQty) - group.quantity);
      tx.update(snaps[i].ref, {
        reservedQty,
        availableQty: computeAvailableQuantity(balance.physicalQty, reservedQty),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    const lines = order.lines.map((line: any) => ({ ...line, reservedQty: 0, reservationAllocations: [] }));
    tx.update(orderRef, { lines, stockReserved: false, status: 'canceled', updatedAt: FieldValue.serverTimestamp() });
    const log = auditPayload(orgId, actor, 'SALES_ORDER_CANCELED', 'sales_order', orderId,
      `Annulation de ${order.reference} et libération exacte des allocations`, memberUids);
    tx.create(log.ref, log.data);
  });
  res.json({ ok: true });
}));

router.post('/ship', wrap(async (req, res) => {
  const actor = actorFrom(req);
  const orgId = documentId(req.body?.orgId, 'Organisation');
  const orderId = documentId(req.body?.orderId, 'Commande');
  const warehouseId = documentId(req.body?.warehouseId, 'Entrepôt');
  const linesInput = req.body?.linesInput;
  if (!Array.isArray(linesInput) || !linesInput.length) throw new Error('Aucune ligne de livraison.');
  const inputKeys = new Set<string>();
  for (const line of linesInput) {
    const productId = documentId(line.productId, 'Produit');
    const locationId = documentId(line.locationId, 'Emplacement');
    const deliveredQty = quantity(line.deliveredQty, 'Quantité expédiée');
    if (deliveredQty <= 0) throw new Error('Les quantités expédiées doivent être strictement positives.');
    const key = `${productId}_${locationId}`;
    if (inputKeys.has(key)) throw new Error('Une seule ligne de livraison est autorisée par produit et emplacement.');
    inputKeys.add(key);
  }
  const { org } = await authorizeOrg(orgId, actor);
  const memberUids = Array.isArray(org.memberUids) ? org.memberUids.slice(0, 50) : [actor.uid];
  const orderRef = adminDb.doc(`organizations/${orgId}/salesOrders/${orderId}`);
  const warehouseRef = adminDb.doc(`organizations/${orgId}/warehouses/${warehouseId}`);
  const deliveryId = id('dn');
  const deliveryRef = `BL-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${deliveryId.slice(-4).toUpperCase()}`;
  const noteRef = adminDb.doc(`organizations/${orgId}/deliveryNotes/${deliveryId}`);

  await adminDb.runTransaction(async (tx) => {
    await assertMemberInTransaction(tx, orgId, actor);
    const [orderSnap, warehouseSnap] = await Promise.all([tx.get(orderRef), tx.get(warehouseRef)]);
    if (!orderSnap.exists) throw new Error('Commande client introuvable.');
    if (!warehouseSnap.exists || warehouseSnap.data()!.status !== 'active') throw new Error('Entrepôt de livraison invalide.');
    const order = orderSnap.data()!;
    nonTerminal(order.status, 'expédier');
    if (order.warehouseId !== warehouseId) throw new Error('Entrepôt de livraison différent de celui de la commande.');
    if (!Array.isArray(order.lines)) throw new Error('Lignes de commande invalides.');
    assertUniqueProductLines(order.lines, 'Commande client');
    const lines = order.lines.map((line: any) => ({ ...line, reservationAllocations: [...(line.reservationAllocations ?? [])] }));
    for (const line of lines) assertReservationConsistency(line);

    const locationRefs = linesInput.map((line: any) => adminDb.doc(`organizations/${orgId}/locations/${documentId(line.locationId, 'Emplacement')}`));
    const balanceRefs = linesInput.map((line: any) => adminDb.doc(`organizations/${orgId}/stockBalances/${documentId(line.productId, 'Produit')}_${warehouseId}_${documentId(line.locationId, 'Emplacement')}`));
    const productRefs = [...new Set(linesInput.map((line: any) => String(line.productId)))].map((productId) => adminDb.doc(`organizations/${orgId}/products/${productId}`));
    const [locationSnaps, balanceSnaps, productSnaps] = await Promise.all([
      Promise.all(locationRefs.map((ref) => tx.get(ref))),
      Promise.all(balanceRefs.map((ref) => tx.get(ref))),
      Promise.all(productRefs.map((ref) => tx.get(ref))),
    ]);
    const products = new Map(productSnaps.filter((snap) => snap.exists).map((snap) => [snap.id, snap.data()!]));
    if (products.size !== productRefs.length) throw new Error('Un produit de la livraison est introuvable.');
    const deliveryLines: any[] = [];
    const movementWrites: Array<{ ref: DocumentReference; data: any; balanceRef: DocumentReference; balanceData: any }> = [];

    for (let i = 0; i < linesInput.length; i++) {
      const input = linesInput[i];
      const orderLine = lines.find((line: any) => line.productId === input.productId);
      if (!orderLine) throw new Error(`Produit ${input.productId} absent de la commande.`);
      const location = locationSnaps[i].data();
      if (!locationSnaps[i].exists || location!.warehouseId !== warehouseId || location!.status !== 'active') throw new Error('Emplacement source invalide ou bloqué.');
      const balanceSnap = balanceSnaps[i];
      if (!balanceSnap.exists) throw new Error(`Aucun stock trouvé pour ${orderLine.productSku}.`);
      const balance = balanceSnap.data()!;
      assertBalanceCoherent(balance);
      const deliveredQty = quantity(input.deliveredQty, 'Quantité expédiée');
      const remaining = Math.max(0, Number(orderLine.quantity) - Number(orderLine.deliveredQty ?? 0));
      if (deliveredQty > remaining + 0.0001) throw new Error(`Quantité expédiée supérieure au reliquat pour ${orderLine.productSku}.`);
      const allocation = orderLine.reservationAllocations.find((item: any) => item.warehouseId === warehouseId && item.locationId === input.locationId);
      const allocatedHere = Number(allocation?.quantity ?? 0);
      const usable = Number(balance.availableQty) + allocatedHere;
      if (deliveredQty > usable + 0.0001) throw new Error(`Stock insuffisant sur ${location!.code} pour ${orderLine.productSku}.`);
      const consumeReservation = Math.min(allocatedHere, deliveredQty);
      const nextLineReserved = roundStock(Number(orderLine.reservedQty ?? 0) - consumeReservation);
      const nextLineDelivered = roundStock(Number(orderLine.deliveredQty ?? 0) + deliveredQty);
      const remainingAfterDelivery = Math.max(0, Number(orderLine.quantity) - nextLineDelivered);
      if (nextLineReserved > remainingAfterDelivery + 0.0001) {
        throw new Error(`Cette expédition laisserait une réservation excédentaire pour ${orderLine.productSku}. Expédiez depuis un emplacement alloué ou libérez d'abord la réservation excédentaire.`);
      }
      if (allocation) allocation.quantity = roundStock(allocation.quantity - consumeReservation);
      orderLine.reservationAllocations = orderLine.reservationAllocations.filter((item: any) => item.quantity > 0.0001);
      orderLine.reservedQty = nextLineReserved;
      orderLine.deliveredQty = nextLineDelivered;
      const nextPhysical = roundStock(Number(balance.physicalQty) - deliveredQty);
      const nextReserved = roundStock(Number(balance.reservedQty) - consumeReservation);
      if (nextPhysical < nextReserved - 0.0001 || nextPhysical < -0.0001) throw new Error('La livraison ferait passer le stock sous les réservations restantes.');
      const movementId = id('mvt');
      const product = products.get(String(input.productId))!;
      const line = {
        productId: orderLine.productId, productSku: product.sku, productName: product.name,
        locationId: location!.id, locationCode: location!.code,
        deliveredQty, unitCost: Number(balance.unitCost),
      };
      deliveryLines.push(line);
      movementWrites.push({
        ref: adminDb.doc(`organizations/${orgId}/stockMovements/${movementId}`),
        data: {
          id: movementId, orgId,
          reference: `MVT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${movementId.slice(-5).toUpperCase()}`,
          movementType: 'OUT', productId: product.id, productSku: product.sku, productName: product.name,
          warehouseId, warehouseName: warehouseSnap.data()!.name,
          locationId: location!.id, locationCode: location!.code,
          quantity: -deliveredQty, unitCost: Number(balance.unitCost),
          reason: `Expédition commande ${order.reference} (${order.customerName})`,
          sourceDocumentType: 'Bon de livraison client', sourceDocumentRef: deliveryRef,
          performedByUid: actor.uid, performedByName: actor.displayName,
          isDemo: false, memberUids, createdAt: FieldValue.serverTimestamp(),
        },
        balanceRef: balanceRefs[i],
        balanceData: {
          physicalQty: Math.max(0, nextPhysical), reservedQty: Math.max(0, nextReserved),
          availableQty: computeAvailableQuantity(nextPhysical, nextReserved), lastMovementId: movementId,
        },
      });
    }
    const allDelivered = lines.every((line: any) => Number(line.deliveredQty) >= Number(line.quantity) - 0.0001);
    const stillReserved = lines.some((line: any) => Number(line.reservedQty) > 0.0001);
    const nextStatus = allDelivered ? 'delivered' : lines.some((line: any) => Number(line.deliveredQty) > 0) ? 'partially_delivered' : order.status;

    tx.create(noteRef, {
      id: deliveryId, orgId, reference: deliveryRef,
      salesOrderId: orderId, salesOrderRef: order.reference,
      customerId: order.customerId, customerName: order.customerName,
      warehouseId, warehouseName: warehouseSnap.data()!.name,
      carrier: String(req.body?.carrier ?? '').slice(0, 80),
      trackingNumber: String(req.body?.trackingNumber ?? '').slice(0, 64),
      notes: String(req.body?.notes ?? '').slice(0, 400),
      lines: deliveryLines, deliveredByUid: actor.uid, deliveredByName: actor.displayName,
      memberUids, createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(orderRef, { lines, stockReserved: stillReserved, status: nextStatus, updatedAt: FieldValue.serverTimestamp() });
    for (const write of movementWrites) {
      tx.update(write.balanceRef, { ...write.balanceData, updatedAt: FieldValue.serverTimestamp() });
      tx.create(write.ref, write.data);
    }
    const log = auditPayload(orgId, actor, 'DELIVERY_NOTE_SHIPPED', 'delivery_note', deliveryId,
      `Bon de livraison ${deliveryRef} sur commande ${order.reference}`, memberUids);
    tx.create(log.ref, log.data);
  });
  res.json({ ok: true, reference: deliveryRef });
}));

router.post('/receipt', wrap(async (req, res) => {
  const actor = actorFrom(req);
  const orgId = documentId(req.body?.orgId, 'Organisation');
  const orderId = documentId(req.body?.orderId, 'Commande fournisseur');
  const warehouseId = documentId(req.body?.warehouseId, 'Entrepôt');
  const linesInput = req.body?.linesInput;
  const inspectionStatus = req.body?.inspectionStatus;
  if (!['passed', 'partial_issue', 'rejected'].includes(String(inspectionStatus))) throw new Error('Statut de contrôle qualité invalide.');
  if (!Array.isArray(linesInput) || !linesInput.length) throw new Error('Aucune ligne de réception.');
  assertUniqueProductLines(linesInput, 'Réception fournisseur');
  const normalized = linesInput.map((line: any) => {
    const receivedQty = quantity(line.receivedQty, 'Quantité reçue');
    if (receivedQty < 0) throw new Error('La quantité reçue ne peut pas être négative.');
    if (receivedQty === 0) return null;
    return {
      productId: documentId(line.productId, 'Produit'),
      locationId: documentId(line.locationId, 'Emplacement'),
      ...validateReceiptQuantities(line, inspectionStatus),
    };
  }).filter(Boolean) as Array<{ productId: string; locationId: string; receivedQty: number; acceptedQty: number; rejectedQty: number }>;
  if (!normalized.length) throw new Error('Saisissez au moins une quantité reçue.');
  if (inspectionStatus === 'partial_issue' && !normalized.some((line) => line.rejectedQty > 0)) {
    throw new Error('Un contrôle « avec réserve » doit comporter au moins une quantité rejetée.');
  }
  const { org } = await authorizeOrg(orgId, actor);
  const memberUids = Array.isArray(org.memberUids) ? org.memberUids.slice(0, 50) : [actor.uid];
  const orderRef = adminDb.doc(`organizations/${orgId}/purchaseOrders/${orderId}`);
  const warehouseRef = adminDb.doc(`organizations/${orgId}/warehouses/${warehouseId}`);
  const receiptId = id('gr');
  const receiptRef = `BR-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${receiptId.slice(-4).toUpperCase()}`;

  await adminDb.runTransaction(async (tx) => {
    await assertMemberInTransaction(tx, orgId, actor);
    const [orderSnap, warehouseSnap] = await Promise.all([tx.get(orderRef), tx.get(warehouseRef)]);
    if (!orderSnap.exists) throw new Error('Commande fournisseur introuvable.');
    if (!warehouseSnap.exists || warehouseSnap.data()!.status !== 'active') throw new Error('Entrepôt de réception invalide.');
    const order = orderSnap.data()!;
    if (['canceled', 'closed'].includes(String(order.status))) throw new Error('Impossible de réceptionner une commande annulée ou clôturée.');
    if (order.warehouseId !== warehouseId) throw new Error('Entrepôt de réception différent de celui de la commande.');
    assertUniqueProductLines(order.lines ?? [], 'Commande fournisseur');

    const locationRefs = normalized.map((line: any) => adminDb.doc(`organizations/${orgId}/locations/${line.locationId}`));
    const balanceRefs = normalized.map((line: any) => adminDb.doc(`organizations/${orgId}/stockBalances/${line.productId}_${warehouseId}_${line.locationId}`));
    const productRefs = normalized.map((line: any) => adminDb.doc(`organizations/${orgId}/products/${line.productId}`));
    const [locationSnaps, balanceSnaps, productSnaps] = await Promise.all([
      Promise.all(locationRefs.map((ref) => tx.get(ref))),
      Promise.all(balanceRefs.map((ref) => tx.get(ref))),
      Promise.all(productRefs.map((ref) => tx.get(ref))),
    ]);
    const updatedOrderLines = order.lines.map((line: any) => ({ ...line }));
    const receiptLines: any[] = [];
    const stockWrites: Array<{ balanceRef: DocumentReference; movementRef: DocumentReference; balanceData: any; movementData: any }> = [];

    for (let i = 0; i < normalized.length; i++) {
      const input = normalized[i];
      const orderLine = updatedOrderLines.find((line: any) => line.productId === input.productId);
      if (!orderLine) throw new Error(`Produit ${input.productId} absent de la commande.`);
      const remaining = Math.max(0, Number(orderLine.quantity) - Number(orderLine.receivedQty ?? 0));
      if (input.receivedQty > remaining + 0.0001) throw new Error(`Quantité reçue supérieure au reliquat pour ${orderLine.productSku}.`);
      const location = locationSnaps[i].data();
      if (!locationSnaps[i].exists || location!.warehouseId !== warehouseId || !['receiving', 'storage'].includes(String(location!.zoneType)) || location!.status !== 'active') {
        throw new Error('Emplacement de réception invalide ou non autorisé.');
      }
      const productSnap = productSnaps[i];
      if (!productSnap.exists) throw new Error('Produit de réception introuvable.');
      const existing = balanceSnaps[i].data();
      if (existing) assertBalanceCoherent(existing);
      const product = productSnap.data()!;
      const unitCost = Number((Number(orderLine.unitPrice) * (1 - Number(orderLine.discountPct ?? 0) / 100)).toFixed(4));
      orderLine.receivedQty = roundStock(Number(orderLine.receivedQty ?? 0) + input.acceptedQty);
      receiptLines.push({
        productId: product.id, productSku: product.sku, productName: product.name,
        locationId: location!.id, locationCode: location!.code,
        receivedQty: input.receivedQty, acceptedQty: input.acceptedQty,
        rejectedQty: input.rejectedQty, unitCost,
      });
      if (input.acceptedQty <= 0) continue;
      const physicalQty = roundStock(Number(existing?.physicalQty ?? 0) + input.acceptedQty);
      const reservedQty = Number(existing?.reservedQty ?? 0);
      const availableQty = computeAvailableQuantity(physicalQty, reservedQty);
      const movementId = id('mvt');
      const balanceData = {
        id: `${input.productId}_${warehouseId}_${input.locationId}`, orgId,
        productId: product.id, productSku: product.sku, productName: product.name,
        warehouseId, warehouseName: warehouseSnap.data()!.name,
        locationId: location!.id, locationCode: location!.code,
        physicalQty, reservedQty, onOrderQty: Number(existing?.onOrderQty ?? 0),
        inTransitQty: Number(existing?.inTransitQty ?? 0), availableQty,
        unitCost, lastMovementId: movementId, memberUids, updatedAt: FieldValue.serverTimestamp(),
      };
      const movementData = {
        id: movementId, orgId,
        reference: `MVT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${movementId.slice(-5).toUpperCase()}`,
        movementType: 'IN', productId: product.id, productSku: product.sku, productName: product.name,
        warehouseId, warehouseName: warehouseSnap.data()!.name,
        locationId: location!.id, locationCode: location!.code,
        quantity: input.acceptedQty, unitCost,
        reason: `Réception commande ${order.reference} (${order.supplierName})`,
        sourceDocumentType: 'Réception fournisseur', sourceDocumentRef: receiptRef,
        performedByUid: actor.uid, performedByName: actor.displayName,
        isDemo: false, memberUids, createdAt: FieldValue.serverTimestamp(),
      };
      stockWrites.push({ balanceRef: balanceRefs[i], movementRef: adminDb.doc(`organizations/${orgId}/stockMovements/${movementId}`), balanceData, movementData });
    }

    const allFulfilled = updatedOrderLines.every((line: any) => Number(line.receivedQty ?? 0) >= Number(line.quantity) - 0.0001);
    const anyReceived = updatedOrderLines.some((line: any) => Number(line.receivedQty ?? 0) > 0);
    const nextStatus = allFulfilled ? 'received' : anyReceived ? 'partially_received' : order.status;
    tx.create(adminDb.doc(`organizations/${orgId}/goodsReceipts/${receiptId}`), {
      id: receiptId, orgId, reference: receiptRef, purchaseOrderId: orderId, purchaseOrderRef: order.reference,
      supplierId: order.supplierId, supplierName: order.supplierName,
      warehouseId, warehouseName: warehouseSnap.data()!.name,
      inspectionStatus, deliveryNoteRef: String(req.body?.deliveryNoteRef ?? '').slice(0, 64),
      notes: String(req.body?.notes ?? '').slice(0, 400),
      lines: receiptLines, receivedByUid: actor.uid, receivedByName: actor.displayName,
      memberUids, createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(orderRef, { lines: updatedOrderLines, status: nextStatus, updatedAt: FieldValue.serverTimestamp() });
    for (const write of stockWrites) {
      tx.set(write.balanceRef, write.balanceData, { merge: true });
      tx.create(write.movementRef, write.movementData);
    }
    const log = auditPayload(orgId, actor, 'GOODS_RECEIPT_VALIDATED', 'goods_receipt', receiptId,
      `Réception ${receiptRef} sur commande ${order.reference}`, memberUids);
    tx.create(log.ref, log.data);
  });
  res.json({ ok: true, reference: receiptRef });
}));

router.post('/demo-seed', wrap(async (req, res) => {
  const actor = actorFrom(req);
  const orgId = documentId(req.body?.orgId, 'Organisation');
  const { org } = await authorizeOrg(orgId, actor);
  const memberRole = await adminDb.doc(`organizations/${orgId}/members/${actor.uid}`).get();
  if (!['owner', 'admin'].includes(String(memberRole.data()?.role))) throw new Error('Seul un propriétaire ou administrateur peut initialiser les stocks de démonstration.');
  if (org.isDemoSeeded !== true) throw new Error('Cette organisation ne dispose pas du catalogue de démonstration.');
  const seed = [
    { productId: 'prod_cap_01', warehouseId: 'wh_paris', locationId: 'loc_par_a1', quantity: 94 },
    { productId: 'prod_plc_02', warehouseId: 'wh_paris', locationId: 'loc_par_a2', quantity: 6 },
    { productId: 'prod_roul_03', warehouseId: 'wh_lyon', locationId: 'loc_lyo_a1', quantity: 165 },
    { productId: 'prod_ver_04', warehouseId: 'wh_paris', locationId: 'loc_par_a1', quantity: 0 },
    { productId: 'prod_cart_05', warehouseId: 'wh_paris', locationId: 'loc_par_pick', quantity: 112 },
    { productId: 'prod_film_06', warehouseId: 'wh_lyon', locationId: 'loc_lyo_a1', quantity: 22 },
  ];
  const orgRef = adminDb.doc(`organizations/${orgId}`);
  await adminDb.runTransaction(async (tx) => {
    await assertMemberInTransaction(tx, orgId, actor, true);
    const orgSnap = await tx.get(orgRef);
    if (!orgSnap.exists || orgSnap.data()!.isDemoSeeded !== true) throw new Error('Organisation de démonstration introuvable.');
    if (orgSnap.data()!.demoStockSeededAt) return;
    const refs = seed.map((item) => ({
      ...item,
      productRef: adminDb.doc(`organizations/${orgId}/products/${item.productId}`),
      warehouseRef: adminDb.doc(`organizations/${orgId}/warehouses/${item.warehouseId}`),
      locationRef: adminDb.doc(`organizations/${orgId}/locations/${item.locationId}`),
      balanceRef: adminDb.doc(`organizations/${orgId}/stockBalances/${item.productId}_${item.warehouseId}_${item.locationId}`),
    }));
    const allRefs = refs.flatMap((item) => [item.productRef, item.warehouseRef, item.locationRef, item.balanceRef]);
    const snapshots = await Promise.all(allRefs.map((ref) => tx.get(ref)));
    const snapMap = new Map(allRefs.map((ref, index) => [ref.path, snapshots[index]]));
    for (const item of refs) {
      if (!snapMap.get(item.productRef.path)!.exists || !snapMap.get(item.warehouseRef.path)!.exists || !snapMap.get(item.locationRef.path)!.exists) {
        throw new Error('Le catalogue de démonstration est incomplet; initialisation des stocks annulée.');
      }
      if (snapMap.get(item.balanceRef.path)!.exists) throw new Error('Un solde de démonstration existe déjà; aucune initialisation partielle ne sera écrasée.');
    }
    const memberUids = Array.isArray(orgSnap.data()!.memberUids) ? orgSnap.data()!.memberUids.slice(0, 50) : [actor.uid];
    for (const item of refs) {
      const product = snapMap.get(item.productRef.path)!.data()!;
      const warehouse = snapMap.get(item.warehouseRef.path)!.data()!;
      const location = snapMap.get(item.locationRef.path)!.data()!;
      if (location.warehouseId !== item.warehouseId) throw new Error('Emplacement de démonstration rattaché au mauvais entrepôt.');
      const movementId = item.quantity > 0 ? id('mvt') : undefined;
      tx.create(item.balanceRef, {
        id: item.balanceRef.id, orgId, productId: product.id, productSku: product.sku, productName: product.name,
        warehouseId: warehouse.id, warehouseName: warehouse.name,
        locationId: location.id, locationCode: location.code,
        physicalQty: item.quantity, reservedQty: 0, onOrderQty: 0, inTransitQty: 0,
        availableQty: item.quantity, unitCost: Number(product.purchasePrice ?? 0),
        ...(movementId ? { lastMovementId: movementId } : {}),
        memberUids, updatedAt: FieldValue.serverTimestamp(),
      });
      if (movementId) {
        tx.create(adminDb.doc(`organizations/${orgId}/stockMovements/${movementId}`), {
          id: movementId, orgId,
          reference: `MVT-DEMO-${String(product.sku).slice(0, 48)}`,
          movementType: 'IN', productId: product.id, productSku: product.sku, productName: product.name,
          warehouseId: warehouse.id, warehouseName: warehouse.name, locationId: location.id, locationCode: location.code,
          quantity: item.quantity, unitCost: Number(product.purchasePrice ?? 0),
          reason: 'Stock initial de démonstration (moteur Stock Engine v2)',
          sourceDocumentType: 'Initialisation Démo', sourceDocumentRef: 'INIT-DEMO-02',
          performedByUid: actor.uid, performedByName: actor.displayName,
          isDemo: true, memberUids, createdAt: FieldValue.serverTimestamp(),
        });
      }
    }
    tx.update(orgRef, { demoStockSeededAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    const log = auditPayload(orgId, actor, 'DEMO_STOCK_INITIALIZED', 'stock_initialization', orgId,
      'Initialisation des stocks de démonstration sans réservations artificielles', memberUids);
    tx.create(log.ref, log.data);
  });
  res.json({ ok: true });
}));

router.post('/movement', wrap(async (req, res) => {
  const actor = actorFrom(req);
  const orgId = documentId(req.body?.orgId, 'Organisation');
  const productId = documentId(req.body?.productId, 'Produit');
  const warehouseId = documentId(req.body?.warehouseId, 'Entrepôt');
  const locationId = documentId(req.body?.locationId, 'Emplacement');
  const movementType = String(req.body?.movementType);
  if (!['IN', 'OUT', 'TRANSFER', 'ADJUSTMENT'].includes(movementType)) throw new Error('Type de mouvement invalide.');
  const rawQuantity = quantity(req.body?.quantity, 'Quantité');
  if (rawQuantity === 0) throw new Error('La quantité ne peut pas être nulle.');
  const qty = Math.abs(rawQuantity);
  if (movementType !== 'ADJUSTMENT' && rawQuantity < 0) throw new Error('Pour IN, OUT et TRANSFER, saisir une quantité positive.');
  const reason = text(req.body?.reason, 'Motif', 300);
  const unitCostInput = req.body?.unitCost === undefined ? 0 : quantity(req.body.unitCost, 'Coût unitaire');
  if (unitCostInput < 0) throw new Error('Le coût unitaire ne peut pas être négatif.');
  const targetWarehouseId = movementType === 'TRANSFER' ? documentId(req.body?.targetWarehouseId, 'Entrepôt destinataire') : '';
  const targetLocationId = movementType === 'TRANSFER' ? documentId(req.body?.targetLocationId, 'Emplacement destinataire') : '';
  if (movementType === 'TRANSFER' && targetWarehouseId === warehouseId && targetLocationId === locationId) throw new Error('La destination du transfert doit être différente de la source.');
  const { org } = await authorizeOrg(orgId, actor);
  const memberUids = Array.isArray(org.memberUids) ? org.memberUids.slice(0, 50) : [actor.uid];
  const movementId = id('mvt');
  const movementRef = adminDb.doc(`organizations/${orgId}/stockMovements/${movementId}`);
  const movementReference = `MVT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${movementId.slice(-5).toUpperCase()}`;

  await adminDb.runTransaction(async (tx) => {
    const productRef = adminDb.doc(`organizations/${orgId}/products/${productId}`);
    const warehouseRef = adminDb.doc(`organizations/${orgId}/warehouses/${warehouseId}`);
    const locationRef = adminDb.doc(`organizations/${orgId}/locations/${locationId}`);
    const sourceRef = adminDb.doc(`organizations/${orgId}/stockBalances/${productId}_${warehouseId}_${locationId}`);
    await assertMemberInTransaction(tx, orgId, actor);
    const [productSnap, warehouseSnap, locationSnap, sourceSnap] = await Promise.all([
      tx.get(productRef), tx.get(warehouseRef), tx.get(locationRef), tx.get(sourceRef),
    ]);
    if (!productSnap.exists || !warehouseSnap.exists || !locationSnap.exists) throw new Error('Produit, entrepôt ou emplacement introuvable.');
    const product = productSnap.data()!;
    const warehouse = warehouseSnap.data()!;
    const location = locationSnap.data()!;
    if (warehouse.status !== 'active' || location.status !== 'active' || location.warehouseId !== warehouseId) throw new Error('Entrepôt ou emplacement inactif ou incohérent.');
    const source = sourceSnap.data() ?? {
      physicalQty: 0, reservedQty: 0, onOrderQty: 0, inTransitQty: 0, availableQty: 0, unitCost: product.purchasePrice,
    };
    assertBalanceCoherent(source);
    const currentPhysical = Number(source.physicalQty);
    const currentReserved = Number(source.reservedQty);
    const available = Number(source.availableQty);
    let nextPhysical = currentPhysical;
    let signedQty = qty;
    if (movementType === 'IN') nextPhysical = currentPhysical + qty;
    else if (movementType === 'OUT') {
      if (qty > available + 0.0001) throw new Error(`Stock insuffisant : ${available} disponible, ${qty} demandé.`);
      nextPhysical = currentPhysical - qty;
      signedQty = -qty;
    } else if (movementType === 'ADJUSTMENT') {
      signedQty = rawQuantity;
      nextPhysical = currentPhysical + signedQty;
      if (nextPhysical < currentReserved - 0.0001 || nextPhysical < -0.0001) throw new Error('Ajustement impossible : le stock physique passerait sous les réservations.');
    } else {
      if (qty > available + 0.0001) throw new Error(`Stock insuffisant pour transfert : ${available} disponible.`);
      nextPhysical = currentPhysical - qty;
    }
    const unitCost = unitCostInput > 0 ? unitCostInput : Number(source.unitCost ?? product.purchasePrice ?? 0);
    const nextAvailable = computeAvailableQuantity(nextPhysical, currentReserved);
    let target: any = null;
    let targetRef: DocumentReference | null = null;
    if (movementType === 'TRANSFER') {
      targetRef = adminDb.doc(`organizations/${orgId}/stockBalances/${productId}_${targetWarehouseId}_${targetLocationId}`);
      const targetWarehouseRef = adminDb.doc(`organizations/${orgId}/warehouses/${targetWarehouseId}`);
      const targetLocationRef = adminDb.doc(`organizations/${orgId}/locations/${targetLocationId}`);
      const [targetSnap, targetWarehouseSnap, targetLocationSnap] = await Promise.all([tx.get(targetRef), tx.get(targetWarehouseRef), tx.get(targetLocationRef)]);
      if (!targetWarehouseSnap.exists || !targetLocationSnap.exists || targetWarehouseSnap.data()!.status !== 'active' || targetLocationSnap.data()!.status !== 'active' || targetLocationSnap.data()!.warehouseId !== targetWarehouseId) {
        throw new Error('Entrepôt ou emplacement destinataire invalide.');
      }
      const targetData = targetSnap.data() ?? { physicalQty: 0, reservedQty: 0, onOrderQty: 0, inTransitQty: 0, availableQty: 0, unitCost };
      assertBalanceCoherent(targetData);
      const targetPhysical = Number(targetData.physicalQty) + qty;
      const targetReserved = Number(targetData.reservedQty);
      target = {
        id: `${productId}_${targetWarehouseId}_${targetLocationId}`, orgId,
        productId, productSku: product.sku, productName: product.name,
        warehouseId: targetWarehouseId, warehouseName: targetWarehouseSnap.data()!.name,
        locationId: targetLocationId, locationCode: targetLocationSnap.data()!.code,
        physicalQty: targetPhysical, reservedQty: targetReserved,
        onOrderQty: Number(targetData.onOrderQty ?? 0), inTransitQty: Number(targetData.inTransitQty ?? 0),
        availableQty: computeAvailableQuantity(targetPhysical, targetReserved), unitCost,
        lastMovementId: movementId, memberUids, updatedAt: FieldValue.serverTimestamp(),
      };
      tx.set(targetRef, target, { merge: true });
    }
    const sourceData = {
      id: `${productId}_${warehouseId}_${locationId}`, orgId,
      productId, productSku: product.sku, productName: product.name,
      warehouseId, warehouseName: warehouse.name,
      locationId, locationCode: location.code,
      physicalQty: nextPhysical, reservedQty: currentReserved,
      onOrderQty: Number(source.onOrderQty ?? 0), inTransitQty: Number(source.inTransitQty ?? 0),
      availableQty: nextAvailable, unitCost, lastMovementId: movementId,
      memberUids, updatedAt: FieldValue.serverTimestamp(),
    };
    tx.set(sourceRef, sourceData, { merge: true });
    tx.create(movementRef, {
      id: movementId,
      orgId, reference: movementReference,
      movementType, productId, productSku: product.sku, productName: product.name,
      warehouseId, warehouseName: warehouse.name, locationId, locationCode: location.code,
      ...(target ? { targetWarehouseId, targetWarehouseName: target.warehouseName, targetLocationId, targetLocationCode: target.locationCode } : {}),
      quantity: movementType === 'TRANSFER' ? qty : signedQty,
      unitCost, reason,
      sourceDocumentType: String(req.body?.sourceDocumentType ?? 'Opération manuelle').slice(0, 48),
      sourceDocumentRef: String(req.body?.sourceDocumentRef ?? '').slice(0, 64),
      performedByUid: actor.uid, performedByName: actor.displayName,
      isDemo: false, memberUids, createdAt: FieldValue.serverTimestamp(),
    });
    const log = auditPayload(orgId, actor, `STOCK_${movementType}`, 'stock_movement', movementId,
      `Mouvement ${movementType} ${signedQty} × ${product.sku} (${warehouse.code}/${location.code})`, memberUids);
    tx.create(log.ref, log.data);
    if (movementType !== 'IN' && nextAvailable <= Number(product.minStock ?? 0)) {
      const notificationId = id('notif');
      tx.create(adminDb.doc(`organizations/${orgId}/notifications/${notificationId}`), {
        id: notificationId, orgId, title: nextAvailable <= 0 ? 'Rupture de stock' : 'Seuil minimum atteint',
        message: `${product.name} (${product.sku}) : ${nextAvailable} ${product.unit} disponible sur ${warehouse.name}.`,
        severity: nextAvailable <= 0 ? 'error' : 'warning', isRead: false, link: '/stocks',
        memberUids, createdAt: FieldValue.serverTimestamp(),
      });
    }
  });
  res.json({ ok: true, reference: movementReference });
}));

export const stockOperationsRouter = router;
