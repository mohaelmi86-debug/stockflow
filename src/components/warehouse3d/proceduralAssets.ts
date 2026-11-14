import * as THREE from 'three';
import {
  getLocationSemanticColor,
  type ColorMode3D,
  type LocationNode3D,
  type RackBay3D,
  type WarehouseScenePlan,
} from './warehouseLayout.ts';

export interface ProceduralTextureSet {
  concreteMap: THREE.CanvasTexture;
  hazardMap: THREE.CanvasTexture;
  cardboardMap: THREE.CanvasTexture;
  woodPalletMap: THREE.CanvasTexture;
  dispose: () => void;
}

export function createProceduralTextures(maxAnisotropy: number): ProceduralTextureSet {
  // 1. Industrial polished concrete slab with subtle expansion joints
  const concCanvas = document.createElement('canvas');
  concCanvas.width = 512;
  concCanvas.height = 512;
  const cCtx = concCanvas.getContext('2d')!;
  cCtx.fillStyle = '#cbd5e1';
  cCtx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4200; i++) {
    const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const y = (Math.sin(i * 78.233) * 43758.5453) % 1;
    const px = Math.abs(x) * 512;
    const py = Math.abs(y) * 512;
    cCtx.fillStyle = i % 2 === 0 ? 'rgba(15,23,42,0.04)' : 'rgba(255,255,255,0.06)';
    cCtx.fillRect(px, py, 2, 2);
  }
  cCtx.strokeStyle = 'rgba(100,116,139,0.28)';
  cCtx.lineWidth = 2;
  cCtx.strokeRect(1, 1, 510, 510);
  cCtx.beginPath();
  cCtx.moveTo(256, 0);
  cCtx.lineTo(256, 512);
  cCtx.moveTo(0, 256);
  cCtx.lineTo(512, 256);
  cCtx.strokeStyle = 'rgba(100,116,139,0.14)';
  cCtx.stroke();

  const concreteMap = new THREE.CanvasTexture(concCanvas);
  concreteMap.colorSpace = THREE.SRGBColorSpace;
  concreteMap.wrapS = THREE.RepeatWrapping;
  concreteMap.wrapT = THREE.RepeatWrapping;
  concreteMap.repeat.set(14, 14);
  concreteMap.anisotropy = maxAnisotropy;

  // 2. Safety hazard striping for staging docks
  const hazCanvas = document.createElement('canvas');
  hazCanvas.width = 256;
  hazCanvas.height = 256;
  const hCtx = hazCanvas.getContext('2d')!;
  hCtx.fillStyle = '#eab308';
  hCtx.fillRect(0, 0, 256, 256);
  hCtx.fillStyle = '#1e293b';
  for (let i = -256; i < 512; i += 48) {
    hCtx.beginPath();
    hCtx.moveTo(i, 0);
    hCtx.lineTo(i + 24, 0);
    hCtx.lineTo(i + 280, 256);
    hCtx.lineTo(i + 256, 256);
    hCtx.closePath();
    hCtx.fill();
  }
  const hazardMap = new THREE.CanvasTexture(hazCanvas);
  hazardMap.colorSpace = THREE.SRGBColorSpace;
  hazardMap.wrapS = THREE.RepeatWrapping;
  hazardMap.wrapT = THREE.RepeatWrapping;
  hazardMap.anisotropy = maxAnisotropy;

  // 3. Corrugated cardboard crate finish
  const boxCanvas = document.createElement('canvas');
  boxCanvas.width = 256;
  boxCanvas.height = 256;
  const bCtx = boxCanvas.getContext('2d')!;
  bCtx.fillStyle = '#c9a679';
  bCtx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 4) {
    bCtx.fillStyle = y % 8 === 0 ? 'rgba(120, 82, 40, 0.08)' : 'rgba(255, 255, 255, 0.05)';
    bCtx.fillRect(0, y, 256, 2);
  }
  bCtx.fillStyle = 'rgba(226, 200, 155, 0.85)';
  bCtx.fillRect(0, 118, 256, 20);
  bCtx.fillStyle = '#f8fafc';
  bCtx.fillRect(24, 24, 72, 46);
  bCtx.fillStyle = '#0f172a';
  for (let x = 32; x < 86; x += 6) {
    bCtx.fillRect(x, 48, (x % 4) + 2, 16);
  }
  const cardboardMap = new THREE.CanvasTexture(boxCanvas);
  cardboardMap.colorSpace = THREE.SRGBColorSpace;
  cardboardMap.anisotropy = maxAnisotropy;

  // 4. Euro-pallet timber planks
  const woodCanvas = document.createElement('canvas');
  woodCanvas.width = 256;
  woodCanvas.height = 256;
  const wCtx = woodCanvas.getContext('2d')!;
  wCtx.fillStyle = '#a17a4d';
  wCtx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 6) {
    wCtx.fillStyle = y % 12 === 0 ? 'rgba(69, 44, 18, 0.18)' : 'rgba(255, 245, 225, 0.06)';
    wCtx.fillRect(0, y, 256, 3);
  }
  const woodPalletMap = new THREE.CanvasTexture(woodCanvas);
  woodPalletMap.colorSpace = THREE.SRGBColorSpace;
  woodPalletMap.anisotropy = maxAnisotropy;

  return {
    concreteMap,
    hazardMap,
    cardboardMap,
    woodPalletMap,
    dispose: () => {
      concreteMap.dispose();
      hazardMap.dispose();
      cardboardMap.dispose();
      woodPalletMap.dispose();
    },
  };
}

