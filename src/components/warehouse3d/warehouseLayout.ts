import type {
  LocationZoneType,
  Product,
  StockBalance,
  Warehouse,
  WarehouseLocation,
} from '../../shared/types.ts';

export type ColorMode3D = 'occupancy' | 'zone' | 'alerts';
export type CameraPreset3D = 'iso' | 'top' | 'aisle' | 'docks';

export interface BalanceWithProduct {
  balance: StockBalance;
  product?: Product;
  isLowStock: boolean;
  isOutOfStock: boolean;
}

export interface LocationNode3D {
  location: WarehouseLocation;
  aisleKey: string;
  rackIndex: number;
  levelIndex: number;
  worldX: number;
  baseY: number;
  worldZ: number;
  shelfWidth: number;
  shelfDepth: number;
  levelHeight: number;
  physicalQty: number;
  reservedQty: number;
  availableQty: number;
  totalValue: number;
  occupancyRatio: number;
  hasAlert: boolean;
  items: BalanceWithProduct[];
}

export interface RackBay3D {
  id: string;
  aisleKey: string;
  rackKey: string;
  worldX: number;
  worldZ: number;
  width: number;
  depth: number;
  levelsCount: number;
  levelHeight: number;
  zoneType: LocationZoneType;
  slots: LocationNode3D[];
}

export interface WarehouseScenePlan {
  warehouse: Warehouse;
  racks: RackBay3D[];
  floorZones: LocationNode3D[];
  allNodes: LocationNode3D[];
  bounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    width: number;
    depth: number;
    centerX: number;
    centerZ: number;
  };
  aisleCenterZ: number[];
}

