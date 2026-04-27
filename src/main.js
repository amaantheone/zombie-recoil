import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { AssetLoader } from "./assetLoader.js";
import { ZombieManager } from "./zombies/ZombieManager.js";
import { Boomerang } from "./weapons/Boomerang.js";
import { CombatSystem } from "./combat/CombatSystem.js";
import { Hud } from "./ui/Hud.js";

// ------------------------------------------------------------
// Shared renderer (single-page; route selects mode at startup)
// ------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x1b2a41, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const BASE_URL = import.meta.env.BASE_URL;

function onResize(camera) {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ------------------------------------------------------------
// Level JSON (editor saves; game loads)
// ------------------------------------------------------------

const LEVEL_STORAGE_KEY = "zombieRecoil.level.v1";
const DEFAULT_LEVEL_URL = `${BASE_URL}maps/level.json`;

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function loadLevelPlacements({ preferLocalStorage = false } = {}) {
  const tryLocal = () => {
    try {
      const raw = localStorage.getItem(LEVEL_STORAGE_KEY);
      if (!raw) return null;
      const json = JSON.parse(raw);
      if (Array.isArray(json)) return json;
      if (json && Array.isArray(json.objects)) return json.objects;
    } catch {
      // ignore
    }
    return null;
  };

  const tryFetch = async () => {
    try {
      const res = await fetch(DEFAULT_LEVEL_URL, { cache: "no-cache" });
      if (!res.ok) return null;
      const json = await res.json();
      if (Array.isArray(json)) return json;
      if (json && Array.isArray(json.objects)) return json.objects;
    } catch {
      // ignore
    }
    return null;
  };

  if (preferLocalStorage) {
    return tryLocal() ?? (await tryFetch()) ?? [];
  }
  return (await tryFetch()) ?? tryLocal() ?? [];
}

// ------------------------------------------------------------
// Prefabs (placeholder geometry-based versions)
// Editor uses Groups; Game builds InstancedMeshes by type
// ------------------------------------------------------------

const PREFAB_TYPES = /** @type {const} */ (["House", "Silo", "Frame", "Barricade"]);
const PREFAB_SCALES = {
  Barricade: 3.0,
  House: 5.0,
  Silo: 3.0,
  Frame: 4.5,
};

const PREFAB_Y_OFFSETS = {
  House: 1.5,
  Silo: 4.0,
  Frame: 6.0,
  Barricade: 0.5,
};

function normalizePrefabType(type) {
  const t = String(type ?? "").trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  if (lower === "house") return "House";
  if (lower === "silo") return "Silo";
  if (lower === "frame" || lower === "skeleton frame" || lower === "skeletonframe") return "Frame";
  if (lower === "barricade") return "Barricade";
  // already normalized?
  if (PREFAB_TYPES.includes(t)) return t;
  return null;
}

function snapToGrid(v, grid = 5) {
  return Math.round(v / grid) * grid;
}

function clampToBoundsXZ(pos, bounds) {
  pos.x = THREE.MathUtils.clamp(pos.x, bounds.minX, bounds.maxX);
  pos.z = THREE.MathUtils.clamp(pos.z, bounds.minZ, bounds.maxZ);
  return pos;
}

function isInsideBoundsXZ(pos, bounds) {
  return (
    pos.x >= bounds.minX &&
    pos.x <= bounds.maxX &&
    pos.z >= bounds.minZ &&
    pos.z <= bounds.maxZ
  );
}

function createGhostMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity: 0.5,
    roughness: 1.0,
    metalness: 0.0,
  });
}

function createSolidMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.9,
    metalness: 0.0,
  });
}

function setGroupMaterial(group, material) {
  group.traverse((o) => {
    if (o.isMesh) o.material = material;
  });
}

function createHouseGroup({ ghost = false } = {}) {
  const group = new THREE.Group();
  const mat = ghost ? createGhostMaterial(0xd3b38c) : createSolidMaterial(0xd3b38c);

  const base = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 8), mat);
  base.position.y = 1.5;
  group.add(base);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(6.2, 2.5, 4), mat);
  roof.position.y = 4.1;
  roof.rotation.y = Math.PI / 4;
  group.add(roof);

  group.userData.type = "House";
  return group;
}

function createSiloGroup({ ghost = false } = {}) {
  const group = new THREE.Group();
  const mat = ghost ? createGhostMaterial(0xb8c0c8) : createSolidMaterial(0xb8c0c8);

  const body = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 7, 18), mat);
  body.position.y = 3.5;
  group.add(body);

  const cap = new THREE.Mesh(new THREE.SphereGeometry(2.6, 18, 12), mat);
  cap.position.y = 7.1;
  cap.scale.y = 0.7;
  group.add(cap);

  group.userData.type = "Silo";
  return group;
}

function createFrameGroup({ ghost = false } = {}) {
  const group = new THREE.Group();
  const mat = ghost ? createGhostMaterial(0x8aa7ff) : createSolidMaterial(0x8aa7ff);

  const postA = new THREE.Mesh(new THREE.BoxGeometry(0.7, 5, 0.7), mat);
  postA.position.set(-2.5, 2.5, 0);
  group.add(postA);

  const postB = postA.clone();
  postB.position.set(2.5, 2.5, 0);
  group.add(postB);

  const beam = new THREE.Mesh(new THREE.BoxGeometry(6, 0.7, 0.7), mat);
  beam.position.set(0, 5, 0);
  group.add(beam);

  group.userData.type = "Frame";
  return group;
}

function createBarricadeGroup({ ghost = false } = {}) {
  const group = new THREE.Group();
  const mat = ghost ? createGhostMaterial(0xc18a5a) : createSolidMaterial(0xc18a5a);

  const plank1 = new THREE.Mesh(new THREE.BoxGeometry(7, 0.6, 1.2), mat);
  plank1.position.set(0, 1.2, 0);
  plank1.rotation.z = 0.25;
  group.add(plank1);

  const plank2 = plank1.clone();
  plank2.position.set(0, 2.1, 0);
  plank2.rotation.z = -0.25;
  group.add(plank2);

  const foot = new THREE.Mesh(new THREE.BoxGeometry(7, 0.4, 2.0), mat);
  foot.position.set(0, 0.2, 0);
  group.add(foot);

  group.userData.type = "Barricade";
  return group;
}

function createPrefabGroup(type, { ghost = false } = {}) {
  switch (type) {
    case "House":
      return createHouseGroup({ ghost });
    case "Silo":
      return createSiloGroup({ ghost });
    case "Frame":
      return createFrameGroup({ ghost });
    case "Barricade":
      return createBarricadeGroup({ ghost });
    default:
      return createHouseGroup({ ghost });
  }
}

function createInstancedPrefab(type, count) {
  // Keep this simple/cheap for integrated GPUs.
  // (One InstancedMesh per prefab type, a single geom + material.)
  let geometry;
  let material;

  switch (type) {
    case "House":
      geometry = new THREE.BoxGeometry(8, 3, 8);
      geometry.translate(0, 1.5, 0);
      material = createSolidMaterial(0xd3b38c);
      break;
    case "Silo":
      geometry = new THREE.CylinderGeometry(2.5, 2.5, 7, 14);
      geometry.translate(0, 3.5, 0);
      material = createSolidMaterial(0xb8c0c8);
      break;
    case "Frame":
      geometry = new THREE.BoxGeometry(6, 5, 0.7);
      geometry.translate(0, 2.5, 0);
      material = createSolidMaterial(0x8aa7ff);
      break;
    case "Barricade":
      geometry = new THREE.BoxGeometry(7, 2.6, 2.0);
      geometry.translate(0, 1.3, 0);
      material = createSolidMaterial(0xc18a5a);
      break;
    default:
      geometry = new THREE.BoxGeometry(2, 2, 2);
      geometry.translate(0, 1, 0);
      material = createSolidMaterial(0xffffff);
      break;
  }

  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, count));
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = count;
  return mesh;
}

