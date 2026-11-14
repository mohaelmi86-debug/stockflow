import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

const projectId = 'demo-stockflow';
const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
const environment = await initializeTestEnvironment({
  projectId,
  firestore: {
    host: process.env.FIRESTORE_EMULATOR_HOST?.split(':')[0] || '127.0.0.1',
    port: Number(process.env.FIRESTORE_EMULATOR_HOST?.split(':')[1] || 8080),
    rules,
  },
});

const now = Timestamp.now();
const org = (id, ownerId, memberUids) => ({
  id,
  name: id === 'org_alpha' ? 'Alpha Org' : 'Beta Org',
  slug: id === 'org_alpha' ? 'alpha-org' : 'beta-org',
  currency: 'EUR',
  plan: 'starter',
  ownerId,
  memberUids,
  createdAt: now,
  updatedAt: now,
});
const member = (uid, orgId, ownerId, role, status = 'active') => ({
  uid,
  orgId,
  orgOwnerId: ownerId,
  email: `${uid}@example.test`,
  displayName: uid,
  role,
  status,
  memberUids: [ownerId, uid],
  joinedAt: now,
});
const balance = () => ({
  id: 'product_1_warehouse_1_location_1',
  orgId: 'org_alpha',
  productId: 'product_1',
  productSku: 'SKU-1',
  productName: 'Produit test',
  warehouseId: 'warehouse_1',
  warehouseName: 'Entrepôt principal',
  locationId: 'location_1',
  locationCode: 'A1',
  physicalQty: 10,
  reservedQty: 0,
  onOrderQty: 0,
  inTransitQty: 0,
  availableQty: 10,
  unitCost: 5,
  memberUids: ['owner_alpha', 'operator_alpha'],
  updatedAt: now,
});
const movement = (uid, id = 'movement_orphan_1') => ({
  id,
  orgId: 'org_alpha',
  reference: 'MVT-20261114-0001',
  movementType: 'IN',
  productId: 'product_1',
  productSku: 'SKU-1',
  productName: 'Produit test',
  warehouseId: 'warehouse_1',
  warehouseName: 'Entrepôt principal',
  locationId: 'location_1',
  locationCode: 'A1',
  quantity: 2,
  unitCost: 5,
  reason: 'Réception de test',
  performedByUid: uid,
  performedByName: uid,
  isDemo: false,
  memberUids: ['owner_alpha', uid],
  createdAt: serverTimestamp(),
});

async function seed() {
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'organizations', 'org_alpha'), org('org_alpha', 'owner_alpha', [
      'owner_alpha', 'operator_alpha', 'viewer_alpha', 'suspended_alpha',
    ]));
    await setDoc(doc(db, 'organizations', 'org_beta'), org('org_beta', 'owner_beta', ['owner_beta']));
    for (const data of [
      member('owner_alpha', 'org_alpha', 'owner_alpha', 'owner'),
      member('operator_alpha', 'org_alpha', 'owner_alpha', 'operator'),
      member('viewer_alpha', 'org_alpha', 'owner_alpha', 'viewer'),
      member('suspended_alpha', 'org_alpha', 'owner_alpha', 'admin', 'suspended'),
      member('owner_beta', 'org_beta', 'owner_beta', 'owner'),
    ]) {
      await setDoc(doc(db, 'organizations', data.orgId, 'members', data.uid), data);
    }
    await setDoc(doc(db, 'organizations', 'org_alpha', 'stockBalances', 'product_1_warehouse_1_location_1'), balance());
    await setDoc(doc(db, 'organizations', 'org_alpha', 'stockMovements', 'movement_in_001'), movement('operator_alpha', 'movement_in_001'));
    await setDoc(doc(db, 'users', 'viewer_alpha'), {
      uid: 'viewer_alpha',
      email: 'viewer_alpha@example.test',
      displayName: 'viewer_alpha',
      createdAt: now,
      updatedAt: now,
    });
    await setDoc(doc(db, 'users', 'operator_alpha', 'memberships', 'org_alpha'), {
      orgId: 'org_alpha',
      orgName: 'Alpha Org',
      orgSlug: 'alpha-org',
      role: 'operator',
      plan: 'starter',
      currency: 'EUR',
      joinedAt: now,
    });
    await setDoc(doc(db, 'users', 'viewer_alpha', 'memberships', 'org_alpha'), {
      orgId: 'org_alpha',
      orgName: 'Alpha Org',
      orgSlug: 'alpha-org',
      role: 'viewer',
      plan: 'starter',
      currency: 'EUR',
      joinedAt: now,
    });
  });
}

const dbFor = (uid, verified = true) => environment.authenticatedContext(uid, {
  email: `${uid}@example.test`,
  email_verified: verified,
}).firestore();
const unauthDb = environment.unauthenticatedContext().firestore();

let passed = 0;
async function check(name, run) {
  await run();
  passed += 1;
  process.stdout.write(`✓ ${name}\n`);
}

