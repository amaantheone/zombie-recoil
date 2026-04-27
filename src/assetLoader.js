import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";

const BASE_URL = import.meta.env.BASE_URL;

const DEFAULT_PREFAB_URLS = {
  House: `${BASE_URL}prefabs/house.glb`,
  Silo: `${BASE_URL}prefabs/silo.glb`,
  Frame: `${BASE_URL}prefabs/frame.glb`,
  Barricade: `${BASE_URL}prefabs/barricade.glb`,
};

function cloneObject3D(obj) {
  // Handles both normal hierarchies and potential skinned meshes.
  return SkeletonUtils.clone(obj);
}

function makePlaceholderPrefab({ label = "MissingPrefab" } = {}) {
  const group = new THREE.Group();
  group.name = label;
  group.userData.isPlaceholder = true;
  group.userData.placeholderLabel = label;

  const geom = new THREE.BoxGeometry(6, 6, 6);
  geom.translate(0, 3, 0); // sit on y=0

  const mat = new THREE.MeshStandardMaterial({
    color: 0xff4d4d,
    roughness: 1.0,
    metalness: 0.0,
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = `${label}Box`;
  group.add(mesh);
  return group;
}

function freezeStaticTransforms(root) {
  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    if (!o) return;
    o.frustumCulled = true;
    // These are static props; freezing saves per-frame matrix work.
    o.matrixAutoUpdate = false;
    if (o.isObject3D) o.updateMatrix();
    if (o.isMesh) {
      o.frustumCulled = true;
      o.updateMatrix();
    }
  });
  root.updateWorldMatrix(true, true);
}

function applyNonBlackMaterials(root) {
  const white = new THREE.Color(0xffffff);
  const black = new THREE.Color(0x000000);
  root.traverse((o) => {
    if (!o?.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (m.color) m.color.copy(white);
      if (m.emissive) m.emissive.copy(black);
      m.needsUpdate = true;
    }
  });
}

function computeBaseYOffset(root, fallback = 0) {
  try {
    const box = new THREE.Box3().setFromObject(root);
    const minY = box.min?.y;
    if (Number.isFinite(minY)) return -minY;
  } catch {
    // ignore
  }
  return fallback;
}

async function urlExists(url) {
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-cache" });
    return res.ok;
  } catch {
    return false;
  }
}

function toGhostMaterial(mat) {
  const mk = (m) => {
    const base = m?.isMeshStandardMaterial ? m.clone() : new THREE.MeshStandardMaterial();
    if (m?.color) base.color.copy(m.color);
    if (m?.map) base.map = m.map;
    if (m?.normalMap) base.normalMap = m.normalMap;
    if (m?.roughnessMap) base.roughnessMap = m.roughnessMap;
    if (m?.metalnessMap) base.metalnessMap = m.metalnessMap;
    if (m?.aoMap) base.aoMap = m.aoMap;
    if (m?.emissiveMap) base.emissiveMap = m.emissiveMap;
    if (m?.emissive) base.emissive.copy(m.emissive);
    base.transparent = true;
    base.opacity = 0.5;
    base.depthWrite = false;
    base.needsUpdate = true;
    return base;
  };
  if (Array.isArray(mat)) return mat.map(mk);
  return mk(mat);
}

function applyGhostMaterials(root) {
  root.traverse((o) => {
    if (!o?.isMesh) return;
    o.material = toGhostMaterial(o.material);
  });
}

function collectMeshParts(root) {
  const meshes = [];
  root.updateWorldMatrix(true, true);
  const invRootWorld = new THREE.Matrix4().copy(root.matrixWorld).invert();
  root.traverse((o) => {
    if (!o?.isMesh || !o.geometry || !o.material) return;
    o.updateWorldMatrix(true, false);
    const localToRoot = new THREE.Matrix4().multiplyMatrices(invRootWorld, o.matrixWorld);
    meshes.push({
      geometry: o.geometry,
      material: o.material,
      localToRoot,
      name: o.name,
    });
  });
  return meshes;
}

export class AssetLoader {
  /**
   * @param {{ prefabUrls?: Partial<Record<"House"|"Silo"|"Frame"|"Barricade", string>> }} opts
   */
  constructor(opts = {}) {
    this.prefabUrls = { ...DEFAULT_PREFAB_URLS, ...(opts.prefabUrls ?? {}) };
    this._gltfLoader = new GLTFLoader();
    this._draco = new DRACOLoader();
    // Needed for many exported/compressed GLBs.
    this._draco.setDecoderPath("/node_modules/three/examples/jsm/libs/draco/");
    this._gltfLoader.setDRACOLoader(this._draco);
    this._gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    this._objLoader = new OBJLoader();
    this._mtlLoader = new MTLLoader();
    /** @type {Map<string, Promise<THREE.Object3D>>} */
    this._cache = new Map();
  }

  async checkAssets(types) {
    const result = { missing: [], present: [] };
    for (const t of types) {
      const url = this.prefabUrls[t];
      const ok = await urlExists(url);
      if (ok) result.present.push({ type: t, url });
      else result.missing.push({ type: t, url });
    }
    return result;
  }

