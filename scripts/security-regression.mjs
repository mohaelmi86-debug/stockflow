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
const stockEngine = read('src/server/stockOperationsRouter.ts');
const stockCore = read('src/server/stockEngineCore.ts');

assert.ok(!rules.includes('request.auth.uid in resource.data.memberUids'),
  'Firestore list rules must not rely on stale memberUids arrays.');
assert.ok(rules.includes('function isOrgMember(orgId)') && rules.includes("data.status == 'active'"),
  'Firestore tenant checks must require an active membership.');
assert.ok(rules.includes("getAfter(/databases/$(database)/documents/organizations/$(orgId)/members/$(userId)).data.role == incoming().role"),
  'A user cannot forge the role stored in their personal organization membership mirror.');
const orgStart = rules.indexOf('match /organizations/{orgId}');
const orgEnd = rules.indexOf('match /members/{memberUid}', orgStart);
const orgRules = rules.slice(orgStart, orgEnd);
const updateRule = orgRules.slice(orgRules.indexOf('allow update:'), orgRules.indexOf('allow delete:'));
assert.ok(!updateRule.includes("'plan'") && !updateRule.includes('stripeCustomerId'),
  'Clients must not be able to update subscription or Stripe fields.');
assert.ok(orgRules.includes("incoming().plan == 'starter'"),
  'New organizations must be created on the free Starter plan.');
assert.ok((rules.match(/allow create, update, delete: if false;/g) ?? []).length >= 2,
  'Stock balances and stock movements must be immutable to browser clients; trusted server routes own mutations.');
assert.ok(rules.includes('incoming().lines == existing().lines') && rules.includes('incoming().stockReserved == existing().stockReserved'),
  'Browser clients must not mutate sales-order reservation or delivery lines.');
assert.ok(stockEngine.includes("router.use(requireAuth)") && stockEngine.includes("member.status !== 'active'") && stockEngine.includes("['owner', 'admin', 'manager', 'operator']"),
  'Stock engine endpoints must require Firebase authentication and an active operator membership.');
assert.ok(rules.includes("getAfter(/databases/$(database)/documents/organizations/$(orgId)).data.plan == incoming().plan"),
  'User membership mirrors must match the authoritative organization plan.');
assert.ok(stockEngine.includes('lastMovementId: movementId') && stockEngine.includes('movementType'),
  'Trusted stock engine writes must link updated balances to their immutable movement ledger entries.');
assert.ok(stockEngine.includes("router.post('/movement'") && stockEngine.includes("router.post('/receipt'") &&
  stockEngine.includes("router.post('/reserve'") && stockEngine.includes("router.post('/cancel'") &&
  stockEngine.includes("router.post('/ship'"),
  'The trusted stock engine must expose movement, receipt, reserve, cancel and ship operations.');
assert.ok(stockCore.includes('assertReservationConsistency') && stockCore.includes('validateReceiptQuantities') &&
  stockCore.includes('computeAvailableQuantity'),
  'The stock engine must centralize reservation, receipt and availability invariants.');
assert.ok(rules.includes('match /invoiceCounters/{counterId}') && rules.includes('existing().sequenceNumber + 1'),
  'Invoice counters must be incremented transactionally and monotonically.');

assert.ok(billing.includes('getOrgForAdmin(orgId, req.user!.uid)'),
  'Billing endpoints must verify active owner/admin membership on the server.');
assert.ok(billing.includes("users/${uid}/memberships/${params.orgId}") && billing.includes("batch.update(membershipRefs[index], { plan: params.planCode })"),
  'Server-side subscription changes must synchronize user membership plan mirrors.');
assert.ok(billing.includes('STRIPE_SECRET_KEY') && billing.includes('status(503)'),
  'Paid checkout must fail closed when Stripe is not configured.');
assert.ok(billing.includes('verifyStripeSignature') && billing.includes('stripeWebhookEvents'),
  'Stripe webhook signature validation and event idempotency storage must be present.');
assert.ok(!settings.includes('sandboxTargetPlan') && !settings.includes('updateOrganizationPlan'),
  'The UI must not activate paid plans or sandbox them from the client.');

assert.ok(types.includes('interface StockReservationAllocation'),
  'Sales order lines must support location-specific reservations.');
assert.ok(sales.includes("callStockEngine('reserve'") && sales.includes("callStockEngine('cancel'") &&
  sales.includes("callStockEngine('ship'"),
  'Sales reservation, cancellation and shipping must call the trusted stock engine.');
assert.ok(sales.includes('invoiceCounters') && sales.includes('runTransaction'),
  'Invoice sequence allocation must be transactional.');
assert.ok(sales.includes('latestInvoiceQuery') && sales.includes('orderBy(\'invoiceNumber\', \'desc\')'),
  'First invoice counter must seed itself from existing invoice history.');
assert.ok(sales.includes('linkedOrderSnap') && sales.includes('allUnitsDelivered') && sales.includes("status === 'delivered'"),
  'A sales order can only become invoiced after every unit has been delivered and all reservations are released.');
assert.ok(sales.includes('Facture cible introuvable') && sales.includes('paidAmount'),
  'Payment workflow must read and validate the current invoice in a transaction.');
assert.ok(erp.includes("callStockEngine('movement'") && purchasing.includes("callStockEngine('receipt'"),
  'Manual movements and purchase receipts must call the trusted stock engine.');

console.log('StockFlow security regression checks: PASS');

const migration = read('scripts/reconcile-stock-reservations.mjs');
const admin = read('src/server/firebaseAdmin.ts');
const firestoreConfig = JSON.parse(read('firebase.json'));
const appConfig = JSON.parse(read('firebase-applet-config.json'));
assert.ok(admin.includes('getFirestore(adminApp, firebaseConfig.firestoreDatabaseId)'),
  'Firebase Admin must use the same named Firestore database as the browser client.');
assert.ok(firestoreConfig.firestore.some((entry) => entry.database === appConfig.firestoreDatabaseId && entry.rules === 'firestore.rules'),
  'Firestore security rules must target the configured application database.');
assert.ok(migration.includes("mode: options.apply ? 'apply-safe-allocations' : 'dry-run-read-only'"),
  'The historical stock scan must be read-only by default.');
assert.ok(migration.includes('--confirm-project-id=') && migration.includes('--confirm-database-id='),
  'Applying a historical migration must require explicit project and database confirmation.');
assert.ok(migration.includes('tx.update(orderRef') && migration.includes('reservationAllocations'),
  'The migration may only attach location allocations to the matching order lines.');
assert.ok(!migration.includes('tx.update(balanceRef') && !migration.includes('tx.set(db.doc(`organizations/${plan.orgId}/stockMovements'),
  'The historical migration must not alter stock quantities or fabricate ledger movements.');

console.log('StockFlow named database and migration safety checks: PASS');