try {
  await seed();

  await check('unauthenticated reads are denied', async () => {
    await assertFails(getDoc(doc(unauthDb, 'organizations', 'org_alpha')));
  });

  await check('active tenant members can read their organization', async () => {
    await assertSucceeds(getDoc(doc(dbFor('owner_alpha'), 'organizations', 'org_alpha')));
  });

  await check('cross-tenant organization reads are denied', async () => {
    await assertFails(getDoc(doc(dbFor('owner_alpha'), 'organizations', 'org_beta')));
  });

  await check('suspended memberships cannot read tenant data', async () => {
    await assertFails(getDoc(doc(dbFor('suspended_alpha'), 'organizations', 'org_alpha')));
  });

  await check('active members can list stock balances inside their tenant', async () => {
    const docs = await assertSucceeds(getDocs(collection(dbFor('operator_alpha'), 'organizations', 'org_alpha', 'stockBalances')));
    assert.equal(docs.size, 1);
  });

  await check('tenant members cannot list another tenant stock balances', async () => {
    await assertFails(getDocs(collection(dbFor('owner_alpha'), 'organizations', 'org_beta', 'stockBalances')));
  });

  await check('owners can update organization profile fields', async () => {
    await assertSucceeds(updateDoc(doc(dbFor('owner_alpha'), 'organizations', 'org_alpha'), {
      name: 'Alpha Org mise à jour',
      updatedAt: serverTimestamp(),
    }));
  });

  await check('clients cannot change the organization subscription plan', async () => {
    await assertFails(updateDoc(doc(dbFor('owner_alpha'), 'organizations', 'org_alpha'), {
      plan: 'enterprise',
      updatedAt: serverTimestamp(),
    }));
  });

  await check('clients cannot write Stripe subscription identifiers', async () => {
    await assertFails(updateDoc(doc(dbFor('owner_alpha'), 'organizations', 'org_alpha'), {
      stripeCustomerId: 'cus_forged',
      updatedAt: serverTimestamp(),
    }));
  });

  await check('users cannot forge their role in their membership mirror', async () => {
    await assertFails(updateDoc(doc(dbFor('viewer_alpha'), 'users', 'viewer_alpha', 'memberships', 'org_alpha'), {
      role: 'owner',
    }));
  });

  await check('membership mirrors can only be created with the authoritative role and plan', async () => {
    await assertFails(setDoc(doc(dbFor('operator_alpha'), 'users', 'operator_alpha', 'memberships', 'org_beta'), {
      orgId: 'org_beta',
      orgName: 'Beta Org',
      orgSlug: 'beta-org',
      role: 'owner',
      plan: 'enterprise',
      currency: 'EUR',
      joinedAt: serverTimestamp(),
    }));
  });

  await check('viewers cannot create stock balances', async () => {
    await assertFails(setDoc(doc(dbFor('viewer_alpha'), 'organizations', 'org_alpha', 'stockBalances', 'product_2_warehouse_1_location_1'), {
      ...balance(),
      id: 'product_2_warehouse_1_location_1',
      productId: 'product_2',
      physicalQty: 0,
      availableQty: 0,
      updatedAt: serverTimestamp(),
    }));
  });

  await check('clients cannot modify physical or reserved stock directly', async () => {
    await assertFails(updateDoc(doc(dbFor('operator_alpha'), 'organizations', 'org_alpha', 'stockBalances', 'product_1_warehouse_1_location_1'), {
      reservedQty: 2,
      availableQty: 8,
      updatedAt: serverTimestamp(),
    }));
  });

  await check('clients cannot create stock movements directly', async () => {
    await assertFails(setDoc(doc(dbFor('operator_alpha'), 'organizations', 'org_alpha', 'stockMovements', 'movement_orphan_1'), movement('operator_alpha')));
  });

  await check('clients cannot mutate stock even with a paired movement', async () => {
    const db = dbFor('operator_alpha');
    const batch = writeBatch(db);
    batch.set(doc(db, 'organizations', 'org_alpha', 'stockMovements', 'movement_in_002'), movement('operator_alpha', 'movement_in_002'));
    batch.update(doc(db, 'organizations', 'org_alpha', 'stockBalances', 'product_1_warehouse_1_location_1'), {
      physicalQty: 12,
      availableQty: 12,
      lastMovementId: 'movement_in_002',
      updatedAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
  });

  await check('stock movement ledger entries are immutable', async () => {
    await assertFails(updateDoc(doc(dbFor('operator_alpha'), 'organizations', 'org_alpha', 'stockMovements', 'movement_in_001'), {
      reason: 'entrée falsifiée',
    }));
  });

  await check('new organizations cannot be created on paid plans from the client', async () => {
    const db = dbFor('owner_alpha');
    const batch = writeBatch(db);
    batch.set(doc(db, 'organizations', 'org_paid_forged'), {
      ...org('org_paid_forged', 'owner_alpha', ['owner_alpha']),
      plan: 'pro',
    });
    batch.set(doc(db, 'organizations', 'org_paid_forged', 'members', 'owner_alpha'), {
      ...member('owner_alpha', 'org_paid_forged', 'owner_alpha', 'owner'),
    });
    await assertFails(batch.commit());
  });

  await check('new organizations can be created on Starter with an owner in one batch', async () => {
    const db = dbFor('owner_alpha');
    const batch = writeBatch(db);
    batch.set(doc(db, 'organizations', 'org_starter_created'), {
      ...org('org_starter_created', 'owner_alpha', ['owner_alpha']),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'organizations', 'org_starter_created', 'members', 'owner_alpha'), {
      ...member('owner_alpha', 'org_starter_created', 'owner_alpha', 'owner'),
      joinedAt: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
  });

  process.stdout.write(`\nFirestore emulator rules: ${passed} checks passed.\n`);
} finally {
  await environment.cleanup();
}
