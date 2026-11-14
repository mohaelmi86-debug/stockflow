import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  buildWarehouse3DAssembly,
  createProceduralTextures,
  type BuiltWarehouseScene,
  type ProceduralTextureSet,
} from './proceduralAssets.ts';
import {
  getLocationSemanticColor,
  type CameraPreset3D,
  type ColorMode3D,
  type WarehouseScenePlan,
} from './warehouseLayout.ts';

interface Warehouse3DCanvasProps {
  plan: WarehouseScenePlan;
  colorMode: ColorMode3D;
  cameraPreset: CameraPreset3D;
  cameraPresetTrigger: number;
  explodeFactor: number;
  animateForklift: boolean;
  selectedLocationId: string | null;
  focusLocationId: string | null;
  focusTrigger: number;
  isDarkTheme: boolean;
  onSelectLocation: (locationId: string | null) => void;
  onHoverLocation?: (locationId: string | null) => void;
}

const _camGoalPos = new THREE.Vector3();
const _camGoalTarget = new THREE.Vector3();
const _pointerNdc = new THREE.Vector2();
const _raycaster = new THREE.Raycaster();
const _worldPos = new THREE.Vector3();

function detectSoftwareWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return true;
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererName = debugInfo
      ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ?? '')
      : String(gl.getParameter(gl.RENDERER) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(rendererName);
  } catch {
    return true;
  }
}

function computeCameraPresetGoal(
  plan: WarehouseScenePlan,
  preset: CameraPreset3D,
  outPos: THREE.Vector3,
  outTarget: THREE.Vector3
) {
  const { centerX, centerZ, width, depth, minX } = plan.bounds;
  const span = Math.max(width, depth, 18);

  if (preset === 'top') {
    outPos.set(centerX, Math.max(24, span * 1.15), centerZ + 0.01);
    outTarget.set(centerX, 0, centerZ);
    return;
  }

  if (preset === 'aisle') {
    const az = plan.aisleCenterZ[0] ?? centerZ;
    outPos.set(minX + 2.5, 2.35, az);
    outTarget.set(centerX + 4, 1.5, az);
    return;
  }

  if (preset === 'docks') {
    if (plan.floorZones.length > 0) {
      const avgX =
        plan.floorZones.reduce((sum, z) => sum + z.worldX, 0) / plan.floorZones.length;
      const avgZ =
        plan.floorZones.reduce((sum, z) => sum + z.worldZ, 0) / plan.floorZones.length;
      outPos.set(avgX + 6.5, 6.8, avgZ + 9.2);
      outTarget.set(avgX, 0.9, avgZ);
      return;
    }
  }

  // Default isometric overview
  outPos.set(centerX + span * 0.68, Math.max(12, span * 0.56), centerZ + span * 0.74);
  outTarget.set(centerX, 1.35, centerZ);
}

