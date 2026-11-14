export const STOCK_EPSILON = 0.0001;

export function asFiniteQuantity(value: unknown, label: string): number {
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) throw new Error(`${label} doit être un nombre fini.`);
  return quantity;
}

export function roundStock(value: number): number {
  return Number(value.toFixed(3));
}

export function assertUniqueProductLines<T extends { productId: string }>(
  lines: T[],
  label: string,
): void {
  const seen = new Set<string>();
  for (const line of lines) {
    if (!line.productId || seen.has(line.productId)) {
      throw new Error(`${label} : un produit ne peut apparaître qu'une seule fois. Regroupez les quantités sur une seule ligne.`);
    }
    seen.add(line.productId);
  }
}

export function assertReservationConsistency(line: {
  productId: string;
  reservedQty: number;
  reservationAllocations?: Array<{ warehouseId: string; locationId: string; quantity: number }>;
}): Array<{ warehouseId: string; locationId: string; quantity: number }> {
  const reservedQty = asFiniteQuantity(line.reservedQty ?? 0, 'Quantité réservée');
  if (reservedQty < -STOCK_EPSILON) throw new Error('La quantité réservée ne peut pas être négative.');
  const allocations = line.reservationAllocations ?? [];
  if (!Array.isArray(allocations)) throw new Error('Format des allocations de réservation invalide.');
  const seen = new Set<string>();
  let total = 0;
  for (const allocation of allocations) {
    const quantity = asFiniteQuantity(allocation.quantity, 'Allocation');
    if (!allocation.warehouseId || !allocation.locationId || quantity <= STOCK_EPSILON) {
      throw new Error('Chaque allocation doit avoir un entrepôt, un emplacement et une quantité positive.');
    }
    const key = `${allocation.warehouseId}::${allocation.locationId}`;
    if (seen.has(key)) throw new Error('Une même allocation entrepôt/emplacement est présente plusieurs fois.');
    seen.add(key);
    total += quantity;
  }
  if (Math.abs(total - reservedQty) > STOCK_EPSILON) {
    throw new Error(`Réservation incohérente : ${roundStock(reservedQty)} réservée(s), ${roundStock(total)} allouée(s).`);
  }
  return allocations;
}

export function validateReceiptQuantities(
  line: { receivedQty: unknown; acceptedQty: unknown; rejectedQty: unknown },
  inspectionStatus: 'passed' | 'partial_issue' | 'rejected',
): { receivedQty: number; acceptedQty: number; rejectedQty: number } {
  const receivedQty = asFiniteQuantity(line.receivedQty, 'Quantité reçue');
  const acceptedQty = asFiniteQuantity(line.acceptedQty, 'Quantité acceptée');
  const rejectedQty = asFiniteQuantity(line.rejectedQty, 'Quantité rejetée');
  if (receivedQty <= STOCK_EPSILON || acceptedQty < 0 || rejectedQty < 0) {
    throw new Error('Les quantités reçues doivent être positives et les quantités acceptées/rejetées ne peuvent pas être négatives.');
  }
  if (Math.abs(acceptedQty + rejectedQty - receivedQty) > STOCK_EPSILON) {
    throw new Error('La quantité acceptée plus la quantité rejetée doit être égale à la quantité reçue.');
  }
  if (inspectionStatus === 'passed' && rejectedQty > STOCK_EPSILON) {
    throw new Error('Un contrôle « conforme » ne peut pas contenir de quantité rejetée.');
  }
  if (inspectionStatus === 'rejected' && (acceptedQty > STOCK_EPSILON || Math.abs(rejectedQty - receivedQty) > STOCK_EPSILON)) {
    throw new Error('Un contrôle « refusé » doit rejeter la totalité de la quantité reçue.');
  }
  return { receivedQty: roundStock(receivedQty), acceptedQty: roundStock(acceptedQty), rejectedQty: roundStock(rejectedQty) };
}

export function computeAvailableQuantity(physicalQty: unknown, reservedQty: unknown): number {
  const physical = asFiniteQuantity(physicalQty, 'Stock physique');
  const reserved = asFiniteQuantity(reservedQty, 'Stock réservé');
  if (physical < -STOCK_EPSILON || reserved < -STOCK_EPSILON || reserved > physical + STOCK_EPSILON) {
    throw new Error('Solde de stock incohérent : les réservations doivent être comprises entre zéro et le stock physique.');
  }
  return roundStock(Math.max(0, physical - reserved));
}

export function computeSalesTotals(lines: Array<{
  quantity: number; unitPrice: number; discountPct: number; vatRate: number;
}>, shippingCost: number) {
  let subtotalHt = 0;
  let vatTotal = 0;
  for (const line of lines) {
    const netLine = line.quantity * line.unitPrice * (1 - line.discountPct / 100);
    subtotalHt += netLine;
    vatTotal += netLine * (line.vatRate / 100);
  }
  const shipping = Number(shippingCost || 0);
  const shippingVat = shipping * 0.2;
  const finalHt = Number((subtotalHt + shipping).toFixed(2));
  const finalVat = Number((vatTotal + shippingVat).toFixed(2));
  return { subtotalHt: finalHt, vatTotal: finalVat, totalTtc: Number((finalHt + finalVat).toFixed(2)) };
}