export interface SlotVisualRef {
  node: LocationNode3D;
  cargoGroup: THREE.Group;
  hitMesh: THREE.Mesh;
  statusBarMat: THREE.MeshStandardMaterial;
  baseY: number;
}

export interface ShelfLevelVisualRef {
  levelIndex: number;
  baseY: number;
  group: THREE.Group;
}

export interface BuiltWarehouseScene {
  root: THREE.Group;
  slotRefs: SlotVisualRef[];
  shelfRefs: ShelfLevelVisualRef[];
  forkliftGroup: THREE.Group;
  forkliftZ: number;
  dispose: () => void;
}

export function buildWarehouse3DAssembly(
  plan: WarehouseScenePlan,
  textures: ProceduralTextureSet,
  colorMode: ColorMode3D,
  isDarkTheme: boolean
): BuiltWarehouseScene {
  const root = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];
  const slotRefs: SlotVisualRef[] = [];
  const shelfRefs: ShelfLevelVisualRef[] = [];

  // Shared PBR materials with calibrated roughness/metalness contrast
  const floorMat = new THREE.MeshStandardMaterial({
    map: textures.concreteMap,
    color: isDarkTheme ? 0x64748b : 0xe2e8f0,
    roughness: 0.78,
    metalness: 0.08,
  });
  const wallMat = new THREE.MeshStandardMaterial({
    color: isDarkTheme ? 0x1e293b : 0xf1f5f9,
    roughness: 0.85,
    metalness: 0.05,
  });
  const steelMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.34,
    metalness: 0.78,
  });
  const galvanizedMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.28,
    metalness: 0.85,
  });
  const beamMat = new THREE.MeshStandardMaterial({
    color: 0xea580c, // Industrial safety orange load beams
    roughness: 0.45,
    metalness: 0.25,
  });
  const deckMeshMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    roughness: 0.52,
    metalness: 0.55,
  });
  const woodMat = new THREE.MeshStandardMaterial({
    map: textures.woodPalletMap,
    roughness: 0.88,
    metalness: 0.0,
  });
  const boxMat = new THREE.MeshStandardMaterial({
    map: textures.cardboardMap,
    roughness: 0.68,
    metalness: 0.02,
  });
  const lanePaintMat = new THREE.MeshStandardMaterial({
    color: 0xfacc15,
    roughness: 0.55,
    metalness: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const hazardApronMat = new THREE.MeshStandardMaterial({
    map: textures.hazardMap,
    roughness: 0.6,
    metalness: 0.08,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const hitProxyMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });

  disposables.push(
    floorMat,
    wallMat,
    steelMat,
    galvanizedMat,
    beamMat,
    deckMeshMat,
    woodMat,
    boxMat,
    lanePaintMat,
    hazardApronMat,
    hitProxyMat
  );

  // 1. Ground slab + industrial perimeter walls (back + left/right cutaway for clear viewing)
  const { width, depth, centerX, centerZ, minX, maxX, minZ, maxZ } = plan.bounds;
  const floorGeo = new THREE.BoxGeometry(width, 0.24, depth);
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.position.set(centerX, -0.12, centerZ);
  floorMesh.receiveShadow = true;
  root.add(floorMesh);
  disposables.push(floorGeo);

  // Back architectural wall + structural steel I-columns
  const wallHeight = 6.2;
  const backWallGeo = new THREE.BoxGeometry(width, wallHeight, 0.3);
  const backWall = new THREE.Mesh(backWallGeo, wallMat);
  backWall.position.set(centerX, wallHeight / 2, minZ + 0.15);
  backWall.receiveShadow = true;
  root.add(backWall);
  disposables.push(backWallGeo);

  const colGeo = new THREE.BoxGeometry(0.32, wallHeight + 0.2, 0.32);
  disposables.push(colGeo);
  for (let cx = minX + 1; cx <= maxX - 1; cx += 6.5) {
    const col = new THREE.Mesh(colGeo, steelMat);
    col.position.set(cx, (wallHeight + 0.2) / 2, minZ + 0.35);
    col.castShadow = true;
    root.add(col);
  }

  // Overhead LED light strips along ceiling trusses
  const fixtureHousingGeo = new THREE.BoxGeometry(2.6, 0.1, 0.32);
  const fixtureGlowGeo = new THREE.BoxGeometry(2.4, 0.04, 0.22);
  const fixtureGlowMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xe0f2fe,
    emissiveIntensity: 0.9,
    roughness: 0.2,
  });
  disposables.push(fixtureHousingGeo, fixtureGlowGeo, fixtureGlowMat);
  for (const az of plan.aisleCenterZ) {
    for (let fx = minX + 4; fx <= maxX - 4; fx += 7) {
      const fGroup = new THREE.Group();
      const housing = new THREE.Mesh(fixtureHousingGeo, steelMat);
      const glow = new THREE.Mesh(fixtureGlowGeo, fixtureGlowMat);
      glow.position.y = -0.05;
      fGroup.add(housing, glow);
      fGroup.position.set(fx, wallHeight - 0.3, az);
      root.add(fGroup);
    }
  }

  // Yellow safety lane markings along aisles
  const laneGeo = new THREE.PlaneGeometry(width - 2.4, 0.12);
  disposables.push(laneGeo);
  for (const az of plan.aisleCenterZ) {
    const lineA = new THREE.Mesh(laneGeo, lanePaintMat);
    lineA.rotation.x = -Math.PI / 2;
    lineA.position.set(centerX, 0.015, az - 1.35);
    const lineB = new THREE.Mesh(laneGeo, lanePaintMat);
    lineB.rotation.x = -Math.PI / 2;
    lineB.position.set(centerX, 0.015, az + 1.35);
    root.add(lineA, lineB);
  }

  // 2. Reusable geometries for Composite Racks & Pallets
  const uprightGeo = new THREE.BoxGeometry(0.11, 1, 0.11);
  const footplateGeo = new THREE.BoxGeometry(0.22, 0.05, 0.22);
  const braceGeo = new THREE.BoxGeometry(0.06, 0.06, 1.38);
  const beamGeo = new THREE.BoxGeometry(1, 0.11, 0.08);
  const deckGeo = new THREE.BoxGeometry(1, 0.04, 1);

  const skidGeo = new THREE.BoxGeometry(1.16, 0.09, 0.12);
  const deckPlankGeo = new THREE.BoxGeometry(1.16, 0.035, 0.96);
  const cartonGeo = new THREE.BoxGeometry(0.48, 0.44, 0.42);
  const statusBezelGeo = new THREE.BoxGeometry(1.18, 0.09, 0.07);
  const hitBoxGeo = new THREE.BoxGeometry(1, 1, 1);
  disposables.push(
    uprightGeo,
    footplateGeo,
    braceGeo,
    beamGeo,
    deckGeo,
    skidGeo,
    deckPlankGeo,
    cartonGeo,
    statusBezelGeo,
    hitBoxGeo
  );

  const buildCargoGroup = (node: LocationNode3D): { group: THREE.Group; statusMat: THREE.MeshStandardMaterial } => {
    const group = new THREE.Group();
    const semanticHex = getLocationSemanticColor(node, colorMode);
    const statusMat = new THREE.MeshStandardMaterial({
      color: semanticHex,
      emissive: semanticHex,
      emissiveIntensity: 0.22,
      roughness: 0.35,
      metalness: 0.2,
    });
    disposables.push(statusMat);

    // Front status indicator bar on shelf edge / floor bay
    const statusBar = new THREE.Mesh(statusBezelGeo, statusMat);
    statusBar.position.set(0, 0.05, node.shelfDepth * 0.48);
    statusBar.scale.x = node.location.zoneType === 'receiving' || node.location.zoneType === 'shipping' ? 2.2 : 1.9;
    group.add(statusBar);

    if (node.physicalQty <= 0 && node.location.status !== 'blocked') {
      return { group, statusMat };
    }

    // Build 1 or 2 Euro-pallets loaded proportionally to occupancyRatio
    const palletOffsets = node.occupancyRatio > 0.45 ? [-0.66, 0.66] : [0];
    const stackLevels = node.occupancyRatio > 0.72 ? 2 : 1;

    for (const px of palletOffsets) {
      const palletGroup = new THREE.Group();
      palletGroup.position.set(px, 0, 0);

      // 3 timber skids grounded at y=0
      for (const sz of [-0.38, 0, 0.38]) {
        const skid = new THREE.Mesh(skidGeo, woodMat);
        skid.position.set(0, 0.045, sz);
        skid.castShadow = true;
        skid.receiveShadow = true;
        palletGroup.add(skid);
      }
      // Pallet top deck
      const deck = new THREE.Mesh(deckPlankGeo, woodMat);
      deck.position.set(0, 0.108, 0);
      deck.castShadow = true;
      deck.receiveShadow = true;
      palletGroup.add(deck);

      // Stacked cardboard cartons on pallet
      for (let lvl = 0; lvl < stackLevels; lvl++) {
        for (const cx of [-0.27, 0.27]) {
          for (const cz of [-0.23, 0.23]) {
            const box = new THREE.Mesh(cartonGeo, boxMat);
            box.position.set(cx, 0.125 + 0.22 + lvl * 0.445, cz);
            box.rotation.y = ((cx * 7 + lvl * 3) % 5) * 0.015;
            box.castShadow = true;
            box.receiveShadow = true;
            palletGroup.add(box);
          }
        }
      }
      group.add(palletGroup);
    }

    return { group, statusMat };
  };

  // 3. Build Rack Bays (multi-part uprights, braces, shelf beams, decks, cargo)
  const rackMap = new Map<string, RackBay3D>();
  for (const rack of plan.racks) {
    rackMap.set(rack.id, rack);
    const rackGroup = new THREE.Group();
    rackGroup.position.set(rack.worldX, 0, rack.worldZ);
    const totalHeight = rack.levelsCount * rack.levelHeight + 0.55;
    const halfW = rack.width / 2 - 0.06;
    const halfD = rack.depth / 2 - 0.06;

    // 4 vertical uprights + steel footplates grounded flush at Y=0
    for (const ux of [-halfW, halfW]) {
      for (const uz of [-halfD, halfD]) {
        const post = new THREE.Mesh(uprightGeo, steelMat);
        post.scale.y = totalHeight;
        post.position.set(ux, totalHeight / 2, uz);
        post.castShadow = true;
        post.receiveShadow = true;
        rackGroup.add(post);

        const foot = new THREE.Mesh(footplateGeo, galvanizedMat);
        foot.position.set(ux, 0.025, uz);
        foot.receiveShadow = true;
        rackGroup.add(foot);
      }
      // Side cross-bracing per level
      for (let lvl = 0; lvl < rack.levelsCount; lvl++) {
        const brace = new THREE.Mesh(braceGeo, galvanizedMat);
        brace.position.set(ux, 0.8 + lvl * rack.levelHeight, 0);
        brace.rotation.x = lvl % 2 === 0 ? 0.42 : -0.42;
        rackGroup.add(brace);
      }
    }

    // Shelf levels (beams + wire decking + attached cargo slots)
    for (let lvl = 0; lvl < rack.levelsCount; lvl++) {
      const levelY = 0.12 + lvl * rack.levelHeight;
      const lvlGroup = new THREE.Group();
      lvlGroup.position.set(0, levelY, 0);

      const frontBeam = new THREE.Mesh(beamGeo, beamMat);
      frontBeam.scale.x = rack.width - 0.08;
      frontBeam.position.set(0, 0, halfD);
      frontBeam.castShadow = true;

      const backBeam = new THREE.Mesh(beamGeo, beamMat);
      backBeam.scale.x = rack.width - 0.08;
      backBeam.position.set(0, 0, -halfD);
      backBeam.castShadow = true;

      const wireDeck = new THREE.Mesh(deckGeo, deckMeshMat);
      wireDeck.scale.set(rack.width - 0.14, 1, rack.depth - 0.14);
      wireDeck.position.set(0, 0.04, 0);
      wireDeck.receiveShadow = true;

      lvlGroup.add(frontBeam, backBeam, wireDeck);

      // Attach any Firestore location mapped to this level
      const slot = rack.slots.find((s) => s.levelIndex === lvl);
      if (slot) {
        const { group: cargoGroup, statusMat } = buildCargoGroup(slot);
        cargoGroup.position.set(0, 0.06, 0);
        lvlGroup.add(cargoGroup);

        const hitMesh = new THREE.Mesh(hitBoxGeo, hitProxyMat);
        hitMesh.scale.set(rack.width - 0.1, rack.levelHeight - 0.12, rack.depth + 0.15);
        hitMesh.position.set(0, rack.levelHeight * 0.46, 0);
        hitMesh.userData.locationId = slot.location.id;
        lvlGroup.add(hitMesh);

        slotRefs.push({
          node: slot,
          cargoGroup,
          hitMesh,
          statusBarMat: statusMat,
          baseY: levelY,
        });
      }

      rackGroup.add(lvlGroup);
      shelfRefs.push({
        levelIndex: lvl,
        baseY: levelY,
        group: lvlGroup,
      });
    }

    root.add(rackGroup);
  }

  // 4. Build Floor Staging Zones (Receiving / Shipping Docks)
  const dockPadGeo = new THREE.BoxGeometry(3.2, 0.03, 2.4);
  const dockBorderGeo = new THREE.BoxGeometry(3.4, 0.02, 2.6);
  const dockDoorFrameGeo = new THREE.BoxGeometry(2.6, 3.2, 0.18);
  const dockDoorPanelGeo = new THREE.BoxGeometry(2.35, 2.95, 0.1);
  disposables.push(dockPadGeo, dockBorderGeo, dockDoorFrameGeo, dockDoorPanelGeo);

  for (const floorNode of plan.floorZones) {
    const zGroup = new THREE.Group();
    zGroup.position.set(floorNode.worldX, 0, floorNode.worldZ);

    const hazardBase = new THREE.Mesh(dockBorderGeo, hazardApronMat);
    hazardBase.position.y = 0.012;
    hazardBase.receiveShadow = true;

    const innerPad = new THREE.Mesh(dockPadGeo, floorMat);
    innerPad.position.y = 0.022;
    innerPad.receiveShadow = true;

    // Dock bay steel arch / roll-up shutter at the outer edge
    const shutterFrame = new THREE.Mesh(dockDoorFrameGeo, steelMat);
    shutterFrame.position.set(0, 1.6, 1.55);
    shutterFrame.castShadow = true;
    const shutterPanel = new THREE.Mesh(dockDoorPanelGeo, galvanizedMat);
    shutterPanel.position.set(0, 1.55, 1.58);

    const { group: cargoGroup, statusMat } = buildCargoGroup(floorNode);
    cargoGroup.position.set(0, 0.04, 0);

    const hitMesh = new THREE.Mesh(hitBoxGeo, hitProxyMat);
    hitMesh.scale.set(3.3, 1.8, 2.5);
    hitMesh.position.set(0, 0.9, 0);
    hitMesh.userData.locationId = floorNode.location.id;

    zGroup.add(hazardBase, innerPad, shutterFrame, shutterPanel, cargoGroup, hitMesh);
    root.add(zGroup);

    slotRefs.push({
      node: floorNode,
      cargoGroup,
      hitMesh,
      statusBarMat: statusMat,
      baseY: 0,
    });
  }

  // 5. Composite 9-part Electric Forklift patrolling the main aisle
  const forkliftGroup = new THREE.Group();
  const bodyPaintMat = new THREE.MeshStandardMaterial({
    color: 0x2563eb, // StockFlow Blue chassis
    roughness: 0.35,
    metalness: 0.3,
  });
  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.9,
    metalness: 0.05,
  });
  const chassisGeo = new THREE.BoxGeometry(1.5, 0.56, 0.96);
  const counterWeightGeo = new THREE.BoxGeometry(0.45, 0.78, 0.94);
  const pillarGeo = new THREE.BoxGeometry(0.06, 1.1, 0.06);
  const roofGeo = new THREE.BoxGeometry(1.05, 0.06, 0.9);
  const seatGeo = new THREE.BoxGeometry(0.42, 0.46, 0.42);
  const tireGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.16, 18);
  const hubGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.17, 14);
  const mastGeo = new THREE.BoxGeometry(0.08, 1.95, 0.08);
  const forkGeo = new THREE.BoxGeometry(0.95, 0.04, 0.11);
  disposables.push(
    bodyPaintMat,
    tireMat,
    chassisGeo,
    counterWeightGeo,
    pillarGeo,
    roofGeo,
    seatGeo,
    tireGeo,
    hubGeo,
    mastGeo,
    forkGeo
  );

  const chassis = new THREE.Mesh(chassisGeo, bodyPaintMat);
  chassis.position.set(0, 0.42, 0);
  chassis.castShadow = true;

  const counterweight = new THREE.Mesh(counterWeightGeo, steelMat);
  counterweight.position.set(-0.68, 0.54, 0);
  counterweight.castShadow = true;

  const seat = new THREE.Mesh(seatGeo, tireMat);
  seat.position.set(-0.18, 0.85, 0);

  const roof = new THREE.Mesh(roofGeo, steelMat);
  roof.position.set(-0.1, 1.78, 0);
  roof.castShadow = true;

  forkliftGroup.add(chassis, counterweight, seat, roof);

  for (const px of [-0.55, 0.35]) {
    for (const pz of [-0.4, 0.4]) {
      const pillar = new THREE.Mesh(pillarGeo, steelMat);
      pillar.position.set(px, 1.24, pz);
      forkliftGroup.add(pillar);
    }
  }

  for (const wx of [-0.55, 0.52]) {
    for (const wz of [-0.46, 0.46]) {
      const wheel = new THREE.Mesh(tireGeo, tireMat);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.22, wz);
      wheel.castShadow = true;
      const hub = new THREE.Mesh(hubGeo, galvanizedMat);
      hub.rotation.x = Math.PI / 2;
      hub.position.set(wx, 0.22, wz);
      forkliftGroup.add(wheel, hub);
    }
  }

  for (const mz of [-0.28, 0.28]) {
    const mast = new THREE.Mesh(mastGeo, steelMat);
    mast.position.set(0.8, 1.12, mz);
    mast.castShadow = true;
    const fork = new THREE.Mesh(forkGeo, galvanizedMat);
    fork.position.set(1.28, 0.16, mz * 0.72);
    fork.castShadow = true;
    forkliftGroup.add(mast, fork);
  }

  // Carry a pallet on the forks
  const carriedSkid = new THREE.Mesh(skidGeo, woodMat);
  carriedSkid.scale.set(0.75, 0.8, 0.75);
  carriedSkid.position.set(1.32, 0.22, 0);
  const carriedBox = new THREE.Mesh(cartonGeo, boxMat);
  carriedBox.scale.set(1.1, 1.1, 1.1);
  carriedBox.position.set(1.32, 0.5, 0);
  carriedBox.castShadow = true;
  forkliftGroup.add(carriedSkid, carriedBox);

  const forkliftZ = plan.aisleCenterZ[0] ?? 0;
  forkliftGroup.position.set(centerX - 3, 0, forkliftZ);
  root.add(forkliftGroup);

  return {
    root,
    slotRefs,
    shelfRefs,
    forkliftGroup,
    forkliftZ,
    dispose: () => {
      for (const item of disposables) {
        item.dispose();
      }
    },
  };
}
