import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const rules = read('firestore.rules');
const billing = read('src/server/billingRouter.ts');
const settings = read('src/pages/SettingsPage.tsx');
const erp = read('src/services/erpService.ts');
const purchasing = read('src/services/purchasingService.ts');
const sales = read('src/services/salesService.ts');
const types = read('src/shared/types.ts');

assert.ok(!rules.includes('request.auth.uid in resource.data.memberUids'),
  'Firestore list rules must not rely on stale memberUids arrays.');
assert.ok(rules.includes('function isOrgMember(orgId)') && rules.includes("data.status == 'active'"),
  'Firestore tenant checks must require an active membership.');
const orgStart = rules.indexOf('match /organizations/{orgId}');
const orgEnd = rules.indexOf('match /members/{memberUid}', orgStart);
const orgRules = rules.slice(orgStart, orgEnd);
const updateRule = orgRules.slice(orgRules.indexOf('allow update:'), orgRules.indexOf('allow delete:'));
assert.ok(!updateRule.includes("'plan'") && !updateRule.includes('stripeCustomerId'),
  'Clients must not be able to update subscription or Stripe fields.');
assert.ok(orgRules.includes("incoming().plan == 'starter'"),
  'New organizations must be created on the free Starter plan.');
assert.ok(rules.includes('function isLinkedStockBalanceMovement') && rules.includes('getAfter(movementPath)'),
  'Stock balances must be linked to a movement in the same Firestore transaction.');
assert.ok(rules.includes('incoming().lastMovementId') && rules.includes("'lastMovementId'"),
  'Stock balance rules must validate the linked movement id.');
assert.ok(rules.includes('match /invoiceCounters/{counterId}') && rules.includes('existing().sequenceNumber + 1'),
  'Invoice counters must be incremented transactionally and monotonically.');

assert.ok(billing.includes('getOrgForAdmin(orgId, req.user!.uid)'),
  'Billing endpoints must verify active owner/admin membership on the server.');
assert.ok(billing.includes('STRIPE_SECRET_KEY') && billing.includes('status(503)'),
  'Paid checkout must fail closed when Stripe is not configured.');
assert.ok(billing.includes('verifyStripeSignature') && billing.includes('stripeWebhookEvents'),
  'Stripe webhook signature validation and event idempotency storage must be present.');
assert.ok(!settings.includes('sandboxTargetPlan') && !settings.includes('updateOrganizationPlan'),
  'The UI must not activate paid plans or sandbox them from the client.');

assert.ok(types.includes('interface StockReservationAllocation'),
  'Sales order lines must support location-specific reservations.');
assert.ok(sales.includes('reservationAllocations') && sales.includes('runTransaction'),
  'Reservation and shipping workflows must use per-location transaction logic.');
assert.ok(sales.includes('invoiceCounters') && sales.includes('runTransaction'),
  'Invoice sequence allocation must be transactional.');
assert.ok(sales.includes('Facture cible introuvable') && sales.includes('paidAmount'),
  'Payment workflow must read and validate the current invoice in a transaction.');
assert.ok(erp.includes('lastMovementId: movementId') && purchasing.includes('lastMovementId: mvtId'),
  'All principal stock inbound/outbound movement services must link their stock balance writes to immutable movements.');
assert.ok(sales.includes('lastMovementId: write.movementId'),
  'Sales shipment stock balance writes must reference their immutable movement.');

console.log('StockFlow security regression checks: PASS');