function applyTiledGroundTexture(renderer, material, url, repeat) {
  const loader = new THREE.TextureLoader();
  loader.load(
    url,
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeat, repeat);
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      material.map = tex;
      material.needsUpdate = true;
    },
    undefined,
    () => {
      // Keep the fallback solid color material.
    }
  );
}

// ------------------------------------------------------------
// Route selection
// ------------------------------------------------------------

const isEditRoute =
  window.location.pathname === "/edit" ||
  window.location.pathname === "/edit/" ||
  window.location.hash === "#/edit" ||
  window.location.hash === "#/edit/";

if (isEditRoute) runEditor();
else runGame();

// ------------------------------------------------------------
// EDITOR MODE: /edit
// ------------------------------------------------------------

function runEditor() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b2a41);

  const assets = new AssetLoader();

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    500
  );
  camera.position.set(30, 35, 30);
  camera.lookAt(0, 0, 0);

  // Keep editor light: no shadows, no post.
  renderer.shadowMap.enabled = false;

  const ambient = new THREE.AmbientLight(0xffffff, 1.0);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  // Point downwards
  sun.position.set(0, 20, 0);
  sun.target.position.set(0, 0, 0);
  scene.add(sun);
  scene.add(sun.target);

  // Tileable sand (falls back to color if texture missing)
  const sandMat = new THREE.MeshStandardMaterial({
    color: 0xd1b48c,
    roughness: 1.0,
    metalness: 0.0,
  });
  applyTiledGroundTexture(renderer, sandMat, `${BASE_URL}textures/sandy_ground.png`, 40);

  const groundSize = 75;
  // Single low-poly plane for iGPU friendliness
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize, 1, 1), sandMat);
  ground.rotation.x = -Math.PI / 2;
  ground.name = "SandGround";
  ground.frustumCulled = true;
  scene.add(ground);

  // Map boundary ("Inpassable Sand Dunes" placeholder bounds).
  // Adjust these to match your actual plan.
  const bounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };

  const boundsLine = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ)),
    new THREE.LineBasicMaterial({ color: 0xffcf5a })
  );
  boundsLine.rotation.x = -Math.PI / 2;
  boundsLine.position.set((bounds.minX + bounds.maxX) / 2, 0.02, (bounds.minZ + bounds.maxZ) / 2);
  scene.add(boundsLine);

  // Grid helper (5-unit grid)
  const grid = new THREE.GridHelper(groundSize, groundSize / 5, 0x2b394f, 0x2b394f);
  grid.position.y = 0.01;
  scene.add(grid);

  // Orbit controls (RMB pan + wheel zoom). Disable while dragging objects.
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enableRotate = false; // keep editor planar; prevents LMB rotate conflicts
  controls.enablePan = true;
  controls.screenSpacePanning = false;
  controls.minDistance = 10;
  controls.maxDistance = 240;
  controls.target.set(0, 0, 0);
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE, // does nothing since enableRotate=false
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };
  controls.update();

  // Editor objects
  const editorGroup = new THREE.Group();
  editorGroup.name = "EditorGroup";
  scene.add(editorGroup);

  const placedInstancedRoot = new THREE.Group();
  placedInstancedRoot.name = "PlacedPrefabsInstanced";
  editorGroup.add(placedInstancedRoot);

  const selectionRing = new THREE.Mesh(
    new THREE.RingGeometry(4.2, 4.9, 24),
    new THREE.MeshBasicMaterial({ color: 0x6ee7ff, transparent: true, opacity: 0.75, side: THREE.DoubleSide })
  );
  selectionRing.rotation.x = -Math.PI / 2;
  selectionRing.visible = false;
  editorGroup.add(selectionRing);

  /** @type {"select"|"place"} */
  let editorMode = "select";
  let placingType = null; // string | null
  let ghost = null; // THREE.Group | null
  let selected = null; // { type: string, index: number } | null
  let isDragging = false;
  let isLoadingPrefab = false;

  // UI overlay
  const uiRoot = document.createElement("div");
  uiRoot.id = "level-editor-ui";
  uiRoot.innerHTML = `
    <div class="panel">
      <div class="title">Level Designer</div>
      <div class="section status">
        <div class="hint" data-status>Loading assets…</div>
      </div>
      <div class="section">
        <div class="label">Mode</div>
        <button data-action="select" data-active> Select</button>
      </div>
      <div class="section">
        <div class="label">Prefabs</div>
        <div class="prefab-grid">
          <button data-place="House" data-active>House</button>
          <button data-place="Silo" data-active>Silo</button>
          <button data-place="Frame" data-active>Frame</button>
          <button data-place="Barricade" data-active>Barricade</button>
        </div>
      </div>
      <div class="section">
        <div class="label">Sync</div>
        <button data-action="sync">Sync to Game</button>
        <button data-action="reset">Reset Map</button>
      </div>
      <div class="section hints">
        <div class="label">Controls</div>
        <div class="hint"><b>Click</b>: place/select</div>
        <div class="hint"><b>W/A/S/D</b>: move selected (snap)</div>
        <div class="hint"><b>Drag</b>: move selected (snap)</div>
        <div class="hint"><b>R</b>: rotate 90°</div>
        <div class="hint"><b>Del</b>: delete</div>
        <div class="hint"><b>Esc</b>: cancel placement</div>
        <div class="hint"><b>RMB</b>: pan camera</div>
        <div class="hint"><b>Wheel</b>: zoom</div>
      </div>
      <div class="section">
        <a class="link" href="/">Back to game</a>
      </div>
    </div>
  `;
  document.body.appendChild(uiRoot);

  const style = document.createElement("style");
  style.textContent = `
    #level-editor-ui{
      position: fixed;
      inset: 0 auto 0 0;
      width: 240px;
      pointer-events: none;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Apple Color Emoji", "Segoe UI Emoji";
      color: #e9f0ff;
      z-index: 10;
    }
    #level-editor-ui .panel{
      height: 100%;
      background: rgba(10,16,26,0.72);
      backdrop-filter: blur(8px);
      border-right: 1px solid rgba(255,255,255,0.10);
      padding: 14px 12px;
      box-sizing: border-box;
      pointer-events: auto;
      overflow: auto;
    }
    #level-editor-ui .title{
      font-weight: 800;
      letter-spacing: 0.2px;
      margin-bottom: 10px;
    }
    #level-editor-ui .section{ margin: 12px 0; }
    #level-editor-ui .label{
      font-size: 12px;
      opacity: 0.8;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    #level-editor-ui button{
      width: 100%;
      margin: 6px 0;
      padding: 9px 10px;
      border-radius: 10px;
      border: 2px solid rgba(255,255,255,0.14);
      background: rgba(255,255,255,0.08);
      color: inherit;
      cursor: pointer;
      font-weight: 650;
    }
    #level-editor-ui button.active{
      border-color: rgba(110,231,255,0.95);
      background: rgba(110,231,255,0.22);
    }
    #level-editor-ui button:hover{
      background: rgba(255,255,255,0.14);
    }
    #level-editor-ui .hints .hint{
      font-size: 12px;
      opacity: 0.9;
      margin: 6px 0;
    }
    #level-editor-ui .link{
      color: #9fd8ff;
      text-decoration: none;
      font-weight: 650;
      font-size: 13px;
    }
    #level-editor-ui .prefab-grid{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    #level-editor-ui .prefab-grid button{
      width: 100%;
      margin: 0;
    }
  `;
  document.head.appendChild(style);

  const statusEl = uiRoot.querySelector("[data-status]");
  const setStatus = (text) => {
    if (statusEl) statusEl.textContent = text;
  };

  const missingEl = document.createElement("div");
  missingEl.className = "hint";
  missingEl.style.marginTop = "8px";
  missingEl.style.opacity = "0.95";
  uiRoot.querySelector(".section.status")?.appendChild(missingEl);
  const setMissing = (text) => {
    missingEl.textContent = text || "";
  };

  // Placement + selection raycasting
  const raycaster = new THREE.Raycaster();
  const mouseNdc = new THREE.Vector2();
  const tmpPoint = new THREE.Vector3();
  const tmpMat = new THREE.Matrix4();
  const tmpMat2 = new THREE.Matrix4();
  const tmpObj = new THREE.Object3D();
  const defaultInstanceColor = new THREE.Color(0xffffff);
  const selectedInstanceColor = new THREE.Color(0x6ee7ff);

  const INST_CAPACITY = 2048;
  let mouseInViewport = false;

  // Match requested API naming; Three uses setColorAt under the hood.
  function setInstanceColorAt(instancedMesh, index, color) {
    instancedMesh.setColorAt(index, color);
    if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
  }

  /** @type {Map<string, { placements: any[], parts: THREE.InstancedMesh[] }>} */
  const instancedByType = new Map();
  /** @type {Map<string, number>} */
  const baseYOffsetByType = new Map();

  function setAllPartColors(type, index, color) {
    const entry = instancedByType.get(type);
    if (!entry) return;
    for (const part of entry.parts) {
      if (!part.instanceColor) continue;
      setInstanceColorAt(part, index, color);
    }
  }

  function updateInstanceMatrices(type, index) {
    const entry = instancedByType.get(type);
    if (!entry) return;
    const p = entry.placements[index];
    if (!p) return;

    // locked to ground
    const px = p.position.x;
    const pz = p.position.z;
    const ry = p.rotation.y;
    const s = PREFAB_SCALES[type] ?? 1.0;
    const baseYOffset = baseYOffsetByType.get(type) ?? PREFAB_Y_OFFSETS[type] ?? 0;
    const y = baseYOffset * s;

    tmpObj.position.set(px, y, pz);
    tmpObj.rotation.set(0, ry, 0);
    tmpObj.scale.setScalar(s);
    tmpObj.updateMatrix();
    tmpMat.copy(tmpObj.matrix);

    for (const part of entry.parts) {
      const localToRoot = part.userData.localToRoot;
      tmpMat2.multiplyMatrices(tmpMat, localToRoot);
      part.setMatrixAt(index, tmpMat2);
      part.instanceMatrix.needsUpdate = true;
      part.frustumCulled = true;
    }
  }

  function setSelectedInstance(next) {
    if (selected) {
      setAllPartColors(selected.type, selected.index, defaultInstanceColor);
    }
    selected = next;
    if (selected) {
      setAllPartColors(selected.type, selected.index, selectedInstanceColor);
    }
    selectionRing.visible = false; // no longer used for instanced selection
  }

  function eventToMouseNdc(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouseNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseNdc.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    return mouseNdc;
  }

  function getGroundHit(e) {
    eventToMouseNdc(e);
    raycaster.setFromCamera(mouseNdc, camera);
    const hits = raycaster.intersectObject(ground, false);
    if (!hits.length) return null;
    return hits[0].point;
  }

  function getPlacedHit(e) {
    eventToMouseNdc(e);
    raycaster.setFromCamera(mouseNdc, camera);
    const meshes = [];
    for (const entry of instancedByType.values()) {
      for (const part of entry.parts) meshes.push(part);
    }
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const hit = hits[0];
    const mesh = hit.object;
    const instanceId = hit.instanceId;
    if (instanceId == null) return null;
    const type = mesh.userData.prefabType;
    if (!type) return null;
    return { type, index: instanceId };
  }

  function setPlacing(type) {
    editorMode = type ? "place" : "select";
    placingType = type;
    if (ghost) {
      editorGroup.remove(ghost);
      ghost = null;
    }
    setSelectedInstance(null);
    if (!type) return;
    // Ghost should only appear once mouse enters the 3D viewport.
    // We'll lazily create it on mouseenter/mousemove.
    setStatus(`Selected ${type} (move mouse into viewport)`);
  }

  function placeAt(pos) {
    if (!placingType) return;
    if (!isInsideBoundsXZ(pos, bounds)) return;
    if (isLoadingPrefab) return;
    const entry = instancedByType.get(placingType);
    if (!entry) return;
    const idx = entry.placements.length;
    if (idx >= INST_CAPACITY) {
      setStatus("Instance capacity reached");
      return;
    }
    entry.placements.push({
      type: placingType,
      position: { x: pos.x, y: 0, z: pos.z },
      rotation: { y: 0 },
    });
    for (const part of entry.parts) {
      part.count = entry.placements.length;
      part.frustumCulled = true;
    }
    updateInstanceMatrices(placingType, idx);
    setAllPartColors(placingType, idx, defaultInstanceColor);
    setSelectedInstance({ type: placingType, index: idx });
  }

  function moveSelectedBy(dx, dz) {
    if (!selected) return;
    const entry = instancedByType.get(selected.type);
    if (!entry) return;
    const p = entry.placements[selected.index];
    if (!p) return;
    p.position.x = snapToGrid(p.position.x + dx, 5);
    p.position.z = snapToGrid(p.position.z + dz, 5);
    tmpPoint.set(p.position.x, 0, p.position.z);
    clampToBoundsXZ(tmpPoint, bounds);
    p.position.x = tmpPoint.x;
    p.position.z = tmpPoint.z;
    p.position.y = 0;
    updateInstanceMatrices(selected.type, selected.index);
  }

  function rotateSelected90() {
    if (!selected) return;
    const entry = instancedByType.get(selected.type);
    if (!entry) return;
    const p = entry.placements[selected.index];
    if (!p) return;
    p.rotation.y = (p.rotation.y + Math.PI / 2) % (Math.PI * 2);
    updateInstanceMatrices(selected.type, selected.index);
  }

  function deleteSelected() {
    if (!selected) return;
    const entry = instancedByType.get(selected.type);
    if (!entry) return;
    const idx = selected.index;
    const last = entry.placements.length - 1;
    if (idx < 0 || idx > last) return;

    // Un-highlight current first
    setAllPartColors(selected.type, idx, defaultInstanceColor);

    if (idx !== last) {
      // swap-last into deleted slot
      entry.placements[idx] = entry.placements[last];
      updateInstanceMatrices(selected.type, idx);
      // carry highlight if we swapped from last (we set default now)
      setAllPartColors(selected.type, idx, defaultInstanceColor);
    }
    entry.placements.pop();
    for (const part of entry.parts) {
      part.count = entry.placements.length;
      part.instanceMatrix.needsUpdate = true;
    }
    setSelectedInstance(null);
  }

  function currentMapObjects() {
    // Extract from InstancedMesh instanceMatrix (source of truth for sync/export)
    const objects = [];
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const euler = new THREE.Euler(0, 0, 0, "YXZ");

    for (const [type, entry] of instancedByType.entries()) {
      const firstPart = entry.parts?.[0];
      if (!firstPart) continue;
      // count can lag/appear as 0; placements[] is the authoritative list.
      const count = entry.placements.length;
      for (let i = 0; i < count; i++) {
        firstPart.getMatrixAt(i, m);
        pos.setFromMatrixPosition(m);
        m.decompose(new THREE.Vector3(), quat, scl);
        euler.setFromQuaternion(quat);
        objects.push({
          type: String(type).toLowerCase(),
          position: { x: pos.x, y: 0, z: pos.z },
          rotation: { y: euler.y },
          scale: PREFAB_SCALES[type] ?? 1.0,
        });
      }
    }
    return objects;
  }

  async function syncToGame() {
    const btn = uiRoot.querySelector('button[data-action="sync"]');
    const originalText = btn?.textContent;
    const objects = currentMapObjects();
    const json = JSON.stringify(objects, null, 2);
    localStorage.setItem(LEVEL_STORAGE_KEY, json);
    setStatus("Syncing…");
    if (btn) btn.textContent = "Saving…";
    try {
      const res = await fetch("/api/save-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(objects),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus("Synced to `public/maps/level.json`");
      console.log("Sync successful");
      if (btn) {
        btn.textContent = "Saved!";
        setTimeout(() => {
          if (btn) btn.textContent = originalText ?? "Sync to Game";
        }, 900);
      }
    } catch (e) {
      setStatus(`Sync failed (is Vite running?): ${e?.message ?? "error"}`);
      if (btn) btn.textContent = originalText ?? "Sync to Game";
    }
  }

  uiRoot.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("button");
    if (!btn) return;
    const type = btn.getAttribute("data-place");
    const action = btn.getAttribute("data-action");
    if (action === "select") setPlacing(null);
    if (type && PREFAB_TYPES.includes(type)) setPlacing(type);
    if (action === "sync") syncToGame();
    if (action === "reset") resetMap();
    updateActiveButtons();
  });

  function updateActiveButtons() {
    uiRoot.querySelectorAll("button[data-active]").forEach((b) => b.classList.remove("active"));
    if (editorMode === "select") {
      uiRoot.querySelector('button[data-action="select"]')?.classList.add("active");
    } else if (editorMode === "place" && placingType) {
      uiRoot.querySelector(`button[data-place="${placingType}"]`)?.classList.add("active");
    }
  }

  async function resetMap() {
    const ok = window.confirm("Are you sure?");
    if (!ok) return;
    setSelectedInstance(null);
    for (const [type, entry] of instancedByType.entries()) {
      entry.placements.length = 0;
      for (const part of entry.parts) {
        part.count = 0;
        part.instanceMatrix.needsUpdate = true;
        if (part.instanceColor) part.instanceColor.needsUpdate = true;
      }
    }
    localStorage.removeItem(LEVEL_STORAGE_KEY);
    setStatus("Resetting…");
    try {
      await fetch("/api/save-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "[]",
      });
      setStatus("Map reset (cleared JSON + localStorage)");
    } catch (e) {
      setStatus(`Reset failed: ${e?.message ?? "error"}`);
    }
  }

  function onKeyDown(e) {
    if (e.code === "Escape") {
      setPlacing(null);
      return;
    }
    if (e.code === "KeyR") {
      rotateSelected90();
      e.preventDefault();
      return;
    }
    if (e.code === "Delete" || e.code === "Backspace") {
      deleteSelected();
      e.preventDefault();
      return;
    }
    if (e.code === "KeyW") {
      moveSelectedBy(0, -5);
      e.preventDefault();
      return;
    }
    if (e.code === "KeyS") {
      moveSelectedBy(0, 5);
      e.preventDefault();
      return;
    }
    if (e.code === "KeyA") {
      moveSelectedBy(-5, 0);
      e.preventDefault();
      return;
    }
    if (e.code === "KeyD") {
      moveSelectedBy(5, 0);
      e.preventDefault();
      return;
    }
  }

  function onMouseMove(e) {
    if (editorMode === "place" && placingType) {
      // lazy-create ghost on first viewport interaction
      if (!ghost && mouseInViewport && !isLoadingPrefab) {
        isLoadingPrefab = true;
        setStatus(`Loading ${placingType}…`);
        assets
          .createEditorClone(placingType, { ghost: true })
          .then((g) => {
            ghost = g;
            ghost.rotation.set(0, 0, 0);
            ghost.traverse((o) => {
              if (o?.isMesh) o.frustumCulled = true;
            });
            editorGroup.add(ghost);
            setStatus("Ready");
          })
          .catch(() => {
            ghost = createPrefabGroup(placingType, { ghost: true });
            editorGroup.add(ghost);
            setStatus("Missing `public/prefabs/*` models (using placeholders)");
          })
          .finally(() => {
            isLoadingPrefab = false;
          });
      }
    }

    if (placingType && ghost) {
      const hit = getGroundHit(e);
      if (!hit) return;
      tmpPoint.copy(hit);
      tmpPoint.x = snapToGrid(tmpPoint.x, 5);
      tmpPoint.z = snapToGrid(tmpPoint.z, 5);
      tmpPoint.y = 0;
      clampToBoundsXZ(tmpPoint, bounds);
      ghost.position.copy(tmpPoint);
      const s = PREFAB_SCALES[placingType] ?? 1.0;
      const baseYOffset = baseYOffsetByType.get(placingType) ?? PREFAB_Y_OFFSETS[placingType] ?? 0;
      ghost.scale.setScalar(s);
      ghost.position.y = baseYOffset * s;
    }
    if (isDragging && selected) {
      const hit = getGroundHit(e);
      if (!hit) return;
      tmpPoint.copy(hit);
      tmpPoint.x = snapToGrid(tmpPoint.x, 5);
      tmpPoint.z = snapToGrid(tmpPoint.z, 5);
      tmpPoint.y = 0;
      if (!isInsideBoundsXZ(tmpPoint, bounds)) return;
      const entry = instancedByType.get(selected.type);
      if (!entry) return;
      const p = entry.placements[selected.index];
      if (!p) return;
      p.position.x = tmpPoint.x;
      p.position.z = tmpPoint.z;
      p.position.y = 0;
      updateInstanceMatrices(selected.type, selected.index);
    }
  }

  function onMouseDown(e) {
    // Ignore clicks on the UI panel.
    if (e.target && uiRoot.contains(e.target)) return;
    if (e.button !== 0) return;

    if (editorMode === "place" && placingType && ghost) {
      const hit = getGroundHit(e);
      if (!hit) return;
      tmpPoint.copy(hit);
      tmpPoint.x = snapToGrid(tmpPoint.x, 5);
      tmpPoint.z = snapToGrid(tmpPoint.z, 5);
      tmpPoint.y = 0;
      if (!isInsideBoundsXZ(tmpPoint, bounds)) return;
      placeAt(tmpPoint);
      return;
    }

    const hitObj = getPlacedHit(e);
    if (hitObj) {
      setSelectedInstance(hitObj);
      isDragging = true;
      controls.enabled = false;
    } else {
      setSelectedInstance(null);
    }
  }

  function onMouseUp(e) {
    if (e.button !== 0) return;
    isDragging = false;
    controls.enabled = true;
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("resize", () => onResize(camera));

  // Track whether mouse is inside the 3D viewport (canvas)
  renderer.domElement.addEventListener("mouseenter", () => {
    mouseInViewport = true;
  });
  renderer.domElement.addEventListener("mouseleave", () => {
    mouseInViewport = false;
    // Hide ghost when leaving viewport (keeps UI clean)
    if (ghost) {
      ghost.visible = false;
    }
  });

  // Start with any saved layout in localStorage (if present)
  (async () => {
    setStatus("Loading assets…");
    const check = await assets.checkAssets(PREFAB_TYPES);
    if (check.missing.length) {
      setMissing(
        `Missing file(s): ${check.missing.map((m) => m.url.split("/").pop()).join(", ")}`
      );
    } else {
      setMissing("");
    }

    await assets.preloadAll(PREFAB_TYPES);

    // Build instanced sets for editor
    for (const type of PREFAB_TYPES) {
      let root;
      try {
        root = await assets.loadPrefab(type);
      } catch {
        root = createPrefabGroup(type, { ghost: false });
      }
      baseYOffsetByType.set(type, root?.userData?.baseYOffset ?? PREFAB_Y_OFFSETS[type] ?? 0);
      const { group, parts } = assets.createInstancedSetFromPrefab(root, 0, {
        capacity: INST_CAPACITY,
        enableInstanceColors: true,
      });
      group.name = `${type}EditorInstanced`;
      for (const p of parts) {
        p.userData.prefabType = type;
        p.frustumCulled = true;
      }
      placedInstancedRoot.add(group);
      instancedByType.set(type, { placements: [], parts });
    }

    setStatus("Ready");
    updateActiveButtons();

    const placements = await loadLevelPlacements({ preferLocalStorage: true });
    for (const p of placements) {
      const type = normalizePrefabType(p?.type);
      if (!type) continue;
      const px = snapToGrid(p?.position?.x ?? 0, 5);
      const pz = snapToGrid(p?.position?.z ?? 0, 5);
      const ry = p?.rotation?.y ?? 0;
      const pos = new THREE.Vector3(px, 0, pz);
      if (!isInsideBoundsXZ(pos, bounds)) continue;
      const entry = instancedByType.get(type);
      if (!entry) continue;
      const idx = entry.placements.length;
      if (idx >= INST_CAPACITY) continue;
      entry.placements.push({
        type,
        position: { x: px, y: 0, z: pz },
        rotation: { y: ry },
      });
      for (const part of entry.parts) part.count = entry.placements.length;
      updateInstanceMatrices(type, idx);
      setAllPartColors(type, idx, defaultInstanceColor);
    }
  })();

  let lastTime = performance.now();
  function animate() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    // keep ghost grounded (y = baseYOffset * scale)
    if (ghost && placingType) {
      ghost.visible = mouseInViewport && editorMode === "place";
      const s = PREFAB_SCALES[placingType] ?? 1.0;
      const baseYOffset = baseYOffsetByType.get(placingType) ?? PREFAB_Y_OFFSETS[placingType] ?? 0;
      ghost.scale.setScalar(s);
      ghost.position.y = baseYOffset * s;
    }

    controls.update();

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();
}

