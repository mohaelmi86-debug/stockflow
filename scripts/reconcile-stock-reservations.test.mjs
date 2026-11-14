import assert from 'node:assert/strict';
import { buildOrgPlan } from './reconcile-stock-reservations.mjs';

const orgData = { ownerId: 'owner_1', memberUids: ['owner_1'] };
const balance = (overrides = {}) => ({
  id: 'prod_1_wh_1_loc_1', productId: 'prod_1', warehouseId: 'wh_1', locationId: 'loc_1',
  physicalQty: 12, reservedQty: 5, availableQty: 7, lastMovementId: 'mvt_1', ...overrides,
});
const order = (id, reservedQty = 3, overrides = {}) => ({
  id, warehouseId: 'wh_1', status: 'preparing',
  lines: [{ productId: 'prod_1', productSku: 'SKU-1', reservedQty, deliveredQty: 0 }],
  ...overrides,
});

const safe = buildOrgPlan({ orgId: 'org_1', orgData, orders: [order('so_1')], balances: [balance()], movements: [{ id:'mvt_1', productId:'prod_1', warehouseId:'wh_1', locationId:'loc_1' }] });
assert.equal(safe.safeAssignments.length, 1);
assert.equal(safe.safeAssignments[0].locationId, 'loc_1');
assert.equal(safe.findings.length, 0);

const ambiguous = buildOrgPlan({ orgId:'org_1', orgData, orders:[order('so_1')], balances:[balance(), balance({id:'prod_1_wh_1_loc_2',locationId:'loc_2',reservedQty:2,availableQty:10})], movements:[] });
assert.equal(ambiguous.safeAssignments.length, 0);
assert.ok(ambiguous.findings.some((item) => item.code === 'ambiguous_multiple_locations'));

const insufficient = buildOrgPlan({ orgId:'org_1', orgData, orders:[order('so_1',8)], balances:[balance()], movements:[] });
assert.equal(insufficient.safeAssignments.length, 0);
assert.ok(insufficient.findings.some((item) => item.code === 'reserved_balance_below_declared_order_qty'));

const terminal = buildOrgPlan({ orgId:'org_1', orgData, orders:[order('so_1',3,{status:'canceled'})], balances:[balance()], movements:[] });
assert.equal(terminal.safeAssignments.length, 0);
assert.ok(terminal.findings.some((item) => item.code === 'terminal_order_still_reserved'));

const broken = buildOrgPlan({ orgId:'org_1', orgData, orders:[], balances:[balance({lastMovementId:'missing',availableQty:0})], movements:[] });
assert.ok(broken.balanceFindings.some((item) => item.code === 'last_movement_reference_missing'));
assert.ok(broken.balanceFindings.some((item) => item.code === 'available_quantity_mismatch'));

const allocated = buildOrgPlan({
  orgId:'org_1', orgData,
  orders:[{...order('so_1'),lines:[{productId:'prod_1',productSku:'SKU-1',reservedQty:3,reservationAllocations:[{warehouseId:'wh_1',locationId:'loc_1',quantity:3}]}]}],
  balances:[balance({reservedQty:3,availableQty:9})], movements:[{id:'mvt_1',productId:'prod_1',warehouseId:'wh_1',locationId:'loc_1'}]
});
assert.equal(allocated.safeAssignments.length, 0);
assert.equal(allocated.findings.length, 0);
assert.equal(allocated.balanceFindings.length, 0);

console.log('Stock reservation reconciliation planner: 6 checks passed.');
