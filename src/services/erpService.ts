import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  deleteDoc,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '../lib/firebase.ts';
import { handleFirestoreError, OperationType } from '../lib/firestoreError.ts';
import { generateSafeId, slugify, toDate } from '../shared/formatters.ts';
import type {
  AddOrganizationMemberInput,
  CreateOrganizationInput,
  UpdateOrganizationInput,
  CategoryInput,
  ProductInput,
  WarehouseInput,
  LocationInput,
  StockMovementInput,
} from '../shared/schemas.ts';
import type {
  AppNotification,
  AuditLog,
  BillingCycle,
  MemberStatus,
  Organization,
  OrganizationMember,
  OrgRole,
  PlanCode,
  Product,
  ProductCategory,
  StockBalance,
  StockMovement,
  SubscriptionStatus,
  UserMembership,
  Warehouse,
  WarehouseLocation,
} from '../shared/types.ts';

export async function upsertUserProfile(user: User, activeOrgId?: string): Promise<void> {
  const path = `users/${user.uid}`;
  try {
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);
    const displayName = (user.displayName || user.email?.split('@')[0] || 'Utilisateur').slice(0, 120);
    const email = (user.email || 'utilisateur@stockflow.local').slice(0, 254);

    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        email,
        displayName,
        ...(user.photoURL ? { photoURL: user.photoURL.slice(0, 512) } : {}),
        ...(activeOrgId ? { activeOrgId } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        displayName,
        ...(user.photoURL ? { photoURL: user.photoURL.slice(0, 512) } : {}),
        ...(activeOrgId ? { activeOrgId } : {}),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function listUserMemberships(uid: string): Promise<UserMembership[]> {
  const path = `users/${uid}/memberships`;
  try {
    const snap = await getDocs(collection(db, 'users', uid, 'memberships'));
    return snap.docs.map((d) => d.data() as UserMembership);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function getOrganization(orgId: string): Promise<Organization | null> {
  const path = `organizations/${orgId}`;
  try {
    const snap = await getDoc(doc(db, 'organizations', orgId));
    return snap.exists() ? (snap.data() as Organization) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function createOrganizationWorkspace(
  user: User,
  input: CreateOrganizationInput
): Promise<string> {
  const orgId = generateSafeId('org');
  const slug = `${slugify(input.name)}-${orgId.slice(-4)}`;
  const displayName = (user.displayName || user.email?.split('@')[0] || 'Propriétaire').slice(0, 120);
  const email = (user.email || 'admin@stockflow.local').slice(0, 254);
  const memberUids = [user.uid];

  // Batch 1: Atomic Organization + Owner Member + User Membership Index
  const batch1 = writeBatch(db);
  const orgRef = doc(db, 'organizations', orgId);
  const memberRef = doc(db, 'organizations', orgId, 'members', user.uid);
  const userMembershipRef = doc(db, 'users', user.uid, 'memberships', orgId);
  const userRef = doc(db, 'users', user.uid);

  batch1.set(orgRef, {
    id: orgId,
    name: input.name,
    slug,
    currency: input.currency,
    country: input.country || 'France',
    siret: input.siret || '',
    vatNumber: input.vatNumber || '',
    plan: 'starter',
    ownerId: user.uid,
    memberUids,
    isDemoSeeded: input.seedDemo,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch1.set(memberRef, {
    uid: user.uid,
    orgId,
    orgOwnerId: user.uid,
    email,
    displayName,
    role: 'owner',
    status: 'active',
    memberUids,
    joinedAt: serverTimestamp(),
  });

  batch1.set(userMembershipRef, {
    orgId,
    orgName: input.name,
    orgSlug: slug,
    role: 'owner',
    plan: 'starter',
    currency: input.currency,
    joinedAt: serverTimestamp(),
  });

  batch1.update(userRef, {
    activeOrgId: orgId,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch1.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `organizations/${orgId}`);
  }

  // Batch 2: Default Warehouse + Optional Demo Seed
  const batch2 = writeBatch(db);
  const logId = generateSafeId('log');
  batch2.set(doc(db, 'organizations', orgId, 'auditLogs', logId), {
    id: logId,
    orgId,
    actorUid: user.uid,
    actorEmail: email,
    action: 'ORG_CREATED',
    entityType: 'organization',
    entityId: orgId,
    summary: `Création de l'organisation « ${input.name} » (Plan Starter, ${input.currency})`,
    memberUids,
    createdAt: serverTimestamp(),
  });

  if (input.seedDemo) {
    seedDemoCatalogIntoBatch(batch2, orgId, user.uid, displayName, memberUids);
  } else {
    // Always provision 1 default warehouse & 1 default storage location
    const whId = generateSafeId('wh');
    const locId = generateSafeId('loc');
    batch2.set(doc(db, 'organizations', orgId, 'warehouses', whId), {
      id: whId,
      orgId,
      code: 'WH-01',
      name: 'Entrepôt Principal',
      address: '',
      city: '',
      country: input.country || 'France',
      capacityUnits: 10000,
      isDefault: true,
      status: 'active',
      isDemo: false,
      memberUids,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch2.set(doc(db, 'organizations', orgId, 'locations', locId), {
      id: locId,
      orgId,
      warehouseId: whId,
      code: 'ZONE-A1',
      zoneType: 'storage',
      aisle: 'A',
      rack: '01',
      level: '01',
      capacity: 1000,
      status: 'active',
      memberUids,
      createdAt: serverTimestamp(),
    });
  }

  try {
    await batch2.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `organizations/${orgId}/seed`);
  }

  return orgId;
}

function seedDemoCatalogIntoBatch(
  batch: ReturnType<typeof writeBatch>,
  orgId: string,
  uid: string,
  displayName: string,
  memberUids: string[]
) {
  const categories = [
    { id: 'cat_elec', code: 'ELEC', name: 'Électronique & Capteurs', description: 'Capteurs industriels, automates et connectique (Données de démonstration)' },
    { id: 'cat_meca', code: 'MECA', name: 'Composants Mécaniques', description: 'Roulements, vérins, visserie de précision (Données de démonstration)' },
    { id: 'cat_pack', code: 'EMBAL', name: 'Emballage & Logistique', description: 'Cartons, palettes, films et consommables (Données de démonstration)' },
  ];

  for (const cat of categories) {
    batch.set(doc(db, 'organizations', orgId, 'categories', cat.id), {
      ...cat,
      orgId,
      memberUids,
      createdAt: serverTimestamp(),
    });
  }

  const whParis = {
    id: 'wh_paris',
    orgId,
    code: 'WH-PAR',
    name: 'Entrepôt Paris Nord',
    address: '14 Rue de l’Industrie',
    city: 'Saint-Denis',
    country: 'France',
    capacityUnits: 15000,
    isDefault: true,
    status: 'active',
    isDemo: true,
    memberUids,
  };
  const whLyon = {
    id: 'wh_lyon',
    orgId,
    code: 'WH-LYO',
    name: 'Hub Logistique Lyon',
    address: '8 Avenue des Frères Lumière',
    city: 'Vénissieux',
    country: 'France',
    capacityUnits: 8500,
    isDefault: false,
    status: 'active',
    isDemo: true,
    memberUids,
  };

  for (const wh of [whParis, whLyon]) {
    batch.set(doc(db, 'organizations', orgId, 'warehouses', wh.id), {
      ...wh,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const locations = [
    { id: 'loc_par_a1', warehouseId: 'wh_paris', code: 'A-01-01', zoneType: 'storage', aisle: 'A', rack: '01', level: '01', capacity: 800 },
    { id: 'loc_par_a2', warehouseId: 'wh_paris', code: 'A-01-02', zoneType: 'storage', aisle: 'A', rack: '01', level: '02', capacity: 800 },
    { id: 'loc_par_pick', warehouseId: 'wh_paris', code: 'PREP-01', zoneType: 'picking', aisle: 'P', rack: '01', level: '00', capacity: 400 },
    { id: 'loc_par_rec', warehouseId: 'wh_paris', code: 'REC-01', zoneType: 'receiving', aisle: 'R', rack: '01', level: '00', capacity: 600 },
    { id: 'loc_lyo_a1', warehouseId: 'wh_lyon', code: 'LYO-A1', zoneType: 'storage', aisle: 'A', rack: '01', level: '01', capacity: 1200 },
  ];

  for (const loc of locations) {
    batch.set(doc(db, 'organizations', orgId, 'locations', loc.id), {
      ...loc,
      orgId,
      status: 'active',
      memberUids,
      createdAt: serverTimestamp(),
    });
  }

  const demoProducts = [
    {
      id: 'prod_cap_01',
      sku: 'SF-CAP-104',
      barcode: '3760123450014',
      name: 'Capteur optique industriel M18',
      description: 'Capteur photoélectrique IP67 portée 2m pour convoyeurs.',
      categoryId: 'cat_elec',
      categoryName: 'Électronique & Capteurs',
      brand: 'OptiSense',
      unit: 'unité',
      purchasePrice: 42.5,
      salePrice: 79.0,
      vatRate: 20,
      minStock: 20,
      maxStock: 180,
      qty: 94,
      whId: 'wh_paris',
      whName: 'Entrepôt Paris Nord',
      locId: 'loc_par_a1',
      locCode: 'A-01-01',
    },
    {
      id: 'prod_plc_02',
      sku: 'SF-AUT-208',
      barcode: '3760123450021',
      name: 'Automate programmable Compact-24V',
      description: 'Contrôleur Modbus/TCP 16 entrées / 12 sorties.',
      categoryId: 'cat_elec',
      categoryName: 'Électronique & Capteurs',
      brand: 'KronoTech',
      unit: 'unité',
      purchasePrice: 215.0,
      salePrice: 365.0,
      vatRate: 20,
      minStock: 10,
      maxStock: 60,
      qty: 6, // Sous seuil !
      whId: 'wh_paris',
      whName: 'Entrepôt Paris Nord',
      locId: 'loc_par_a2',
      locCode: 'A-01-02',
    },
    {
      id: 'prod_roul_03',
      sku: 'SF-MEC-312',
      barcode: '3760123450038',
      name: 'Roulement à billes étanche 6205-2RS',
      description: 'Acier chromé haute vitesse avec double joint lèvre.',
      categoryId: 'cat_meca',
      categoryName: 'Composants Mécaniques',
      brand: 'SKF Pro',
      unit: 'boîte',
      purchasePrice: 14.2,
      salePrice: 28.9,
      vatRate: 20,
      minStock: 30,
      maxStock: 300,
      qty: 165,
      whId: 'wh_lyon',
      whName: 'Hub Logistique Lyon',
      locId: 'loc_lyo_a1',
      locCode: 'LYO-A1',
    },
    {
      id: 'prod_ver_04',
      sku: 'SF-MEC-419',
      barcode: '3760123450045',
      name: 'Vérin pneumatique double effet Ø40',
      description: 'Course 150mm ISO 15552 aluminium anodisé.',
      categoryId: 'cat_meca',
      categoryName: 'Composants Mécaniques',
      brand: 'Pneumax',
      unit: 'unité',
      purchasePrice: 68.0,
      salePrice: 124.0,
      vatRate: 20,
      minStock: 12,
      maxStock: 80,
      qty: 0, // En rupture !
      whId: 'wh_paris',
      whName: 'Entrepôt Paris Nord',
      locId: 'loc_par_a1',
      locCode: 'A-01-01',
    },
    {
      id: 'prod_cart_05',
      sku: 'SF-EMB-501',
      barcode: '3760123450052',
      name: 'Caisse carton double cannelure 600x400',
      description: 'Carton renforcé expédition palettisée (lot de 25).',
      categoryId: 'cat_pack',
      categoryName: 'Emballage & Logistique',
      brand: 'PackNord',
      unit: 'lot',
      purchasePrice: 29.0,
      salePrice: 49.5,
      vatRate: 20,
      minStock: 25,
      maxStock: 250,
      qty: 112,
      whId: 'wh_paris',
      whName: 'Entrepôt Paris Nord',
      locId: 'loc_par_pick',
      locCode: 'PREP-01',
    },
    {
      id: 'prod_film_06',
      sku: 'SF-EMB-520',
      barcode: '3760123450069',
      name: 'Film étirable manuel 23µ transparent',
      description: 'Rouleau 300m largeur 450mm pour banderolage palette.',
      categoryId: 'cat_pack',
      categoryName: 'Emballage & Logistique',
      brand: 'PackNord',
      unit: 'rouleau',
      purchasePrice: 7.4,
      salePrice: 13.9,
      vatRate: 20,
      minStock: 40,
      maxStock: 400,
      qty: 22, // Sous seuil !
      whId: 'wh_lyon',
      whName: 'Hub Logistique Lyon',
      locId: 'loc_lyo_a1',
      locCode: 'LYO-A1',
    },
  ];

  for (const p of demoProducts) {
    batch.set(doc(db, 'organizations', orgId, 'products', p.id), {
      id: p.id,
      orgId,
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      description: p.description,
      categoryId: p.categoryId,
      categoryName: p.categoryName,
      brand: p.brand,
      unit: p.unit,
      purchasePrice: p.purchasePrice,
      salePrice: p.salePrice,
      vatRate: p.vatRate,
      minStock: p.minStock,
      maxStock: p.maxStock,
      status: 'active',
      trackBatches: false,
      trackSerials: false,
      trackExpiry: false,
      isDemo: true,
      memberUids,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const balId = `${p.id}_${p.whId}_${p.locId}`;
    const initialMovementId = p.qty > 0 ? `mvt_init_${p.id}` : undefined;
    batch.set(doc(db, 'organizations', orgId, 'stockBalances', balId), {
      id: balId,
      orgId,
      productId: p.id,
      productSku: p.sku,
      productName: p.name,
      warehouseId: p.whId,
      warehouseName: p.whName,
      locationId: p.locId,
      locationCode: p.locCode,
      physicalQty: p.qty,
      reservedQty: p.qty > 10 ? 4 : 0,
      onOrderQty: p.qty <= p.minStock ? 25 : 0,
      inTransitQty: 0,
      availableQty: p.qty > 10 ? p.qty - 4 : p.qty,
      unitCost: p.purchasePrice,
      ...(initialMovementId ? { lastMovementId: initialMovementId } : {}),
      memberUids,
      updatedAt: serverTimestamp(),
    });

    if (p.qty > 0) {
      const mvtId = initialMovementId!;
      batch.set(doc(db, 'organizations', orgId, 'stockMovements', mvtId), {
        id: mvtId,
        orgId,
        reference: `MVT-DEMO-${p.sku}`,
        movementType: 'IN',
        productId: p.id,
        productSku: p.sku,
        productName: p.name,
        warehouseId: p.whId,
        warehouseName: p.whName,
        locationId: p.locId,
        locationCode: p.locCode,
        quantity: p.qty,
        unitCost: p.purchasePrice,
        reason: 'Stock initial de démonstration (traçabilité phase 1)',
        sourceDocumentType: 'Initialisation Démo',
        sourceDocumentRef: 'INIT-DEMO-01',
        performedByUid: uid,
        performedByName: displayName,
        isDemo: true,
        memberUids,
        createdAt: serverTimestamp(),
      });
    }
  }

  batch.set(doc(db, 'organizations', orgId, 'notifications', 'notif_rupture_demo'), {
    id: 'notif_rupture_demo',
    orgId,
    title: 'Rupture de stock détectée',
    message: 'Vérin pneumatique double effet Ø40 (SF-MEC-419) est à 0 unité disponible.',
    severity: 'error',
    isRead: false,
    link: '/stocks',
    memberUids,
    createdAt: serverTimestamp(),
  });

  batch.set(doc(db, 'organizations', orgId, 'notifications', 'notif_seuil_demo'), {
    id: 'notif_seuil_demo',
    orgId,
    title: 'Produits sous seuil minimum',
    message: 'Automate Compact-24V (6/10) et Film étirable 23µ (22/40) nécessitent un réapprovisionnement.',
    severity: 'warning',
    isRead: false,
    link: '/stocks',
    memberUids,
    createdAt: serverTimestamp(),
  });
}

// ---------------------------------------------------------------------------
// Queries (All list queries filter by memberUids array-contains for Rules)
// ---------------------------------------------------------------------------
export async function listCategories(orgId: string, uid: string): Promise<ProductCategory[]> {
  const path = `organizations/${orgId}/categories`;
  try {
    const q = query(
      collection(db, 'organizations', orgId, 'categories'),
      where('memberUids', 'array-contains', uid)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as ProductCategory).sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listProducts(orgId: string, uid: string): Promise<Product[]> {
  const path = `organizations/${orgId}/products`;
  try {
    const q = query(
      collection(db, 'organizations', orgId, 'products'),
      where('memberUids', 'array-contains', uid)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as Product).sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listWarehouses(orgId: string, uid: string): Promise<Warehouse[]> {
  const path = `organizations/${orgId}/warehouses`;
  try {
    const q = query(
      collection(db, 'organizations', orgId, 'warehouses'),
      where('memberUids', 'array-contains', uid)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as Warehouse).sort((a, b) => a.code.localeCompare(b.code));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listLocations(orgId: string, uid: string): Promise<WarehouseLocation[]> {
  const path = `organizations/${orgId}/locations`;
  try {
    const q = query(
      collection(db, 'organizations', orgId, 'locations'),
      where('memberUids', 'array-contains', uid)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as WarehouseLocation).sort((a, b) => a.code.localeCompare(b.code));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listStockBalances(orgId: string, uid: string): Promise<StockBalance[]> {
  const path = `organizations/${orgId}/stockBalances`;
  try {
    const q = query(
      collection(db, 'organizations', orgId, 'stockBalances'),
      where('memberUids', 'array-contains', uid)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as StockBalance);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listStockMovements(orgId: string, uid: string): Promise<StockMovement[]> {
  const path = `organizations/${orgId}/stockMovements`;
  try {
    const q = query(
      collection(db, 'organizations', orgId, 'stockMovements'),
      where('memberUids', 'array-contains', uid)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as StockMovement)
      .sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listOrgMembers(orgId: string, uid: string): Promise<OrganizationMember[]> {
  const path = `organizations/${orgId}/members`;
  try {
    const q = query(
      collection(db, 'organizations', orgId, 'members'),
      where('memberUids', 'array-contains', uid)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as OrganizationMember);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listAuditLogs(orgId: string, uid: string): Promise<AuditLog[]> {
  const path = `organizations/${orgId}/auditLogs`;
  try {
    const q = query(
      collection(db, 'organizations', orgId, 'auditLogs'),
      where('memberUids', 'array-contains', uid)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as AuditLog)
      .sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listNotifications(orgId: string, uid: string): Promise<AppNotification[]> {
  const path = `organizations/${orgId}/notifications`;
  try {
    const q = query(
      collection(db, 'organizations', orgId, 'notifications'),
      where('memberUids', 'array-contains', uid)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as AppNotification)
      .sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
export async function updateOrganizationDetails(
  orgId: string,
  input: UpdateOrganizationInput,
  actor: { uid: string; email: string },
  memberUids: string[]
): Promise<void> {
  const path = `organizations/${orgId}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'organizations', orgId), {
      name: input.name,
      currency: input.currency,
      country: input.country || '',
      siret: input.siret || '',
      vatNumber: input.vatNumber || '',
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'users', actor.uid, 'memberships', orgId), {
      orgName: input.name,
      currency: input.currency,
    });
    const logId = generateSafeId('log');
    batch.set(doc(db, 'organizations', orgId, 'auditLogs', logId), {
      id: logId,
      orgId,
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: 'ORG_UPDATED',
      entityType: 'organization',
      entityId: orgId,
      summary: `Mise à jour des paramètres de l'organisation « ${input.name} »`,
      memberUids,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function createCategory(
  orgId: string,
  memberUids: string[],
  input: CategoryInput
): Promise<string> {
  const id = generateSafeId('cat');
  const path = `organizations/${orgId}/categories/${id}`;
  try {
    await setDoc(doc(db, 'organizations', orgId, 'categories', id), {
      id,
      orgId,
      code: input.code.toUpperCase(),
      name: input.name,
      description: input.description || '',
      memberUids,
      createdAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function createProduct(
  orgId: string,
  memberUids: string[],
  input: ProductInput,
  categoryName: string,
  actor: { uid: string; email: string }
): Promise<string> {
  const id = generateSafeId('prod');
  const path = `organizations/${orgId}/products/${id}`;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'organizations', orgId, 'products', id), {
      id,
      orgId,
      sku: input.sku,
      barcode: input.barcode || '',
      name: input.name,
      description: input.description || '',
      categoryId: input.categoryId || '',
      categoryName: categoryName || 'Non classé',
      brand: input.brand || '',
      unit: input.unit,
      purchasePrice: Number(input.purchasePrice),
      salePrice: Number(input.salePrice),
      vatRate: Number(input.vatRate),
      minStock: Number(input.minStock),
      maxStock: Number(input.maxStock),
      status: input.status,
      trackBatches: Boolean(input.trackBatches),
      trackSerials: Boolean(input.trackSerials),
      trackExpiry: Boolean(input.trackExpiry),
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
      action: 'PRODUCT_CREATED',
      entityType: 'product',
      entityId: id,
      summary: `Création du produit ${input.sku} — ${input.name}`,
      memberUids,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateProduct(
  orgId: string,
  productId: string,
  memberUids: string[],
  input: ProductInput,
  categoryName: string,
  actor: { uid: string; email: string }
): Promise<void> {
  const path = `organizations/${orgId}/products/${productId}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'organizations', orgId, 'products', productId), {
      sku: input.sku,
      barcode: input.barcode || '',
      name: input.name,
      description: input.description || '',
      categoryId: input.categoryId || '',
      categoryName: categoryName || 'Non classé',
      brand: input.brand || '',
      unit: input.unit,
      purchasePrice: Number(input.purchasePrice),
      salePrice: Number(input.salePrice),
      vatRate: Number(input.vatRate),
      minStock: Number(input.minStock),
      maxStock: Number(input.maxStock),
      status: input.status,
      trackBatches: Boolean(input.trackBatches),
      trackSerials: Boolean(input.trackSerials),
      trackExpiry: Boolean(input.trackExpiry),
      updatedAt: serverTimestamp(),
    });
    const logId = generateSafeId('log');
    batch.set(doc(db, 'organizations', orgId, 'auditLogs', logId), {
      id: logId,
      orgId,
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: 'PRODUCT_UPDATED',
      entityType: 'product',
      entityId: productId,
      summary: `Modification du produit ${input.sku} — ${input.name}`,
      memberUids,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteProduct(
  orgId: string,
  product: Product,
  memberUids: string[],
  actor: { uid: string; email: string }
): Promise<void> {
  const path = `organizations/${orgId}/products/${product.id}`;
  try {
    await deleteDoc(doc(db, 'organizations', orgId, 'products', product.id));
    const logId = generateSafeId('log');
    await setDoc(doc(db, 'organizations', orgId, 'auditLogs', logId), {
      id: logId,
      orgId,
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: 'PRODUCT_DELETED',
      entityType: 'product',
      entityId: product.id,
      summary: `Suppression du produit ${product.sku} — ${product.name}`,
      memberUids,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function importProductsBatch(
  orgId: string,
  memberUids: string[],
  rows: ProductInput[],
  actor: { uid: string; email: string }
): Promise<number> {
  const path = `organizations/${orgId}/products`;
  try {
    const batch = writeBatch(db);
    for (const row of rows) {
      const id = generateSafeId('prod');
      batch.set(doc(db, 'organizations', orgId, 'products', id), {
        id,
        orgId,
        sku: row.sku,
        barcode: row.barcode || '',
        name: row.name,
        description: row.description || '',
        categoryId: '',
        categoryName: 'Import CSV',
        brand: row.brand || '',
        unit: row.unit || 'unité',
        purchasePrice: Number(row.purchasePrice),
        salePrice: Number(row.salePrice),
        vatRate: Number(row.vatRate),
        minStock: Number(row.minStock),
        maxStock: Number(row.maxStock),
        status: row.status || 'active',
        trackBatches: false,
        trackSerials: false,
        trackExpiry: false,
        isDemo: false,
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
      action: 'PRODUCTS_IMPORTED',
      entityType: 'product',
      entityId: orgId,
      summary: `Import CSV de ${rows.length} produit(s)`,
      memberUids,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    return rows.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function createWarehouse(
  orgId: string,
  memberUids: string[],
  input: WarehouseInput,
  actor: { uid: string; email: string }
): Promise<string> {
  const id = generateSafeId('wh');
  const locId = generateSafeId('loc');
  const path = `organizations/${orgId}/warehouses/${id}`;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'organizations', orgId, 'warehouses', id), {
      id,
      orgId,
      code: input.code.toUpperCase(),
      name: input.name,
      address: input.address || '',
      city: input.city || '',
      country: input.country || 'France',
      capacityUnits: Number(input.capacityUnits),
      isDefault: Boolean(input.isDefault),
      status: input.status,
      isDemo: false,
      memberUids,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'organizations', orgId, 'locations', locId), {
      id: locId,
      orgId,
      warehouseId: id,
      code: 'ZONE-A1',
      zoneType: 'storage',
      aisle: 'A',
      rack: '01',
      level: '01',
      capacity: Math.max(100, Math.round(Number(input.capacityUnits) * 0.2)),
      status: 'active',
      memberUids,
      createdAt: serverTimestamp(),
    });
    const logId = generateSafeId('log');
    batch.set(doc(db, 'organizations', orgId, 'auditLogs', logId), {
      id: logId,
      orgId,
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: 'WAREHOUSE_CREATED',
      entityType: 'warehouse',
      entityId: id,
      summary: `Création de l'entrepôt ${input.code.toUpperCase()} — ${input.name}`,
      memberUids,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function createLocation(
  orgId: string,
  memberUids: string[],
  input: LocationInput
): Promise<string> {
  const id = generateSafeId('loc');
  const path = `organizations/${orgId}/locations/${id}`;
  try {
    await setDoc(doc(db, 'organizations', orgId, 'locations', id), {
      id,
      orgId,
      warehouseId: input.warehouseId,
      code: input.code.toUpperCase(),
      zoneType: input.zoneType,
      aisle: input.aisle || '',
      rack: input.rack || '',
      level: input.level || '',
      capacity: Number(input.capacity),
      status: input.status,
      memberUids,
      createdAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

/**
 * Moteur de stock transactionnel :
 * Aucune quantité ne peut être modifiée sans générer un mouvement de stock traçable.
 */
export async function recordStockMovement(params: {
  orgId: string;
  memberUids: string[];
  input: StockMovementInput;
  product: Product;
  warehouse: Warehouse;
  location: WarehouseLocation;
  targetWarehouse?: Warehouse;
  targetLocation?: WarehouseLocation;
  actor: { uid: string; email: string; displayName: string };
}): Promise<string> {
  const {
    orgId,
    memberUids,
    input,
    product,
    warehouse,
    location,
    targetWarehouse,
    targetLocation,
    actor,
  } = params;

  const movementId = generateSafeId('mvt');
  const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const reference = `MVT-${nowStr}-${movementId.slice(-5).toUpperCase()}`;
  const sourceBalanceId = `${product.id}_${warehouse.id}_${location.id}`;
  const qty = Math.abs(Number(input.quantity));
  const path = `organizations/${orgId}/stockMovements/${movementId}`;

  try {
    await runTransaction(db, async (tx) => {
      const srcBalRef = doc(db, 'organizations', orgId, 'stockBalances', sourceBalanceId);
      const srcBalSnap = await tx.get(srcBalRef);
      const srcData = srcBalSnap.exists() ? (srcBalSnap.data() as StockBalance) : null;

      const currentPhysical = srcData?.physicalQty ?? 0;
      const currentReserved = srcData?.reservedQty ?? 0;
      const currentAvailable = srcData?.availableQty ?? 0;
      const currentCost = srcData?.unitCost ?? product.purchasePrice;

      let newSrcPhysical = currentPhysical;
      let signedQty = qty;

      if (input.movementType === 'IN') {
        newSrcPhysical = currentPhysical + qty;
        signedQty = qty;
      } else if (input.movementType === 'OUT') {
        if (qty > currentAvailable) {
          throw new Error(
            `Stock disponible insuffisant sur ${location.code} (${currentAvailable} disponible, ${qty} demandé).`
          );
        }
        newSrcPhysical = currentPhysical - qty;
        signedQty = -qty;
      } else if (input.movementType === 'ADJUSTMENT') {
        signedQty = Number(input.quantity);
        newSrcPhysical = currentPhysical + signedQty;
        if (newSrcPhysical < currentReserved) {
          throw new Error(
            `L'ajustement ne peut pas ramener le stock physique sous le stock réservé (${currentReserved}).`
          );
        }
      } else if (input.movementType === 'TRANSFER') {
        if (!targetWarehouse || !targetLocation) {
          throw new Error('Entrepôt et emplacement de destination requis pour un transfert.');
        }
        if (warehouse.id === targetWarehouse.id && location.id === targetLocation.id) {
          throw new Error('La destination du transfert doit être différente de la source.');
        }
        if (qty > currentAvailable) {
          throw new Error(
            `Stock disponible insuffisant pour transfert (${currentAvailable} disponible, ${qty} demandé).`
          );
        }
        newSrcPhysical = currentPhysical - qty;
        signedQty = qty;
      }

      const newSrcAvailable = Math.max(0, newSrcPhysical - currentReserved);
      const unitCost = input.unitCost > 0 ? Number(input.unitCost) : currentCost;

      if (input.movementType === 'TRANSFER' && targetWarehouse && targetLocation) {
        const tgtBalanceId = `${product.id}_${targetWarehouse.id}_${targetLocation.id}`;
        const tgtBalRef = doc(db, 'organizations', orgId, 'stockBalances', tgtBalanceId);
        const tgtBalSnap = await tx.get(tgtBalRef);
        const tgtData = tgtBalSnap.exists() ? (tgtBalSnap.data() as StockBalance) : null;
        const newTgtPhysical = (tgtData?.physicalQty ?? 0) + qty;
        const tgtReserved = tgtData?.reservedQty ?? 0;

        const tgtPayload = {
          id: tgtBalanceId,
          orgId,
          productId: product.id,
          productSku: product.sku,
          productName: product.name,
          warehouseId: targetWarehouse.id,
          warehouseName: targetWarehouse.name,
          locationId: targetLocation.id,
          locationCode: targetLocation.code,
          physicalQty: newTgtPhysical,
          reservedQty: tgtReserved,
          onOrderQty: tgtData?.onOrderQty ?? 0,
          inTransitQty: tgtData?.inTransitQty ?? 0,
          availableQty: Math.max(0, newTgtPhysical - tgtReserved),
          unitCost,
          lastMovementId: movementId,
          memberUids,
          updatedAt: serverTimestamp(),
        };

        if (tgtBalSnap.exists()) {
          tx.update(tgtBalRef, {
            productSku: product.sku,
            productName: product.name,
            warehouseName: targetWarehouse.name,
            locationCode: targetLocation.code,
            physicalQty: newTgtPhysical,
            availableQty: Math.max(0, newTgtPhysical - tgtReserved),
            unitCost,
            lastMovementId: movementId,
            updatedAt: serverTimestamp(),
          });
        } else {
          tx.set(tgtBalRef, tgtPayload);
        }
      }

      if (srcBalSnap.exists()) {
        tx.update(srcBalRef, {
          productSku: product.sku,
          productName: product.name,
          warehouseName: warehouse.name,
          locationCode: location.code,
          physicalQty: newSrcPhysical,
          availableQty: newSrcAvailable,
          unitCost,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(srcBalRef, {
          id: sourceBalanceId,
          orgId,
          productId: product.id,
          productSku: product.sku,
          productName: product.name,
          warehouseId: warehouse.id,
          warehouseName: warehouse.name,
          locationId: location.id,
          locationCode: location.code,
          physicalQty: newSrcPhysical,
          reservedQty: 0,
          onOrderQty: 0,
          inTransitQty: 0,
          availableQty: newSrcAvailable,
          unitCost,
          lastMovementId: movementId,
          memberUids,
          updatedAt: serverTimestamp(),
        });
      }

      tx.set(doc(db, 'organizations', orgId, 'stockMovements', movementId), {
        id: movementId,
        orgId,
        reference,
        movementType: input.movementType,
        productId: product.id,
        productSku: product.sku,
        productName: product.name,
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        locationId: location.id,
        locationCode: location.code,
        ...(targetWarehouse ? { targetWarehouseId: targetWarehouse.id, targetWarehouseName: targetWarehouse.name } : {}),
        ...(targetLocation ? { targetLocationId: targetLocation.id, targetLocationCode: targetLocation.code } : {}),
        quantity: signedQty,
        unitCost,
        reason: input.reason,
        sourceDocumentType: input.sourceDocumentType || 'Opération manuelle',
        sourceDocumentRef: input.sourceDocumentRef || reference,
        performedByUid: actor.uid,
        performedByName: actor.displayName,
        isDemo: false,
        memberUids,
        createdAt: serverTimestamp(),
      });

      const logId = generateSafeId('log');
      tx.set(doc(db, 'organizations', orgId, 'auditLogs', logId), {
        id: logId,
        orgId,
        actorUid: actor.uid,
        actorEmail: actor.email,
        action: `STOCK_${input.movementType}`,
        entityType: 'stock_movement',
        entityId: movementId,
        summary: `${reference} : ${input.movementType} ${signedQty} × ${product.sku} (${warehouse.code} / ${location.code})`,
        memberUids,
        createdAt: serverTimestamp(),
      });

      if (newSrcAvailable <= product.minStock && input.movementType !== 'IN') {
        const notifId = generateSafeId('notif');
        tx.set(doc(db, 'organizations', orgId, 'notifications', notifId), {
          id: notifId,
          orgId,
          title: newSrcAvailable === 0 ? 'Rupture de stock' : 'Seuil minimum atteint',
          message: `${product.name} (${product.sku}) : ${newSrcAvailable} ${product.unit} disponible sur ${warehouse.name}.`,
          severity: newSrcAvailable === 0 ? 'error' : 'warning',
          isRead: false,
          link: '/stocks',
          memberUids,
          createdAt: serverTimestamp(),
        });
      }
    });

    return reference;
  } catch (error) {
    if (error instanceof Error && (error.message.includes('insuffisant') || error.message.includes('destination') || error.message.includes('réservé'))) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function markNotificationRead(orgId: string, notificationId: string): Promise<void> {
  const path = `organizations/${orgId}/notifications/${notificationId}`;
  try {
    await updateDoc(doc(db, 'organizations', orgId, 'notifications', notificationId), {
      isRead: true,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// ---------------------------------------------------------------------------
// Phase 7 — Abonnements SaaS & Gouvernance Équipe RBAC
// ---------------------------------------------------------------------------
export async function updateOrganizationPlan(params: {
  orgId: string;
  planCode: PlanCode;
  billingCycle: BillingCycle;
  subscriptionStatus: SubscriptionStatus;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  mode: 'stripe' | 'sandbox' | 'free';
  actor: { uid: string; email: string };
  memberUids: string[];
}): Promise<void> {
  const {
    orgId,
    planCode,
    billingCycle,
    subscriptionStatus,
    stripeCustomerId,
    stripeSubscriptionId,
    mode,
    actor,
    memberUids,
  } = params;
  const path = `organizations/${orgId}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'organizations', orgId), {
      plan: planCode,
      billingCycle,
      subscriptionStatus,
      ...(stripeCustomerId ? { stripeCustomerId } : {}),
      ...(stripeSubscriptionId ? { stripeSubscriptionId } : {}),
      planUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'users', actor.uid, 'memberships', orgId), {
      plan: planCode,
    });

    const logId = generateSafeId('log');
    batch.set(doc(db, 'organizations', orgId, 'auditLogs', logId), {
      id: logId,
      orgId,
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: 'PLAN_UPDATED',
      entityType: 'subscription',
      entityId: orgId,
      summary: `Activation du plan ${planCode.toUpperCase()} (${billingCycle === 'annual' ? 'Annuel' : 'Mensuel'} · ${mode === 'stripe' ? 'Stripe Checkout' : mode === 'free' ? 'Gratuit' : 'Mode Démo SaaS'})`,
      memberUids,
      createdAt: serverTimestamp(),
    });

    const notifId = generateSafeId('notif');
    batch.set(doc(db, 'organizations', orgId, 'notifications', notifId), {
      id: notifId,
      orgId,
      title: `Plan ${planCode.toUpperCase()} activé`,
      message: `Les quotas de votre organisation ont été mis à jour (${billingCycle === 'annual' ? 'facturation annuelle' : 'facturation mensuelle'}).`,
      severity: 'success',
      isRead: false,
      link: '/parametres?tab=plans',
      memberUids,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function addOrganizationMember(params: {
  org: Organization;
  input: AddOrganizationMemberInput;
  actor: { uid: string; email: string };
}): Promise<void> {
  const { org, input, actor } = params;
  const path = `organizations/${org.id}/members/${input.uid}`;
  if (org.memberUids.includes(input.uid)) {
    throw new Error('Cet utilisateur fait déjà partie de l’organisation.');
  }
  const nextMemberUids = Array.from(new Set([...org.memberUids, input.uid]));
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'organizations', org.id, 'members', input.uid), {
      uid: input.uid,
      orgId: org.id,
      orgOwnerId: org.ownerId,
      email: input.email.trim(),
      displayName: input.displayName.trim(),
      role: input.role,
      status: 'invited',
      memberUids: nextMemberUids,
      joinedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'organizations', org.id), {
      memberUids: nextMemberUids,
      updatedAt: serverTimestamp(),
    });

    const logId = generateSafeId('log');
    batch.set(doc(db, 'organizations', org.id, 'auditLogs', logId), {
      id: logId,
      orgId: org.id,
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: 'MEMBER_INVITED',
      entityType: 'member',
      entityId: input.uid,
      summary: `Invitation de ${input.displayName} (${input.email}) avec le rôle ${input.role}`,
      memberUids: nextMemberUids,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function joinOrganizationWithInvitation(user: User, orgId: string): Promise<void> {
  const cleanOrgId = orgId.trim();
  if (!cleanOrgId) throw new Error('Identifiant organisation requis.');
  const memberRef = doc(db, 'organizations', cleanOrgId, 'members', user.uid);
  const memberSnap = await getDoc(memberRef);
  if (!memberSnap.exists()) {
    throw new Error(
      'Aucune invitation trouvée pour votre UID Firebase dans cette organisation. Demandez à un administrateur de vous inviter.'
    );
  }
  const memberData = memberSnap.data() as OrganizationMember;
  if (memberData.status === 'suspended') {
    throw new Error('Votre accès à cette organisation est suspendu.');
  }

  if (memberData.status === 'invited') {
    const displayName = (user.displayName || memberData.displayName || 'Collaborateur').slice(0, 120);
    await updateDoc(memberRef, {
      status: 'active',
      displayName,
    });
  }

  const orgSnap = await getDoc(doc(db, 'organizations', cleanOrgId));
  if (!orgSnap.exists()) {
    throw new Error('Organisation introuvable.');
  }
  const org = orgSnap.data() as Organization;

  const batch = writeBatch(db);
  batch.set(doc(db, 'users', user.uid, 'memberships', cleanOrgId), {
    orgId: cleanOrgId,
    orgName: org.name,
    orgSlug: org.slug,
    role: memberData.role,
    plan: org.plan,
    currency: org.currency,
    joinedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'users', user.uid), {
    activeOrgId: cleanOrgId,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function updateOrganizationMemberRole(params: {
  org: Organization;
  targetMember: OrganizationMember;
  role: Exclude<OrgRole, 'owner'>;
  status: MemberStatus;
  actor: { uid: string; email: string };
}): Promise<void> {
  const { org, targetMember, role, status, actor } = params;
  if (targetMember.role === 'owner') {
    throw new Error('Le rôle du propriétaire fondateur ne peut pas être modifié.');
  }
  const path = `organizations/${org.id}/members/${targetMember.uid}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'organizations', org.id, 'members', targetMember.uid), {
      role,
      status,
    });
    const logId = generateSafeId('log');
    batch.set(doc(db, 'organizations', org.id, 'auditLogs', logId), {
      id: logId,
      orgId: org.id,
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: 'MEMBER_ROLE_UPDATED',
      entityType: 'member',
      entityId: targetMember.uid,
      summary: `Modification accès de ${targetMember.displayName} : rôle=${role}, statut=${status}`,
      memberUids: org.memberUids,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function removeOrganizationMember(params: {
  org: Organization;
  targetMember: OrganizationMember;
  actor: { uid: string; email: string };
}): Promise<void> {
  const { org, targetMember, actor } = params;
  if (targetMember.role === 'owner') {
    throw new Error('Le propriétaire de l’organisation ne peut pas être retiré.');
  }
  const path = `organizations/${org.id}/members/${targetMember.uid}`;
  const nextMemberUids = org.memberUids.filter((id) => id !== targetMember.uid);
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'organizations', org.id, 'members', targetMember.uid));
    batch.update(doc(db, 'organizations', org.id), {
      memberUids: nextMemberUids.length > 0 ? nextMemberUids : [org.ownerId],
      updatedAt: serverTimestamp(),
    });
    const logId = generateSafeId('log');
    batch.set(doc(db, 'organizations', org.id, 'auditLogs', logId), {
      id: logId,
      orgId: org.id,
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: 'MEMBER_REMOVED',
      entityType: 'member',
      entityId: targetMember.uid,
      summary: `Révocation de l’accès de ${targetMember.displayName} (${targetMember.email})`,
      memberUids: nextMemberUids.length > 0 ? nextMemberUids : [org.ownerId],
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