// ------------------------------------------------------------
// GAME MODE: /
// ------------------------------------------------------------

function runGame() {
  const scene = new THREE.Scene();
  const assets = new AssetLoader();
  const runStartedAt = performance.now();

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  camera.position.set(0, 2.0, 6.0);
  camera.lookAt(0, 0, 0);

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Lighting: ambient + directional
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(2, 3, 4);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.camera.near = 0.1;
  dirLight.shadow.camera.far = 50;
  dirLight.shadow.camera.left = -15;
  dirLight.shadow.camera.right = 15;
  dirLight.shadow.camera.top = 15;
  dirLight.shadow.camera.bottom = -15;
  scene.add(dirLight);

  // Big textured ground
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0xd1b48c,
    roughness: 1.0,
    metalness: 0.0,
  });
  applyTiledGroundTexture(renderer, groundMat, `${BASE_URL}textures/sandy_ground.png`, 40);

  const groundSize = 75;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize),
    groundMat
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Game bounds derived from groundSize (spawn edges, simple clamping).
  const gameBounds = {
    minX: -groundSize / 2,
    maxX: groundSize / 2,
    minZ: -groundSize / 2,
    maxZ: groundSize / 2,
  };

  // Core loop systems (math-based, no physics engine)
  const zombieManager = new ZombieManager({
    scene,
    bounds: gameBounds,
    // Keep the game iGPU-friendly: hard cap + finite wave (win when all defeated).
    maxZombies: 64,
    totalToSpawn: 48,
    speed: 1.35,
    spawnEverySeconds: 1.0,
    hp: 100,
    modelScale: 2,
  });

  const boomerang = new Boomerang({
    scene,
    speed: 14,
    maxDistance: 16,
    spinSpeed: 18,
    radius: 1.5,
    damage: 50,
  });

  const combatSystem = new CombatSystem({
    zombieManager,
    boomerang,
    playerMaxHp: 100,
    zombieContactDps: 22,
  });

  const hud = new Hud({ playerMaxHp: 100 });

  // Auto-load placements and convert to InstancedMeshes for VRAM friendliness
  const instancedBuildings = new THREE.Group();
  instancedBuildings.name = "InstancedBuildings";
  scene.add(instancedBuildings);

  // -----------------------------
  // Collision: cheap Box3 checks
  // -----------------------------
  const collisionLocalBoxByType = new Map(); // type -> Box3 (local, pre-offset, pre-scale)
  const collisionMatrix = new THREE.Matrix4();
  const collisionBox = new THREE.Box3();
  const collisionTmpBox = new THREE.Box3();
  const collisionPos = new THREE.Vector3();
  const collisionDelta = new THREE.Vector3();
  const collisionScale = new THREE.Vector3();
  const collisionQuat = new THREE.Quaternion();
  const characterRadius = 0.45; // approx capsule radius
  const characterHalfHeight = 0.85;
  /** @type {{ type: string, position: {x:number,y:number,z:number}, rotation: {y:number}, scale: number }[]} */
  const gamePlacements = [];

  (async () => {
    const placements = await loadLevelPlacements({ preferLocalStorage: false });
    const byType = new Map();
    for (const p of placements) {
      const type = normalizePrefabType(p?.type);
      if (!type) continue;
      // hard lock to ground
      p.position = { ...(p.position ?? {}), y: 0 };
      p.scale = p?.scale ?? PREFAB_SCALES[type] ?? 1.0;
      const arr = byType.get(type) ?? [];
      arr.push(p);
      byType.set(type, arr);
    }

    for (const type of PREFAB_TYPES) {
      const arr = byType.get(type) ?? [];
      if (!arr.length) continue;
      // ensure y-offset is applied AFTER scale (based on loaded prefab bounds)
      let baseYOffset = PREFAB_Y_OFFSETS[type] ?? 0;
      try {
        const prefab = await assets.loadPrefab(type);
        baseYOffset = prefab?.userData?.baseYOffset ?? baseYOffset;
        // precompute local bbox for collisions
        const localBox = new THREE.Box3().setFromObject(prefab);
        collisionLocalBoxByType.set(type, localBox);
      } catch {
        // keep fallback
        // fallback bbox: small cube-ish
        collisionLocalBoxByType.set(type, new THREE.Box3(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 4, 2)));
      }
      for (const p of arr) {
        p.position.y = baseYOffset * (p.scale ?? 1.0);
      }

      // Cache placements for collision queries (no per-frame JSON parsing)
      for (const p of arr) {
        gamePlacements.push({
          type,
          position: { x: p.position.x ?? 0, y: p.position.y ?? 0, z: p.position.z ?? 0 },
          rotation: { y: p.rotation?.y ?? 0 },
          scale: p.scale ?? PREFAB_SCALES[type] ?? 1.0,
        });
      }
      try {
        const instGroup = await assets.createInstancedGroup(type, arr);
        instGroup.traverse((o) => {
          if (o?.isInstancedMesh) {
            o.castShadow = false;
            o.receiveShadow = true;
            o.frustumCulled = true;
          }
        });
        instancedBuildings.add(instGroup);
      } catch {
        // fallback to simple geometry instancing if prefabs are missing
        const mesh = createInstancedPrefab(type, arr.length);
        const dummy = new THREE.Object3D();
        for (let i = 0; i < arr.length; i++) {
          const p = arr[i];
          dummy.position.set(p?.position?.x ?? 0, p?.position?.y ?? 0, p?.position?.z ?? 0);
          dummy.rotation.set(0, p?.rotation?.y ?? 0, 0);
          dummy.scale.setScalar(p?.scale ?? PREFAB_SCALES[type] ?? 1.0);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.frustumCulled = true;
        instancedBuildings.add(mesh);
      }
    }
  })();

  function characterAABBAt(pos) {
    collisionBox.min.set(pos.x - characterRadius, pos.y, pos.z - characterRadius);
    collisionBox.max.set(pos.x + characterRadius, pos.y + characterHalfHeight * 2, pos.z + characterRadius);
    return collisionBox;
  }

  function computeInstanceBox(type, placement) {
    const local = collisionLocalBoxByType.get(type);
    if (!local) return null;

    // Build transform matrix with yOffset already included in placement.position.y
    collisionPos.set(placement.position.x, placement.position.y, placement.position.z);
    collisionScale.setScalar(placement.scale ?? PREFAB_SCALES[type] ?? 1.0);
    collisionQuat.setFromEuler(new THREE.Euler(0, placement.rotation.y ?? 0, 0, "YXZ"));
    collisionMatrix.compose(collisionPos, collisionQuat, collisionScale);

    collisionTmpBox.copy(local);
    collisionTmpBox.applyMatrix4(collisionMatrix);
    return collisionTmpBox;
  }

  function resolveSlide(pos, delta, candidates) {
    // axis-separated slide: try full move, then x-only, then z-only
    const next = tmpVec.copy(pos).add(delta);
    const charBoxNext = characterAABBAt(next);
    for (const c of candidates) {
      if (charBoxNext.intersectsBox(c)) {
        // collide: try x-only
        const dx = new THREE.Vector3(delta.x, 0, 0);
        const nx = tmpVec.copy(pos).add(dx);
        const boxX = characterAABBAt(nx);
        let hitX = false;
        for (const cc of candidates) if (boxX.intersectsBox(cc)) { hitX = true; break; }
        if (!hitX) return dx;

        // try z-only
        const dz = new THREE.Vector3(0, 0, delta.z);
        const nz = tmpVec.copy(pos).add(dz);
        const boxZ = characterAABBAt(nz);
        let hitZ = false;
        for (const cc of candidates) if (boxZ.intersectsBox(cc)) { hitZ = true; break; }
        if (!hitZ) return dz;

        // blocked
        return collisionDelta.set(0, 0, 0);
      }
    }
    return delta;
  }

  // Input state
  const keys = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jumpQueued: false,
    shift: false,
  };

  function setKey(e, isDown) {
    if (isGameOver || isGameWon) return;
    if (e.code === "Space") {
      // Queue a jump on keydown only (prevents repeat spam)
      if (isDown && !e.repeat) keys.jumpQueued = true;
      e.preventDefault();
      return;
    }
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
      keys.shift = isDown;
      e.preventDefault();
      return;
    }
    switch (e.code) {
      case "KeyW":
      case "ArrowUp":
        keys.forward = isDown;
        break;
      case "KeyS":
      case "ArrowDown":
        keys.back = isDown;
        break;
      case "KeyA":
      case "ArrowLeft":
        keys.left = isDown;
        break;
      case "KeyD":
      case "ArrowRight":
        keys.right = isDown;
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  window.addEventListener("keydown", (e) => setKey(e, true));
  window.addEventListener("keyup", (e) => setKey(e, false));

  // Left-click: throw dagger-boomerang (RMB is reserved for camera orbit)
  window.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (isGameOver || isGameWon) return;
    boomerang.tryThrow(character, cameraYaw);
  });

  // Third-person camera orbit (right-click drag)
  // Follows the character root (HumanoidRootPart equivalent) and pivots around upper torso/head.
  let cameraTarget = new THREE.Vector3(0, 1.2, 0);
  let cameraYaw = 0;
  let cameraPitch = 0.25;
  const cameraHeight = 1.6;
  let cameraDistance = 5.5;
  const cameraDistanceMin = 2.0;
  const cameraDistanceMax = 14.0;
  const pitchMin = -0.35;
  const pitchMax = 1.05;
  const cameraFollowSharpness = 18; // higher = snappier follow

  let isRmbDown = false;
  let lastMouseX = 0;
  let lastMouseY = 0;
  const mouseSensitivity = 0.004;
  const zoomSensitivity = 0.0012; // higher = faster zoom

  renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
  renderer.domElement.addEventListener(
    "wheel",
    (e) => {
      // Scroll down (positive deltaY) => zoom out (increase distance)
      // Use exponential scaling for consistent feel across distances.
      e.preventDefault();
      const zoomFactor = Math.exp(e.deltaY * zoomSensitivity);
      cameraDistance = THREE.MathUtils.clamp(
        cameraDistance * zoomFactor,
        cameraDistanceMin,
        cameraDistanceMax
      );
    },
    { passive: false }
  );
  renderer.domElement.addEventListener("mousedown", (e) => {
    if (e.button !== 2) return;
    isRmbDown = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  });
  window.addEventListener("mouseup", (e) => {
    if (e.button !== 2) return;
    isRmbDown = false;
  });
  window.addEventListener("mousemove", (e) => {
    if (!isRmbDown) return;
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    cameraYaw -= dx * mouseSensitivity;
    cameraPitch -= dy * mouseSensitivity;
    cameraPitch = THREE.MathUtils.clamp(cameraPitch, pitchMin, pitchMax);
  });

  // Character model (GLTF)
  let character = null;
  let mixer = null;
  let idleAction = null;
  let walkAction = null;
  let runAction = null;
  let jumpAction = null;
  let loseAction = null;
  let activeAction = null;
  let characterHeight = 1.7;
  let isJumping = false;
  let isGameOver = false;
  let gameOverUiShown = false;
  let isGameWon = false;
  let gameWonUiShown = false;

  function fadeToAction(nextAction, duration = 0.15) {
    if (!nextAction || nextAction === activeAction) return;
    nextAction.reset().play();
    if (activeAction) nextAction.crossFadeFrom(activeAction, duration, true);
    activeAction = nextAction;
  }

  function showGameOverUi() {
    if (gameOverUiShown) return;
    gameOverUiShown = true;

    const root = document.createElement("div");
    root.id = "zombie-recoil-gameover";
    root.innerHTML = `
      <div class="panel">
        <div class="title">You lose</div>
        <button class="btn" type="button">Try again</button>
      </div>
    `;
    document.body.appendChild(root);

    const style = document.createElement("style");
    style.setAttribute("data-zombie-recoil-gameover-style", "true");
    style.textContent = `
      #zombie-recoil-gameover{
        position: fixed;
        inset: 0;
        z-index: 1000;
        display: grid;
        place-items: center;
        background: rgba(0,0,0,0.72);
        backdrop-filter: blur(6px);
        pointer-events: auto;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
        color: #e9f0ff;
      }
      #zombie-recoil-gameover .panel{
        width: min(420px, calc(100vw - 32px));
        border-radius: 16px;
        padding: 18px 16px;
        background: rgba(10,16,26,0.92);
        border: 1px solid rgba(255,255,255,0.14);
        box-shadow: 0 18px 60px rgba(0,0,0,0.55);
        text-align: center;
      }
      #zombie-recoil-gameover .title{
        font-size: 20px;
        font-weight: 850;
        letter-spacing: 0.02em;
        margin-bottom: 14px;
      }
      #zombie-recoil-gameover .btn{
        width: 100%;
        padding: 12px 14px;
        border-radius: 12px;
        border: 2px solid rgba(110,231,255,0.85);
        background: rgba(110,231,255,0.18);
        color: #e9f0ff;
        cursor: pointer;
        font-weight: 800;
        text-transform: lowercase;
        letter-spacing: 0.04em;
      }
      #zombie-recoil-gameover .btn:hover{
        background: rgba(110,231,255,0.26);
      }
    `;
    document.head.appendChild(style);

    const btn = root.querySelector("button");
    btn?.addEventListener("click", () => {
      window.location.reload();
    });
  }

  function showWinUi({ health, timeSeconds }) {
    if (gameWonUiShown) return;
    gameWonUiShown = true;

    const root = document.createElement("div");
    root.id = "zombie-recoil-win";
    root.innerHTML = `
      <div class="panel">
        <div class="title">You win</div>
        <div class="details">
          <div class="row"><span class="k">health</span><span class="v">${health}</span></div>
          <div class="row"><span class="k">time</span><span class="v">${timeSeconds.toFixed(1)}s</span></div>
        </div>
        <button class="btn" type="button">play again</button>
      </div>
    `;
    document.body.appendChild(root);

    const style = document.createElement("style");
    style.setAttribute("data-zombie-recoil-win-style", "true");
    style.textContent = `
      #zombie-recoil-win{
        position: fixed;
        inset: 0;
        z-index: 1000;
        display: grid;
        place-items: center;
        background: rgba(0,0,0,0.72);
        backdrop-filter: blur(6px);
        pointer-events: auto;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
        color: #e9f0ff;
      }
      #zombie-recoil-win .panel{
        width: min(460px, calc(100vw - 32px));
        border-radius: 16px;
        padding: 18px 16px;
        background: rgba(10,16,26,0.92);
        border: 1px solid rgba(255,255,255,0.14);
        box-shadow: 0 18px 60px rgba(0,0,0,0.55);
        text-align: center;
      }
      #zombie-recoil-win .title{
        font-size: 22px;
        font-weight: 900;
        letter-spacing: 0.02em;
        margin-bottom: 12px;
      }
      #zombie-recoil-win .details{
        margin: 10px 0 14px;
        padding: 10px 12px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.10);
        background: rgba(255,255,255,0.06);
        text-align: left;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 13px;
      }
      #zombie-recoil-win .row{
        display: flex;
        justify-content: space-between;
        padding: 6px 0;
      }
      #zombie-recoil-win .k{ opacity: 0.85; }
      #zombie-recoil-win .v{ font-weight: 850; }
      #zombie-recoil-win .btn{
        width: 100%;
        padding: 12px 14px;
        border-radius: 12px;
        border: 2px solid rgba(52,211,153,0.85);
        background: rgba(52,211,153,0.16);
        color: #e9f0ff;
        cursor: pointer;
        font-weight: 900;
        text-transform: lowercase;
        letter-spacing: 0.04em;
      }
      #zombie-recoil-win .btn:hover{
        background: rgba(52,211,153,0.24);
      }
    `;
    document.head.appendChild(style);

    root.querySelector("button")?.addEventListener("click", () => {
      window.location.reload();
    });
  }

  function triggerGameOver() {
    if (isGameOver) return;
    isGameOver = true;

    // Stop all motion immediately (no sliding / no mid-air freeze weirdness)
    velocity.set(0, 0, 0);
    verticalVelocity = 0;
    isJumping = false;
    keys.jumpQueued = false;

    if (loseAction) {
      fadeToAction(loseAction, 0.08);
    } else {
      // No clip available; still show the modal.
      showGameOverUi();
    }
  }

  function triggerWin() {
    if (isGameOver || isGameWon) return;
    isGameWon = true;

    velocity.set(0, 0, 0);
    verticalVelocity = 0;
    isJumping = false;
    keys.jumpQueued = false;

    const timeSeconds = (performance.now() - runStartedAt) / 1000;
    showWinUi({ health: Math.round(combatSystem.playerHp), timeSeconds });
  }

  const tmpOffset = new THREE.Vector3();
  class ThirdPersonCamera {
    constructor(params) {
      this._camera = params.camera;
      this._currentPosition = new THREE.Vector3();
      this._currentLookat = new THREE.Vector3();
      this._idealPosition = new THREE.Vector3();
      this._idealLookat = new THREE.Vector3();
    }

    Update(dt, targetPosition, pivotOffset) {
      // Orbit direction from yaw/pitch (world-space)
      const cosP = Math.cos(cameraPitch);
      const sinP = Math.sin(cameraPitch);
      tmpOffset.set(Math.sin(cameraYaw) * cosP, sinP, Math.cos(cameraYaw) * cosP);
      tmpOffset.multiplyScalar(cameraDistance);
      tmpOffset.y += cameraHeight;

      this._idealPosition.copy(targetPosition).add(pivotOffset).add(tmpOffset);
      this._idealLookat.copy(targetPosition).add(pivotOffset);

      const t = 1.0 - Math.pow(0.001, dt * cameraFollowSharpness);
      this._currentPosition.lerp(this._idealPosition, t);
      this._currentLookat.lerp(this._idealLookat, t);

      this._camera.position.copy(this._currentPosition);
      this._camera.lookAt(this._currentLookat);
    }
  }

  const thirdPersonCamera = new ThirdPersonCamera({ camera });

  const gltfLoader = new GLTFLoader();
  gltfLoader.load(
    `${BASE_URL}character/scene.gltf`,
    (gltf) => {
      character = gltf.scene;
      character.position.set(0, 0, 0);

      character.traverse((obj) => {
        if (obj.isMesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
          if (obj.material) obj.material.needsUpdate = true;
        }
      });

      // Make sure the character is visible: normalize scale and sit on ground (y=0)
      const box = new THREE.Box3().setFromObject(character);
      const size = box.getSize(new THREE.Vector3());

      const targetHeight = 1.7;
      const safeHeight = Math.max(1e-6, size.y);
      const scale = targetHeight / safeHeight;
      character.scale.setScalar(scale);

      // Recompute after scaling, then align bottom to y=0 and center to x/z=0
      const box2 = new THREE.Box3().setFromObject(character);
      const center2 = box2.getCenter(new THREE.Vector3());
      character.position.x += -center2.x;
      character.position.z += -center2.z;
      character.position.y += -box2.min.y;

      // Cache character height for camera pivot (head/upper torso)
      characterHeight = Math.max(1e-6, box2.getSize(new THREE.Vector3()).y);
      cameraTarget = new THREE.Vector3(0, characterHeight * 0.85, 0);

      // Default facing direction: keep the same as current behavior
      character.rotation.y = Math.PI;

      // Animations
      const clips = gltf.animations || [];
      console.log("Character animations:", clips.map((c) => c.name));
      if (clips.length > 0) {
        mixer = new THREE.AnimationMixer(character);

        const byName = (needle) => clips.find((c) => c.name?.toLowerCase().includes(needle));
        const idleClip = clips[0] || byName("idle") || clips[0];
        const walkClip = clips[1] || byName("walk") || clips[0];
        const runClip = clips[2] || byName("run") || clips[1] || clips[0];
        const jumpClip =
          byName("jump") ||
          byName("hop") ||
          byName("leap") ||
          byName("air");
        const loseClip =
          byName("lose") ||
          byName("loose") ||
          byName("death") ||
          byName("die") ||
          byName("defeat") ||
          byName("dead");

        idleAction = mixer.clipAction(idleClip);
        walkAction = mixer.clipAction(walkClip);
        runAction = mixer.clipAction(runClip);
        if (jumpClip) {
          jumpAction = mixer.clipAction(jumpClip);
          jumpAction.setLoop(THREE.LoopOnce, 1);
          jumpAction.clampWhenFinished = true;
        }
        if (loseClip) {
          loseAction = mixer.clipAction(loseClip);
          loseAction.setLoop(THREE.LoopOnce, 1);
          loseAction.clampWhenFinished = true;
        }

        fadeToAction(idleAction, 0);

        mixer.addEventListener("finished", (ev) => {
          // If the jump clip ends mid-air, we still keep the jump state until we land.
          if (jumpAction && ev?.action === jumpAction) {
            // allow locomotion switching again (unless we're still airborne)
            if (character && character.position.y <= 0.0001) isJumping = false;
          }
          if (loseAction && ev?.action === loseAction) {
            showGameOverUi();
          }
        });
      }

      scene.add(character);
    },
    (event) => {
      if (!event?.total) return;
      const pct = ((event.loaded / event.total) * 100).toFixed(1);
      console.log(`Character loading: ${pct}%`);
    },
    (err) => {
      console.error("Failed to load character model:", err);
    }
  );

  const velocity = new THREE.Vector3(); // world-space velocity
  const moveDir = new THREE.Vector3();
  const cameraForward = new THREE.Vector3();
  const cameraRight = new THREE.Vector3();
  const tmpVec = new THREE.Vector3();

  const baseMoveSpeed = 4.5; // world units / sec
  const sprintMultiplier = 1.6;
  const accelSharpness = 22; // higher = quicker to target speed
  const decelSharpness = 28; // higher = quicker stop
  const rotationSharpness = 18; // higher = quicker turn toward target

  let currentYaw = Math.PI; // matches default facing

  // Jump / gravity (simple; ground plane at y=0)
  let verticalVelocity = 0;
  let isGrounded = true;
  const jumpSpeed = 6.2;
  const gravity = 18.0;

  function deltaAngle(a, b) {
    // shortest signed difference from a -> b
    const d = (b - a + Math.PI) % (Math.PI * 2) - Math.PI;
    return d < -Math.PI ? d + Math.PI * 2 : d;
  }

  function dampAngle(current, target, dt, sharpness) {
    const t = 1.0 - Math.pow(0.001, dt * sharpness);
    return current + deltaAngle(current, target) * t;
  }

  function updateMovement(dt) {
    if (!character) return;
    if (isGameOver || isGameWon) return;

    // Jump request (Spacebar)
    if (keys.jumpQueued) {
      keys.jumpQueued = false;
      if (isGrounded) {
        verticalVelocity = jumpSpeed;
        isGrounded = false;
        isJumping = true;
        if (jumpAction) fadeToAction(jumpAction, 0.06);
      }
    }

    // Camera-relative movement:
    // - RMB updates cameraYaw/cameraPitch.
    // - Build horizontal camera forward/right vectors from cameraYaw only.
    // - Blend WASD against those axes so movement follows the current camera heading.
    const inputX = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const inputZ = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0);

    cameraForward.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
    cameraRight.set(-cameraForward.z, 0, cameraForward.x);

    moveDir
      .set(0, 0, 0)
      .addScaledVector(cameraRight, inputX)
      .addScaledVector(cameraForward, inputZ);

    const hasInput = moveDir.lengthSq() > 0;
    if (hasInput) moveDir.normalize();

    const desiredVelocity = tmpVec.set(0, 0, 0);
    if (hasInput) {
      const targetYaw = Math.atan2(moveDir.x, moveDir.z);
      currentYaw = dampAngle(currentYaw, targetYaw, dt, rotationSharpness);
      character.rotation.y = currentYaw;

      const isSprinting = keys.shift && hasInput;
      const maxSpeed = isSprinting ? baseMoveSpeed * sprintMultiplier : baseMoveSpeed;
      desiredVelocity.copy(moveDir).multiplyScalar(maxSpeed);
    }

    // Smooth accel/decel toward desired velocity
    const sharpness = hasInput ? accelSharpness : decelSharpness;
    const t = 1.0 - Math.pow(0.001, dt * sharpness);
    velocity.lerp(desiredVelocity, t);

    // Snap to exact stop when input is released and we're nearly stopped
    if (!hasInput && velocity.lengthSq() < 0.0002) velocity.set(0, 0, 0);

    // Collision: only check nearest 5-10 placed objects
    const move = collisionDelta.copy(velocity).multiplyScalar(dt);

    // Gather nearest candidates by XZ distance (cheap)
    if (gamePlacements.length) {
      const candidates = [];
      const px = character.position.x;
      const pz = character.position.z;
      for (const pl of gamePlacements) {
        const dx = pl.position.x - px;
        const dz = pl.position.z - pz;
        const d2 = dx * dx + dz * dz;
        candidates.push({ d2, pl });
      }
      candidates.sort((a, b) => a.d2 - b.d2);
      const closest = candidates.slice(0, 10);
      const boxes = [];
      for (const c of closest) {
        const b = computeInstanceBox(c.pl.type, c.pl);
        if (b) boxes.push(b.clone());
      }
      const resolved = resolveSlide(character.position, move, boxes);
      character.position.add(resolved);
    } else {
      character.position.add(move);
    }

    // Gravity + ground clamp
    verticalVelocity -= gravity * dt;
    character.position.y += verticalVelocity * dt;
    if (character.position.y <= 0) {
      character.position.y = 0;
      verticalVelocity = 0;
      isGrounded = true;
      isJumping = false;
    } else {
      isGrounded = false;
    }
  }

  window.addEventListener("resize", () => onResize(camera));

  let lastTime = performance.now();
  function animate() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    updateMovement(dt);

    // NPC + combat (math-only)
    const isEnded = isGameOver || isGameWon;
    if (!isEnded) zombieManager.update(dt, character?.position ?? null);
    boomerang.update(dt, character, cameraYaw);
    if (character) {
      if (!isEnded) combatSystem.update(dt, { x: character.position.x, z: character.position.z });
      hud.update(combatSystem.playerHp, zombieManager.kills);
      if (combatSystem.playerHp <= 0) triggerGameOver();
      if (!isEnded && zombieManager.isWaveComplete?.()) triggerWin();
    } else {
      hud.update(combatSystem.playerHp, zombieManager.kills);
    }

    // Camera should follow the character position, but movement must not drive camera yaw/pitch.
    if (character) thirdPersonCamera.Update(dt, character.position, cameraTarget);

    if (mixer) mixer.update(dt);

    // Animation state selection based on movement speed
    const speed = velocity.length();
    if (idleAction && walkAction && runAction) {
      if (!isJumping || !jumpAction) {
        if (isGameOver) {
          if (loseAction) fadeToAction(loseAction, 0.01);
          else fadeToAction(idleAction, 0.01);
        } else {
          const isSprinting = keys.shift && (keys.forward || keys.back || keys.left || keys.right);
          const maxSpeed = isSprinting ? baseMoveSpeed * sprintMultiplier : baseMoveSpeed;
          if (speed < 0.05) fadeToAction(idleAction);
          else if (isSprinting) fadeToAction(runAction);
          else if (speed < maxSpeed * 0.75) fadeToAction(walkAction);
          else fadeToAction(runAction);
        }
      }
    }

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();
}