  async preloadAll(types) {
    await Promise.all(types.map((t) => this.loadPrefab(t).catch(() => null)));
  }

  createInstancedSetFromPrefab(root, count, { capacity = null, enableInstanceColors = false } = {}) {
    const parts = collectMeshParts(root);
    const group = new THREE.Group();
    const max = Math.max(1, capacity ?? count);
    for (const part of parts) {
      const mat = part.material?.clone?.() ?? part.material;
      if (enableInstanceColors && mat) {
        mat.vertexColors = true;
        mat.needsUpdate = true;
      }
      const inst = new THREE.InstancedMesh(part.geometry, mat, max);
      inst.userData.localToRoot = part.localToRoot;
      inst.userData.partName = part.name;
      inst.count = count;
      inst.frustumCulled = true;
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (enableInstanceColors) {
        inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
      }
      group.add(inst);
    }
    return { group, parts: group.children };
  }

  async loadPrefab(type) {
    if (this._cache.has(type)) return this._cache.get(type);
    const url = this.prefabUrls[type];
    const p = this._loadAny(url).then((obj) => {
      obj.userData.type = type;
      return obj;
    });
    this._cache.set(type, p);
    return p;
  }

  async createEditorClone(type, { ghost = false } = {}) {
    const base = await this.loadPrefab(type);
    const clone = cloneObject3D(base);
    clone.userData.type = type;
    if (ghost) applyGhostMaterials(clone);
    return clone;
  }

  /**
   * Build a Group of InstancedMeshes that matches the prefab model hierarchy.
   * For each mesh-part in the source prefab, we create one InstancedMesh so multi-material models still match.
   */
  async createInstancedGroup(type, placements) {
    const base = await this.loadPrefab(type);
    const parts = collectMeshParts(base);
    const group = new THREE.Group();
    group.name = `${type}InstancedGroup`;

    const count = placements.length;
    const dummy = new THREE.Object3D();
    const instanceMatrix = new THREE.Matrix4();
    const finalMatrix = new THREE.Matrix4();

    for (const part of parts) {
      const inst = new THREE.InstancedMesh(part.geometry, part.material, Math.max(1, count));
      inst.count = count;
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      for (let i = 0; i < count; i++) {
        const p = placements[i];
        dummy.position.set(p?.position?.x ?? 0, p?.position?.y ?? 0, p?.position?.z ?? 0);
        dummy.rotation.set(0, p?.rotation?.y ?? 0, 0);
        dummy.scale.setScalar(p?.scale ?? 1.0);
        dummy.updateMatrix();

        instanceMatrix.copy(dummy.matrix);
        finalMatrix.multiplyMatrices(instanceMatrix, part.localToRoot);
        inst.setMatrixAt(i, finalMatrix);
      }

      inst.instanceMatrix.needsUpdate = true;
      group.add(inst);
    }

    return group;
  }

  async _loadAny(url) {
    const lower = url.toLowerCase();
    if (lower.endsWith(".glb") || lower.endsWith(".gltf")) {
      try {
        const exists = await urlExists(url);
        if (!exists) return makePlaceholderPrefab({ label: `MissingFile:${url}` });

        const gltf = await new Promise((resolve, reject) => {
          this._gltfLoader.load(url, resolve, undefined, reject);
        });
        const scene = gltf.scene ?? gltf.scenes?.[0] ?? new THREE.Group();
        // Avoid "pitch black silhouettes" from weird export materials.
        applyNonBlackMaterials(scene);

        // Compute grounding offset (unscaled). Consumers apply scaling before using it.
        const typeGuess =
          lower.includes("house") ? "House" :
          lower.includes("silo") ? "Silo" :
          lower.includes("frame") ? "Frame" :
          lower.includes("barricade") ? "Barricade" :
          null;
        const fallback =
          typeGuess === "House" ? 1.5 :
          typeGuess === "Silo" ? 4.0 :
          typeGuess === "Frame" ? 6.0 :
          typeGuess === "Barricade" ? 0.5 :
          0;
        scene.userData.baseYOffset = computeBaseYOffset(scene, fallback);

        freezeStaticTransforms(scene);
        console.log(`[AssetLoader] Loaded prefab: ${url}`);
        return scene;
      } catch (e) {
        console.log(`[AssetLoader] Failed to load prefab: ${url}`, e);
        return makePlaceholderPrefab({ label: `MissingGLB:${url}` });
      }
    }

    if (lower.endsWith(".obj")) {
      // If a matching .mtl exists, try it first.
      const mtlUrl = url.replace(/\.obj$/i, ".mtl");
      try {
        const mats = await new Promise((resolve, reject) => {
          this._mtlLoader.load(mtlUrl, resolve, undefined, reject);
        });
        mats.preload();
        this._objLoader.setMaterials(mats);
      } catch {
        // ok if no mtl
      }
      const obj = await new Promise((resolve, reject) => {
        this._objLoader.load(url, resolve, undefined, reject);
      });
      return obj;
    }

    return makePlaceholderPrefab({ label: `Unsupported:${url}` });
  }
}

