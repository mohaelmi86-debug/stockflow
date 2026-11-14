#!/usr/bin/env node
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };

const EPS = 0.0001;
const TERMINAL = new Set(['canceled', 'closed', 'delivered', 'invoiced']);
const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const balanceId = (productId, warehouseId, locationId) => `${productId}_${warehouseId}_${locationId}`;

function movementMatches(movement, balance) {
  return movement.productId === balance.productId &&
    ((movement.warehouseId === balance.warehouseId && movement.locationId === balance.locationId) ||
     (movement.targetWarehouseId === balance.warehouseId && movement.targetLocationId === balance.locationId));
}

/** Pure read-only planner. Only a single positive-reservation location is eligible for automatic allocation. */
export function buildOrgPlan({ orgId, orgData, orders, balances, movements }) {
  const balanceMap = new Map(balances.map((item) => [item.id, item]));
  const movementMap = new Map(movements.map((item) => [item.id, item]));
  const known = new Map();
  const legacy = new Map();
  const findings = [];
  const balanceFindings = [];
  const safeAssignments = [];

  for (const order of orders) {
    const lines = Array.isArray(order.lines) ? order.lines : [];
    lines.forEach((line, lineIndex) => {
      const reserved = num(line.reservedQty);
      const allocations = line.reservationAllocations;
      if (reserved < -EPS) {
        findings.push({ code: 'negative_reserved_quantity', orgId, orderId: order.id, lineIndex, reserved });
        return;
      }
      if (Array.isArray(allocations) && allocations.length) {
        const sum = allocations.reduce((total, item) => total + num(item.quantity), 0);
        if (Math.abs(sum - reserved) > EPS) {
          findings.push({ code: 'allocation_total_mismatch', orgId, orderId: order.id, lineIndex, reserved, allocationSum: sum });
        }
        for (const item of allocations) {
          const qty = num(item.quantity);
          const id = balanceId(line.productId, item.warehouseId, item.locationId);
          if (qty <= EPS || !balanceMap.has(id)) {
            findings.push({ code: qty <= EPS ? 'invalid_existing_allocation' : 'allocated_balance_missing', orgId, orderId: order.id, lineIndex, balanceId: id, qty });
          } else {
            known.set(id, (known.get(id) ?? 0) + qty);
          }
        }
        return;
      }
      if (allocations !== undefined && !Array.isArray(allocations)) {
        findings.push({ code: 'invalid_allocation_shape', orgId, orderId: order.id, lineIndex });
        return;
      }
      if (reserved <= EPS) return;
      if (!order.warehouseId || !line.productId) {
        findings.push({ code: 'legacy_reservation_missing_product_or_warehouse', orgId, orderId: order.id, lineIndex, reserved });
        return;
      }
      const key = `${order.warehouseId}::${line.productId}`;
      const group = legacy.get(key) ?? { warehouseId: order.warehouseId, productId: line.productId, rows: [], total: 0, terminal: false };
      group.rows.push({ orderId: order.id, lineIndex, reserved, status: order.status, productSku: line.productSku ?? '' });
      group.total += reserved;
      group.terminal ||= TERMINAL.has(order.status);
      legacy.set(key, group);
    });
  }

  const safeTotal = new Map();
  for (const group of legacy.values()) {
    if (group.terminal) {
      findings.push({ code: 'terminal_order_still_reserved', orgId, productId: group.productId, warehouseId: group.warehouseId, legacyQty: group.total });
      continue;
    }
    const candidates = balances.filter((item) =>
      item.productId === group.productId &&
      item.warehouseId === group.warehouseId &&
      num(item.reservedQty) > EPS
    );
    if (!candidates.length) {
      findings.push({ code: 'no_positive_reserved_balance', orgId, productId: group.productId, warehouseId: group.warehouseId, legacyQty: group.total });
      continue;
    }
    if (candidates.length > 1) {
      findings.push({ code: 'ambiguous_multiple_locations', orgId, productId: group.productId, warehouseId: group.warehouseId, legacyQty: group.total, candidateBalanceIds: candidates.map((item) => item.id) });
      continue;
    }
    const candidate = candidates[0];
    const knownQty = known.get(candidate.id) ?? 0;
    if (num(candidate.reservedQty) + EPS < knownQty + group.total) {
      findings.push({ code: 'reserved_balance_below_declared_order_qty', orgId, balanceId: candidate.id, balanceReservedQty: candidate.reservedQty, knownAllocatedQty: knownQty, legacyQty: group.total });
      continue;
    }
    safeTotal.set(candidate.id, group.total);
    for (const row of group.rows) {
      safeAssignments.push({
        orgId, orderId: row.orderId, lineIndex: row.lineIndex,
        productId: group.productId, warehouseId: group.warehouseId,
        locationId: candidate.locationId, balanceId: candidate.id,
        reservedQty: row.reserved, productSku: row.productSku,
      });
    }
  }

  for (const balance of balances) {
    const physical = num(balance.physicalQty);
    const reserved = num(balance.reservedQty);
    const available = num(balance.availableQty);
    const expectedAvailable = Math.max(0, physical - reserved);
    if (physical < -EPS || reserved < -EPS || reserved > physical + EPS) {
      balanceFindings.push({ code: 'invalid_physical_or_reserved_quantity', orgId, balanceId: balance.id, physicalQty: physical, reservedQty: reserved });
    }
    if (Math.abs(available - expectedAvailable) > 0.001) {
      balanceFindings.push({ code: 'available_quantity_mismatch', orgId, balanceId: balance.id, availableQty: available, expectedAvailable });
    }
    if (physical > EPS && !balance.lastMovementId) {
      balanceFindings.push({ code: 'legacy_balance_without_last_movement', orgId, balanceId: balance.id, physicalQty: physical });
    } else if (balance.lastMovementId) {
      const movement = movementMap.get(balance.lastMovementId);
      if (!movement) balanceFindings.push({ code: 'last_movement_reference_missing', orgId, balanceId: balance.id, lastMovementId: balance.lastMovementId });
      else if (!movementMatches(movement, balance)) balanceFindings.push({ code: 'last_movement_dimension_mismatch', orgId, balanceId: balance.id, lastMovementId: balance.lastMovementId });
    }
    const knownQty = known.get(balance.id) ?? 0;
    const proposedQty = safeTotal.get(balance.id) ?? 0;
    if (knownQty > reserved + EPS) balanceFindings.push({ code: 'order_allocations_exceed_balance_reservations', orgId, balanceId: balance.id, knownAllocatedQty: knownQty, balanceReservedQty: reserved });
    const unexplained = reserved - knownQty - proposedQty;
    if (unexplained > EPS) balanceFindings.push({ code: 'reserved_quantity_not_linked_to_order', orgId, balanceId: balance.id, unexplainedReservedQty: unexplained });
  }

  const byOrder = new Map();
  for (const assignment of safeAssignments) {
    const rows = byOrder.get(assignment.orderId) ?? [];
    rows.push(assignment);
    byOrder.set(assignment.orderId, rows);
  }
  const applyPlan = [...byOrder.entries()].map(([orderId, assignments]) => ({
    orgId, orderId, assignments,
    memberUids: Array.isArray(orgData.memberUids) && orgData.memberUids.length
      ? orgData.memberUids.slice(0, 50)
      : [String(orgData.ownerId ?? 'stockflow-migration')],
  }));
  return {
    orgId, orderCount: orders.length, balanceCount: balances.length, movementCount: movements.length,
    safeAssignments, applyPlan, knownAllocatedByBalance: Object.fromEntries(known),
    safeTotalByBalance: Object.fromEntries(safeTotal), findings, balanceFindings,
  };
}

