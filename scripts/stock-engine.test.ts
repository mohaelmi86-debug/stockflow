import assert from 'node:assert/strict';
import {
  assertReservationConsistency,
  assertUniqueProductLines,
  computeAvailableQuantity,
  validateReceiptQuantities,
} from '../src/server/stockEngineCore.ts';

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  process.stdout.write(`✓ ${name}\n`);
}

check('available quantity is physical minus reserved', () => {
  assert.equal(computeAvailableQuantity(20, 5), 15);
});

check('reserved quantity cannot exceed physical stock', () => {
  assert.throws(() => computeAvailableQuantity(5, 6), /incohérent/);
});

check('negative stock quantities are rejected', () => {
  assert.throws(() => computeAvailableQuantity(-1, 0), /incohérent/);
});

check('reservation allocations must total the reserved quantity', () => {
  const allocations = assertReservationConsistency({
    productId: 'p1',
    reservedQty: 5,
    reservationAllocations: [
      { warehouseId: 'w1', locationId: 'l1', quantity: 2 },
      { warehouseId: 'w1', locationId: 'l2', quantity: 3 },
    ],
  });
  assert.equal(allocations.length, 2);
});

check('mismatched reservation allocations are rejected', () => {
  assert.throws(() => assertReservationConsistency({
    productId: 'p1',
    reservedQty: 5,
    reservationAllocations: [{ warehouseId: 'w1', locationId: 'l1', quantity: 4 }],
  }), /Réservation incohérente/);
});

check('duplicate allocations to the same location are rejected', () => {
  assert.throws(() => assertReservationConsistency({
    productId: 'p1',
    reservedQty: 3,
    reservationAllocations: [
      { warehouseId: 'w1', locationId: 'l1', quantity: 1 },
      { warehouseId: 'w1', locationId: 'l1', quantity: 2 },
    ],
  }), /plusieurs fois/);
});

check('zero or negative allocation quantities are rejected', () => {
  assert.throws(() => assertReservationConsistency({
    productId: 'p1',
    reservedQty: 0,
    reservationAllocations: [{ warehouseId: 'w1', locationId: 'l1', quantity: 0 }],
  }), /quantité positive/);
});

check('duplicate product lines are rejected', () => {
  assert.throws(() => assertUniqueProductLines([{ productId: 'p1' }, { productId: 'p1' }], 'Commande'), /qu'une seule fois/);
});

check('accepted and rejected receipt quantities reconcile exactly', () => {
  assert.deepEqual(validateReceiptQuantities(
    { receivedQty: 10, acceptedQty: 8, rejectedQty: 2 },
    'partial_issue',
  ), { receivedQty: 10, acceptedQty: 8, rejectedQty: 2 });
});

check('negative accepted quantities are rejected', () => {
  assert.throws(() => validateReceiptQuantities(
    { receivedQty: 10, acceptedQty: -1, rejectedQty: 11 },
    'partial_issue',
  ), /ne peuvent pas être négatives/);
});

check('a passed inspection cannot contain rejected units', () => {
  assert.throws(() => validateReceiptQuantities(
    { receivedQty: 10, acceptedQty: 8, rejectedQty: 2 },
    'passed',
  ), /conforme/);
});

check('a rejected receipt cannot add accepted stock', () => {
  assert.throws(() => validateReceiptQuantities(
    { receivedQty: 10, acceptedQty: 1, rejectedQty: 9 },
    'rejected',
  ), /refusé/);
});

check('receipt quantities must reconcile to the received quantity', () => {
  assert.throws(() => validateReceiptQuantities(
    { receivedQty: 10, acceptedQty: 8, rejectedQty: 1 },
    'partial_issue',
  ), /doit être égale/);
});

process.stdout.write(`\nStock engine core: ${passed} checks passed.\n`);