export function Warehouse3DCanvas({
  plan,
  colorMode,
  cameraPreset,
  cameraPresetTrigger,
  explodeFactor,
  animateForklift,
  selectedLocationId,
  focusLocationId,
  focusTrigger,
  isDarkTheme,
  onSelectLocation,
  onHoverLocation,
}: Warehouse3DCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [contextLost, setContextLost] = useState(false);

  // Latest reactive props read inside imperative Three.js handlers
  const propsRef = useRef({
    colorMode,
    explodeFactor,
    animateForklift,
    selectedLocationId,
    onSelectLocation,
    onHoverLocation,
  });
  propsRef.current = {
    colorMode,
    explodeFactor,
    animateForklift,
    selectedLocationId,
    onSelectLocation,
    onHoverLocation,
  };

  const sceneStateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    textures: ProceduralTextureSet;
    assembly: BuiltWarehouseScene | null;
    selectionBox: THREE.LineSegments;
    keyLight: THREE.DirectionalLight;
    hemiLight: THREE.HemisphereLight;
    isSoftwareGl: boolean;
    hoveredId: string | null;
    currentExplode: number;
    cameraAnimating: boolean;
    forkliftPhase: number;
    requestRender: () => void;
    ensureLoopRunning: () => void;
    updateSemanticMaterials: () => void;
    prefersReducedMotion: boolean;
  } | null>(null);

  // 1. Initialize WebGLRenderer, RoomEnvironment, Lighting, Controls & Loop once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: isSoftwareGl ? 'default' : 'high-performance',
      alpha: false,
    });
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth || 800, container.clientHeight || 540);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.cursor = 'grab';

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const bgHex = isDarkTheme ? 0x0b1120 : 0xe2e8f0;
    scene.background = new THREE.Color(bgHex);
    scene.fog = new THREE.FogExp2(bgHex, 0.008);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    pmrem.dispose();

    const aspect = (container.clientWidth || 800) / Math.max(1, container.clientHeight || 540);
    const camera = new THREE.PerspectiveCamera(44, aspect, 0.25, 220);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.minDistance = 4;
    controls.maxDistance = 85;

    // 3-point industrial lighting
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x475569, isDarkTheme ? 0.65 : 0.85);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff5e4, 2.2);
    keyLight.position.set(18, 26, 16);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 85;
    keyLight.shadow.camera.left = -28;
    keyLight.shadow.camera.right = 28;
    keyLight.shadow.camera.top = 28;
    keyLight.shadow.camera.bottom = -28;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);
    scene.add(keyLight.target);

    const rimLight = new THREE.DirectionalLight(0x93c5fd, 0.75);
    rimLight.position.set(-20, 14, -18);
    scene.add(rimLight);

    // Reusable CAD-grade wireframe selection frame
    const boxEdgesGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    const boxEdgesMat = new THREE.LineBasicMaterial({ color: 0x3b82f6 });
    const selectionBox = new THREE.LineSegments(boxEdgesGeo, boxEdgesMat);
    selectionBox.visible = false;
    scene.add(selectionBox);

    const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const textures = createProceduralTextures(maxAnisotropy);

    let rafId = 0;
    let timerId = 0;
    let loopScheduled = false;
    let singleRenderQueued = false;
    let disposed = false;
    let lastTime = performance.now();

    const state = {
      renderer,
      scene,
      camera,
      controls,
      textures,
      assembly: null as BuiltWarehouseScene | null,
      selectionBox,
      keyLight,
      hemiLight,
      isSoftwareGl,
      hoveredId: null as string | null,
      currentExplode: propsRef.current.explodeFactor,
      cameraAnimating: false,
      forkliftPhase: 0,
      prefersReducedMotion,
      requestRender: () => {
        if (disposed || loopScheduled || singleRenderQueued) return;
        singleRenderQueued = true;
        rafId = requestAnimationFrame(() => {
          singleRenderQueued = false;
          if (disposed) return;
          controls.update();
          renderer.render(scene, camera);
        });
      },
      ensureLoopRunning: () => {
        if (disposed || loopScheduled) return;
        loopScheduled = true;
        lastTime = performance.now();
        scheduleNextTick();
      },
      updateSemanticMaterials: () => {
        const asm = state.assembly;
        if (!asm) return;
        const { colorMode: mode, selectedLocationId: selId } = propsRef.current;
        let selectedSlot = null as (typeof asm.slotRefs)[number] | null;

        for (const slot of asm.slotRefs) {
          const locId = slot.node.location.id;
          const baseHex = getLocationSemanticColor(slot.node, mode);
          if (locId === selId) {
            slot.statusBarMat.color.setHex(0xffffff);
            slot.statusBarMat.emissive.setHex(0x3b82f6);
            slot.statusBarMat.emissiveIntensity = 1.25;
            selectedSlot = slot;
          } else if (locId === state.hoveredId) {
            slot.statusBarMat.color.setHex(baseHex);
            slot.statusBarMat.emissive.setHex(baseHex);
            slot.statusBarMat.emissiveIntensity = 0.85;
          } else {
            slot.statusBarMat.color.setHex(baseHex);
            slot.statusBarMat.emissive.setHex(baseHex);
            slot.statusBarMat.emissiveIntensity = 0.22;
          }
        }

        if (selectedSlot) {
          selectedSlot.hitMesh.getWorldPosition(_worldPos);
          selectionBox.position.copy(_worldPos);
          selectionBox.scale.copy(selectedSlot.hitMesh.scale).addScalar(0.12);
          selectionBox.visible = true;
        } else {
          selectionBox.visible = false;
        }
      },
    };
    sceneStateRef.current = state;

    function afterDraw(onReady: () => void) {
      const gl = renderer.getContext();
      if (gl && 'fenceSync' in gl) {
        const gl2 = gl as WebGL2RenderingContext;
        const sync = gl2.fenceSync(gl2.SYNC_GPU_COMMANDS_COMPLETE, 0);
        if (sync) {
          gl2.flush();
          const poll = () => {
            if (disposed) {
              gl2.deleteSync(sync);
              return;
            }
            const res = gl2.clientWaitSync(sync, 0, 0);
            if (res === gl2.TIMEOUT_EXPIRED) {
              rafId = requestAnimationFrame(poll);
            } else {
              gl2.deleteSync(sync);
              timerId = window.setTimeout(onReady, 80);
            }
          };
          rafId = requestAnimationFrame(poll);
          return;
        }
      }
      timerId = window.setTimeout(onReady, 80);
    }

    function scheduleNextTick() {
      if (disposed) return;
      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        rafId = requestAnimationFrame(tick);
      }
    }

    function tick() {
      if (disposed) return;
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      let needsContinue = false;
      const { animateForklift: runForklift, explodeFactor: targetExplode } = propsRef.current;

      // 1. Vertical Explode Damping
      if (Math.abs(state.currentExplode - targetExplode) > 0.001) {
        state.currentExplode = prefersReducedMotion
          ? targetExplode
          : THREE.MathUtils.damp(state.currentExplode, targetExplode, 7, dt);
        if (state.assembly) {
          for (const shelf of state.assembly.shelfRefs) {
            shelf.group.position.y = shelf.baseY + shelf.levelIndex * state.currentExplode * 0.95;
          }
          if (propsRef.current.selectedLocationId) {
            state.updateSemanticMaterials();
          }
        }
        needsContinue = true;
      }

      // 2. Smooth Camera Preset / Focus Transition
      if (state.cameraAnimating) {
        if (prefersReducedMotion) {
          camera.position.copy(_camGoalPos);
          controls.target.copy(_camGoalTarget);
          state.cameraAnimating = false;
        } else {
          const factor = 6.5;
          camera.position.x = THREE.MathUtils.damp(camera.position.x, _camGoalPos.x, factor, dt);
          camera.position.y = THREE.MathUtils.damp(camera.position.y, _camGoalPos.y, factor, dt);
          camera.position.z = THREE.MathUtils.damp(camera.position.z, _camGoalPos.z, factor, dt);
          controls.target.x = THREE.MathUtils.damp(controls.target.x, _camGoalTarget.x, factor, dt);
          controls.target.y = THREE.MathUtils.damp(controls.target.y, _camGoalTarget.y, factor, dt);
          controls.target.z = THREE.MathUtils.damp(controls.target.z, _camGoalTarget.z, factor, dt);
          const dist =
            camera.position.distanceTo(_camGoalPos) + controls.target.distanceTo(_camGoalTarget);
          if (dist < 0.04) {
            camera.position.copy(_camGoalPos);
            controls.target.copy(_camGoalTarget);
            state.cameraAnimating = false;
          } else {
            needsContinue = true;
          }
        }
      }

      // 3. Forklift Aisle Patrol
      if (runForklift && !prefersReducedMotion && state.assembly) {
        state.forkliftPhase += dt * 0.42;
        const asm = state.assembly;
        const travelHalf = Math.max(4, (asm.root.userData.travelHalf as number | undefined) ?? 6);
        const cx = (asm.root.userData.centerX as number | undefined) ?? 0;
        const nextX = cx + Math.sin(state.forkliftPhase) * travelHalf;
        const dir = Math.cos(state.forkliftPhase) >= 0 ? 0 : Math.PI;
        asm.forkliftGroup.position.x = nextX;
        asm.forkliftGroup.rotation.y = dir;
        needsContinue = true;
      }

      const controlsMoved = controls.update();
      if (controlsMoved && controls.enableDamping) {
        needsContinue = true;
      }

      renderer.render(scene, camera);

      if (needsContinue) {
        scheduleNextTick();
      } else {
        loopScheduled = false;
      }
    }

    // Cancel camera transitions immediately on user OrbitControls interaction
    const onControlsStart = () => {
      state.cameraAnimating = false;
      renderer.domElement.style.cursor = 'grabbing';
      state.ensureLoopRunning();
    };
    const onControlsEnd = () => {
      renderer.domElement.style.cursor = state.hoveredId ? 'pointer' : 'grab';
      state.requestRender();
    };
    const onControlsChange = () => {
      if (!loopScheduled) state.requestRender();
    };
    controls.addEventListener('start', onControlsStart);
    controls.addEventListener('end', onControlsEnd);
    controls.addEventListener('change', onControlsChange);

    // Pointer click & throttled hover raycasting
    let downX = 0;
    let downY = 0;
    let lastHoverTime = 0;

    const raycastAtEvent = (ev: PointerEvent): string | null => {
      const asm = state.assembly;
      if (!asm || asm.slotRefs.length === 0) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      _pointerNdc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      _pointerNdc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      _raycaster.setFromCamera(_pointerNdc, camera);
      const hits = _raycaster.intersectObjects(
        asm.slotRefs.map((s) => s.hitMesh),
        false
      );
      const id = hits[0]?.object?.userData?.locationId;
      return typeof id === 'string' ? id : null;
    };

    const onPointerDown = (ev: PointerEvent) => {
      downX = ev.clientX;
      downY = ev.clientY;
    };

    const onPointerUp = (ev: PointerEvent) => {
      const dist = Math.hypot(ev.clientX - downX, ev.clientY - downY);
      if (dist > 6) return; // Ignore orbit drag gestures
      const hitId = raycastAtEvent(ev);
      propsRef.current.onSelectLocation(hitId);
    };

    const onPointerMove = (ev: PointerEvent) => {
      const now = performance.now();
      if (now - lastHoverTime < 50) return;
      lastHoverTime = now;
      const hitId = raycastAtEvent(ev);
      if (hitId !== state.hoveredId) {
        state.hoveredId = hitId;
        renderer.domElement.style.cursor = hitId ? 'pointer' : 'grab';
        state.updateSemanticMaterials();
        state.requestRender();
        propsRef.current.onHoverLocation?.(hitId);
      }
    };

    const domEl = renderer.domElement;
    domEl.addEventListener('pointerdown', onPointerDown);
    domEl.addEventListener('pointerup', onPointerUp);
    domEl.addEventListener('pointermove', onPointerMove);

    const onContextLost = (ev: Event) => {
      ev.preventDefault();
      cancelAnimationFrame(rafId);
      clearTimeout(timerId);
      loopScheduled = false;
      setContextLost(true);
    };
    const onContextRestored = () => {
      setContextLost(false);
      state.requestRender();
    };
    domEl.addEventListener('webglcontextlost', onContextLost);
    domEl.addEventListener('webglcontextrestored', onContextRestored);

    const resizeObserver = new ResizeObserver(() => {
      if (!container || disposed) return;
      const w = container.clientWidth || 800;
      const h = container.clientHeight || 540;
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      state.requestRender();
    });
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      clearTimeout(timerId);
      resizeObserver.disconnect();
      controls.removeEventListener('start', onControlsStart);
      controls.removeEventListener('end', onControlsEnd);
      controls.removeEventListener('change', onControlsChange);
      domEl.removeEventListener('pointerdown', onPointerDown);
      domEl.removeEventListener('pointerup', onPointerUp);
      domEl.removeEventListener('pointermove', onPointerMove);
      domEl.removeEventListener('webglcontextlost', onContextLost);
      domEl.removeEventListener('webglcontextrestored', onContextRestored);
      if (state.assembly) {
        scene.remove(state.assembly.root);
        state.assembly.dispose();
      }
      boxEdgesGeo.dispose();
      boxEdgesMat.dispose();
      textures.dispose();
      envRT.dispose();
      controls.dispose();
      renderer.dispose();
      sceneStateRef.current = null;
    };
  }, []);

  // 2. Rebuild warehouse geometry whenever plan or theme changes
  useEffect(() => {
    const state = sceneStateRef.current;
    if (!state) return;

    const bgHex = isDarkTheme ? 0x0b1120 : 0xe2e8f0;
    state.scene.background = new THREE.Color(bgHex);
    state.scene.fog = new THREE.FogExp2(bgHex, 0.008);
    state.hemiLight.intensity = isDarkTheme ? 0.65 : 0.85;

    if (state.assembly) {
      state.scene.remove(state.assembly.root);
      state.assembly.dispose();
      state.assembly = null;
    }

    const assembly = buildWarehouse3DAssembly(
      plan,
      state.textures,
      propsRef.current.colorMode,
      isDarkTheme
    );
    assembly.root.userData.travelHalf = Math.max(4, plan.bounds.width * 0.28);
    assembly.root.userData.centerX = plan.bounds.centerX;

    // Apply current explode factor immediately so warehouse rebuilds don't snap back
    state.currentExplode = propsRef.current.explodeFactor;
    for (const shelf of assembly.shelfRefs) {
      shelf.group.position.y = shelf.baseY + shelf.levelIndex * state.currentExplode * 0.95;
    }

    state.assembly = assembly;
    state.scene.add(assembly.root);

    // Calibrate shadow frustum & key light target to current warehouse bounds
    const halfSpan = Math.max(20, Math.max(plan.bounds.width, plan.bounds.depth) * 0.7);
    state.keyLight.position.set(plan.bounds.centerX + 18, 26, plan.bounds.centerZ + 16);
    state.keyLight.target.position.set(plan.bounds.centerX, 0, plan.bounds.centerZ);
    state.keyLight.target.updateMatrixWorld();
    state.keyLight.shadow.camera.left = -halfSpan;
    state.keyLight.shadow.camera.right = halfSpan;
    state.keyLight.shadow.camera.top = halfSpan;
    state.keyLight.shadow.camera.bottom = -halfSpan;
    state.keyLight.shadow.camera.updateProjectionMatrix();
    state.controls.maxDistance = Math.max(50, Math.max(plan.bounds.width, plan.bounds.depth) * 2.4);

    // Position camera cleanly on warehouse switch
    computeCameraPresetGoal(plan, cameraPreset, _camGoalPos, _camGoalTarget);
    state.camera.position.copy(_camGoalPos);
    state.controls.target.copy(_camGoalTarget);
    state.controls.update();
    state.cameraAnimating = false;

    state.updateSemanticMaterials();
    state.requestRender();
    if (propsRef.current.animateForklift && !state.prefersReducedMotion) {
      state.ensureLoopRunning();
    }
  }, [plan, isDarkTheme]);

  // 3. Update semantic colors & selection frame without rebuilding geometry
  useEffect(() => {
    const state = sceneStateRef.current;
    if (!state) return;
    state.updateSemanticMaterials();
    state.requestRender();
  }, [colorMode, selectedLocationId]);

  // 4. Trigger vertical explode animation or forklift patrol loop
  useEffect(() => {
    const state = sceneStateRef.current;
    if (!state) return;
    if (
      Math.abs(state.currentExplode - explodeFactor) > 0.001 ||
      (animateForklift && !state.prefersReducedMotion)
    ) {
      state.ensureLoopRunning();
    } else {
      state.requestRender();
    }
  }, [explodeFactor, animateForklift]);

  // 5. Camera preset fly-to transitions
  useEffect(() => {
    if (cameraPresetTrigger === 0) return;
    const state = sceneStateRef.current;
    if (!state) return;
    computeCameraPresetGoal(plan, cameraPreset, _camGoalPos, _camGoalTarget);
    state.cameraAnimating = true;
    state.ensureLoopRunning();
  }, [cameraPreset, cameraPresetTrigger, plan]);

  // 6. Focus specific searched/selected location
  useEffect(() => {
    if (focusTrigger === 0 || !focusLocationId) return;
    const state = sceneStateRef.current;
    if (!state || !state.assembly) return;
    const slot = state.assembly.slotRefs.find((s) => s.node.location.id === focusLocationId);
    if (!slot) return;
    const wy = slot.node.baseY + slot.node.levelIndex * state.currentExplode * 0.95;
    _camGoalTarget.set(slot.node.worldX, wy + 0.45, slot.node.worldZ);
    _camGoalPos.set(slot.node.worldX + 4.2, wy + 3.0, slot.node.worldZ + 5.6);
    state.cameraAnimating = true;
    state.ensureLoopRunning();
  }, [focusLocationId, focusTrigger]);

  return (
    <div className="relative w-full h-full overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-200 dark:bg-slate-950">
      <div
        ref={containerRef}
        className="w-full h-full touch-none"
        aria-label="Jumeau numérique 3D de l’entrepôt"
      />
      {contextLost && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/90 text-white p-6 text-center">
          <div className="max-w-sm space-y-2">
            <p className="text-sm font-semibold">Contexte WebGL interrompu</p>
            <p className="text-xs text-slate-300">
              Le navigateur a temporairement suspendu le rendu 3D. La scène se réinitialisera automatiquement dès que la ressource graphique sera disponible.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