function parseNumericOrder(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const digits = value.replace(/[^0-9]/g, '');
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function buildWarehouseScenePlan(params: {
  warehouse: Warehouse;
  locations: WarehouseLocation[];
  balances: StockBalance[];
  products: Product[];
}): WarehouseScenePlan {
  const { warehouse, locations, balances, products } = params;
  const whLocations = locations.filter((l) => l.warehouseId === warehouse.id);
  const whBalances = balances.filter((b) => b.warehouseId === warehouse.id);
  const productMap = new Map(products.map((p) => [p.id, p]));

  // Aggregate product totals across this warehouse for low-stock / out-of-stock alerts
  const productAvailableMap = new Map<string, number>();
  for (const b of whBalances) {
    productAvailableMap.set(
      b.productId,
      (productAvailableMap.get(b.productId) ?? 0) + b.availableQty
    );
  }

  const balancesByLoc = new Map<string, BalanceWithProduct[]>();
  for (const b of whBalances) {
    if (b.physicalQty <= 0 && b.reservedQty <= 0) continue;
    const prod = productMap.get(b.productId);
    const whAvail = productAvailableMap.get(b.productId) ?? 0;
    const isOutOfStock = prod ? whAvail <= 0 : false;
    const isLowStock = prod ? whAvail > 0 && whAvail <= prod.minStock : false;
    const list = balancesByLoc.get(b.locationId) ?? [];
    list.push({ balance: b, product: prod, isLowStock, isOutOfStock });
    balancesByLoc.set(b.locationId, list);
  }

  const shelfWidth = 2.8;
  const shelfDepth = 1.6;
  const levelHeight = 1.55;
  const rackGapX = 0.22;
  const aislePitchZ = 5.4; // Rack + wide forklift aisle

  const rackLocs = whLocations.filter(
    (l) => l.zoneType === 'storage' || l.zoneType === 'picking'
  );
  const dockLocs = whLocations.filter(
    (l) => l.zoneType === 'receiving' || l.zoneType === 'shipping'
  );

  // Group rack locations by aisle -> rack
  const aisleGroups = new Map<string, Map<string, WarehouseLocation[]>>();
  for (const loc of rackLocs) {
    const aisleKey = (loc.aisle || loc.code.split('-')[0] || 'A').toUpperCase();
    const rackKey = (loc.rack || '01').toUpperCase();
    let racksMap = aisleGroups.get(aisleKey);
    if (!racksMap) {
      racksMap = new Map();
      aisleGroups.set(aisleKey, racksMap);
    }
    const list = racksMap.get(rackKey) ?? [];
    list.push(loc);
    racksMap.set(rackKey, list);
  }

  const sortedAisles = Array.from(aisleGroups.keys()).sort((a, b) => a.localeCompare(b));
  const racks: RackBay3D[] = [];
  const allNodes: LocationNode3D[] = [];
  const aisleCenterZ: number[] = [];

  const totalAisles = Math.max(1, sortedAisles.length);
  const startZ = -((totalAisles - 1) * aislePitchZ) / 2;

  sortedAisles.forEach((aisleKey, aisleIdx) => {
    const racksMap = aisleGroups.get(aisleKey)!;
    const sortedRackKeys = Array.from(racksMap.keys()).sort(
      (a, b) => parseNumericOrder(a, 0) - parseNumericOrder(b, 0) || a.localeCompare(b)
    );
    const z = startZ + aisleIdx * aislePitchZ;
    aisleCenterZ.push(z + aislePitchZ * 0.5);

    const totalBayWidth = sortedRackKeys.length * (shelfWidth + rackGapX) - rackGapX;
    const startX = -totalBayWidth / 2 + shelfWidth / 2;

    sortedRackKeys.forEach((rackKey, rIdx) => {
      const locsInRack = racksMap.get(rackKey)!.slice().sort((a, b) => {
        const la = parseNumericOrder(a.level, 1);
        const lb = parseNumericOrder(b.level, 1);
        return la - lb || a.code.localeCompare(b.code);
      });

      const x = startX + rIdx * (shelfWidth + rackGapX);
      const maxLevelIndex = Math.max(2, locsInRack.length);
      const rackSlots: LocationNode3D[] = [];

      locsInRack.forEach((loc, idx) => {
        const parsedLvl = parseNumericOrder(loc.level, idx + 1);
        const levelIndex = Math.max(0, parsedLvl > 0 ? parsedLvl - 1 : idx);
        const items = balancesByLoc.get(loc.id) ?? [];
        const physicalQty = items.reduce((acc, it) => acc + it.balance.physicalQty, 0);
        const reservedQty = items.reduce((acc, it) => acc + it.balance.reservedQty, 0);
        const availableQty = items.reduce((acc, it) => acc + it.balance.availableQty, 0);
        const totalValue = items.reduce(
          (acc, it) => acc + it.balance.physicalQty * it.balance.unitCost,
          0
        );
        const occupancyRatio = loc.capacity > 0 ? Math.min(1.2, physicalQty / loc.capacity) : 0;
        const hasAlert = items.some((it) => it.isLowStock || it.isOutOfStock);

        const node: LocationNode3D = {
          location: loc,
          aisleKey,
          rackIndex: rIdx,
          levelIndex,
          worldX: x,
          baseY: 0.18 + levelIndex * levelHeight,
          worldZ: z,
          shelfWidth,
          shelfDepth,
          levelHeight,
          physicalQty,
          reservedQty,
          availableQty,
          totalValue,
          occupancyRatio,
          hasAlert,
          items,
        };
        rackSlots.push(node);
        allNodes.push(node);
      });

      const actualLevels = Math.max(
        maxLevelIndex,
        ...rackSlots.map((s) => s.levelIndex + 1),
        2
      );

      racks.push({
        id: `rack_${aisleKey}_${rackKey}`,
        aisleKey,
        rackKey,
        worldX: x,
        worldZ: z,
        width: shelfWidth,
        depth: shelfDepth,
        levelsCount: actualLevels,
        levelHeight,
        zoneType: locsInRack[0]?.zoneType ?? 'storage',
        slots: rackSlots,
      });
    });
  });

  // Position floor staging zones (receiving / shipping) along the southern apron
  const floorZones: LocationNode3D[] = [];
  const dockZ = startZ + totalAisles * aislePitchZ + 1.8;
  const dockSpacingX = 4.2;
  const dockStartX = -((Math.max(1, dockLocs.length) - 1) * dockSpacingX) / 2;

  dockLocs.forEach((loc, idx) => {
    const x = dockStartX + idx * dockSpacingX;
    const items = balancesByLoc.get(loc.id) ?? [];
    const physicalQty = items.reduce((acc, it) => acc + it.balance.physicalQty, 0);
    const reservedQty = items.reduce((acc, it) => acc + it.balance.reservedQty, 0);
    const availableQty = items.reduce((acc, it) => acc + it.balance.availableQty, 0);
    const totalValue = items.reduce(
      (acc, it) => acc + it.balance.physicalQty * it.balance.unitCost,
      0
    );
    const occupancyRatio = loc.capacity > 0 ? Math.min(1.2, physicalQty / loc.capacity) : 0;
    const hasAlert = items.some((it) => it.isLowStock || it.isOutOfStock);

    const node: LocationNode3D = {
      location: loc,
      aisleKey: loc.zoneType === 'receiving' ? 'REC' : 'EXP',
      rackIndex: idx,
      levelIndex: 0,
      worldX: x,
      baseY: 0.04,
      worldZ: dockZ,
      shelfWidth: 3.1,
      shelfDepth: 2.3,
      levelHeight: 1.4,
      physicalQty,
      reservedQty,
      availableQty,
      totalValue,
      occupancyRatio,
      hasAlert,
      items,
    };
    floorZones.push(node);
    allNodes.push(node);
  });

  // Compute overall warehouse floor footprint with generous aisle clearance
  const xs = allNodes.map((n) => n.worldX);
  const zs = allNodes.map((n) => n.worldZ);
  const rawMinX = xs.length ? Math.min(...xs) : -6;
  const rawMaxX = xs.length ? Math.max(...xs) : 6;
  const rawMinZ = zs.length ? Math.min(...zs) : -6;
  const rawMaxZ = zs.length ? Math.max(...zs) : 6;

  const padX = 5.5;
  const padZ = 5.0;
  const minX = Math.min(-10, rawMinX - padX);
  const maxX = Math.max(10, rawMaxX + padX);
  const minZ = Math.min(-9, rawMinZ - padZ);
  const maxZ = Math.max(9, rawMaxZ + padZ);

  return {
    warehouse,
    racks,
    floorZones,
    allNodes,
    bounds: {
      minX,
      maxX,
      minZ,
      maxZ,
      width: maxX - minX,
      depth: maxZ - minZ,
      centerX: (minX + maxX) / 2,
      centerZ: (minZ + maxZ) / 2,
    },
    aisleCenterZ: aisleCenterZ.length > 0 ? aisleCenterZ : [0],
  };
}

export function getLocationSemanticColor(
  node: LocationNode3D,
  mode: ColorMode3D
): number {
  if (node.location.status === 'blocked') {
    return 0x475569; // Blocked slate
  }

  if (mode === 'zone') {
    switch (node.location.zoneType) {
      case 'storage':
        return 0x2563eb;
      case 'picking':
        return 0x0ea5e9;
      case 'receiving':
        return 0x10b981;
      case 'shipping':
        return 0xf59e0b;
    }
  }

  if (mode === 'alerts') {
    if (node.hasAlert) return 0xdc2626;
    if (node.reservedQty > 0) return 0xf59e0b;
    if (node.physicalQty > 0) return 0x10b981;
    return 0x64748b;
  }

  // Default: occupancy
  if (node.physicalQty <= 0) return 0x64748b;
  if (node.occupancyRatio >= 0.9) return 0xdc2626;
  if (node.occupancyRatio >= 0.7) return 0xf59e0b;
  return 0x10b981;
}