function parseArgs(args) {
  const options = { apply: false, orgId: null, out: null, confirmProjectId: null, confirmDatabaseId: null };
  for (const arg of args) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--org-id=')) options.orgId = arg.slice(9);
    else if (arg.startsWith('--out=')) options.out = arg.slice(6);
    else if (arg.startsWith('--confirm-project-id=')) options.confirmProjectId = arg.slice(21);
    else if (arg.startsWith('--confirm-database-id=')) options.confirmDatabaseId = arg.slice(22);
    else throw new Error(`Option inconnue : ${arg}`);
  }
  return options;
}

async function writeReport(report, outPath) {
  if (!outPath) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  const absolute = resolve(outPath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`Rapport écrit : ${absolute}\n`);
}

async function scanOrganization(orgSnapshot) {
  const ref = orgSnapshot.ref;
  const [orders, balances, movements] = await Promise.all([
    ref.collection('salesOrders').get(),
    ref.collection('stockBalances').get(),
    ref.collection('stockMovements').get(),
  ]);
  return buildOrgPlan({
    orgId: orgSnapshot.id,
    orgData: orgSnapshot.data(),
    orders: orders.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    balances: balances.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    movements: movements.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
  });
}

async function applyOrderPlan(db, plan, orderPlan) {
  const orderRef = db.doc(`organizations/${plan.orgId}/salesOrders/${orderPlan.orderId}`);
  const migrationId = `mig_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const balanceIds = [...new Set(orderPlan.assignments.map((item) => item.balanceId))];
  await db.runTransaction(async (tx) => {
    const orderSnapshot = await tx.get(orderRef);
    if (!orderSnapshot.exists) throw new Error('Commande disparue depuis le scan.');
    const order = orderSnapshot.data();
    if (TERMINAL.has(order.status)) throw new Error('Commande terminale depuis le scan.');
    const lines = Array.isArray(order.lines) ? order.lines.map((line) => ({ ...line })) : [];
    for (const assignment of orderPlan.assignments) {
      const line = lines[assignment.lineIndex];
      if (!line || line.productId !== assignment.productId ||
          Math.abs(num(line.reservedQty) - assignment.reservedQty) > EPS ||
          (Array.isArray(line.reservationAllocations) && line.reservationAllocations.length > 0)) {
        throw new Error(`Commande modifiée depuis le scan (ligne ${assignment.lineIndex}).`);
      }
    }
    const snapshots = await Promise.all(balanceIds.map((id) =>
      tx.get(db.doc(`organizations/${plan.orgId}/stockBalances/${id}`))
    ));
    for (let index = 0; index < balanceIds.length; index += 1) {
      const id = balanceIds[index];
      if (!snapshots[index].exists) throw new Error(`Solde disparu : ${id}`);
      const current = snapshots[index].data();
      const required = num(plan.knownAllocatedByBalance[id]) + num(plan.safeTotalByBalance[id]);
      if (num(current.reservedQty) + EPS < required) throw new Error(`Solde réservé insuffisant : ${id}`);
    }
    for (const assignment of orderPlan.assignments) {
      lines[assignment.lineIndex].reservationAllocations = [{
        warehouseId: assignment.warehouseId,
        locationId: assignment.locationId,
        quantity: assignment.reservedQty,
      }];
    }
    tx.update(orderRef, { lines, updatedAt: FieldValue.serverTimestamp() });
    tx.create(db.doc(`organizations/${plan.orgId}/auditLogs/${migrationId}`), {
      id: migrationId, orgId: plan.orgId,
      actorUid: 'stockflow-migration', actorEmail: 'migration@stockflow.system',
      action: 'LEGACY_STOCK_RESERVATIONS_RECONCILED',
      entityType: 'migration', entityId: orderPlan.orderId,
      summary: `Ventilation historique de ${orderPlan.assignments.length} ligne(s); quantités physiques inchangées.`,
      memberUids: orderPlan.memberUids,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('Audit en lecture seule : bun run audit:stock-history -- --out=reports/stock-history.json\nApplication explicite : ajouter --apply --confirm-project-id=<projectId> --confirm-database-id=<databaseId>.\n');
    return;
  }
  if (options.apply && (
    options.confirmProjectId !== firebaseConfig.projectId ||
    options.confirmDatabaseId !== firebaseConfig.firestoreDatabaseId
  )) throw new Error('Application refusée : confirmer explicitement le projectId et le databaseId exacts.');

  const app = getApps()[0] ?? initializeApp({ projectId: firebaseConfig.projectId, credential: applicationDefault() });
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  const orgQuery = options.orgId
    ? db.collection('organizations').where('__name__', '==', options.orgId)
    : db.collection('organizations');
  const orgs = await orgQuery.get();
  const plans = [];
  for (const org of orgs.docs) plans.push(await scanOrganization(org));

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: options.apply ? 'apply-safe-allocations' : 'dry-run-read-only',
    projectId: firebaseConfig.projectId,
    databaseId: firebaseConfig.firestoreDatabaseId,
    summary: {
      organizations: plans.length,
      orders: plans.reduce((sum, item) => sum + item.orderCount, 0),
      balances: plans.reduce((sum, item) => sum + item.balanceCount, 0),
      movements: plans.reduce((sum, item) => sum + item.movementCount, 0),
      safeLines: plans.reduce((sum, item) => sum + item.safeAssignments.length, 0),
      reservationFindings: plans.reduce((sum, item) => sum + item.findings.length, 0),
      balanceFindings: plans.reduce((sum, item) => sum + item.balanceFindings.length, 0),
    },
    organizations: plans.map(({ applyPlan, ...item }) => item),
    applyResults: [],
    warnings: [
      'Les réservations ambiguës, les commandes terminales et les soldes insuffisants ne sont pas modifiés.',
      'Les soldes sans lastMovementId ne sont pas réécrits : un mouvement d’ouverture ne peut pas être inventé.',
      'Le mode application ne modifie que reservationAllocations et ajoute un audit log; aucun solde ni mouvement physique n’est changé.',
    ],
  };
  if (options.apply) {
    for (const plan of plans) {
      for (const orderPlan of plan.applyPlan) {
        try {
          await applyOrderPlan(db, plan, orderPlan);
          report.applyResults.push({ orgId: plan.orgId, orderId: orderPlan.orderId, status: 'applied', lines: orderPlan.assignments.length });
        } catch (error) {
          report.applyResults.push({ orgId: plan.orgId, orderId: orderPlan.orderId, status: 'skipped', reason: error instanceof Error ? error.message : String(error) });
        }
      }
    }
  }
  await writeReport(report, options.out);
  process.stdout.write(`Organisations ${report.summary.organizations}; lignes sûres ${report.summary.safeLines}; anomalies réservation ${report.summary.reservationFindings}; anomalies solde ${report.summary.balanceFindings}.\n`);
  process.stdout.write(options.apply ? 'Application terminée; aucune quantité physique modifiée.\n' : 'Mode lecture seule : aucune écriture effectuée.\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`Audit/migration interrompu : ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
