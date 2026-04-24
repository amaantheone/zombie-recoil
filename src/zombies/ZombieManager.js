import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const DEFAULTS = Object.freeze({
  maxZombies: 256,
  speed: 1.35,
  spawnEverySeconds: 1.0,
  hp: 100,
  hitFlashSeconds: 0.08,
  deathShrinkSeconds: 0.25,
  targetHeight: 1.7,
  walkBobAmp: 0.05,
  walkBobHz: 2.4,
  walkSwayRad: 0.10,
});

export class ZombieManager {
  /**
   * @param {{
   *  scene: THREE.Scene,
   *  bounds: {minX:number,maxX:number,minZ:number,maxZ:number},
   *  maxZombies?: number,
   *  speed?: number,
   *  spawnEverySeconds?: number,
   *  hp?: number,
   *  modelScale?: number,
   * }} params
   */
  constructor(params) {
    this.scene = params.scene;
    this.bounds = params.bounds;
    this.maxZombies = params.maxZombies ?? DEFAULTS.maxZombies;
    this.speed = params.speed ?? DEFAULTS.speed;
    this.spawnEverySeconds = params.spawnEverySeconds ?? DEFAULTS.spawnEverySeconds;
    this.baseHp = params.hp ?? DEFAULTS.hp;
    this.modelScale = params.modelScale ?? 2;

    // SoA (hot paths)
    this.posX = new Float32Array(this.maxZombies);
    this.posZ = new Float32Array(this.maxZombies);
    this.yaw = new Float32Array(this.maxZombies);
    this.hp = new Float32Array(this.maxZombies);
    this.hitFlashT = new Float32Array(this.maxZombies);
    this.hitCooldownT = new Float32Array(this.maxZombies);
    this.deathT = new Float32Array(this.maxZombies);
    this.dying = new Uint8Array(this.maxZombies); // 0/1

    this.count = 0;
    this.kills = 0;
    this._spawnT = 0;

    // Base zombie should keep its original model/texture.
    // Hit flash is rendered using a lightweight overlay InstancedMesh.
    this._colAlive = new THREE.Color(0xffffff);
    this._colHit = new THREE.Color(0xffffff);
    // Visuals:
    // - Start with a cheap placeholder InstancedMesh immediately.
    // - Then try to load `/zombie/scene.gltf` and replace it with a better InstancedMesh.
    this._modelScale = 1;
    this._baseYOffset = 0;
    this._animTime = 0;

    this.mesh = this._createPlaceholderInstancedMesh();
    this.scene.add(this.mesh);
    this.hitOverlayMesh = this._createHitOverlayFor(this.mesh.geometry);
    this.scene.add(this.hitOverlayMesh);
    this._tryLoadZombieGLB("/zombie/scene.gltf");

    // Reused temps
    this._tmpObj = new THREE.Object3D();
    this._tmpMat = new THREE.Matrix4();
    this._eps = 1e-6;
  }

  _createPlaceholderInstancedMesh() {
    const geom = new THREE.BoxGeometry(0.8, 1.8, 0.8);
    geom.translate(0, 0.9, 0); // feet on ground
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4ade80,
      roughness: 0.95,
      metalness: 0.0,
    });
    const mesh = new THREE.InstancedMesh(geom, mat, this.maxZombies);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = this.count;
    return mesh;
  }

  _createHitOverlayFor(geometry) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const overlay = new THREE.InstancedMesh(geometry, mat, this.maxZombies);
    overlay.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    overlay.frustumCulled = false;
    overlay.castShadow = false;
    overlay.receiveShadow = false;
    overlay.count = 0;
    return overlay;
  }

  _disposeInstancedMesh(inst) {
    inst?.geometry?.dispose?.();
    inst?.material?.dispose?.();
  }

  _disposeInstancedMeshes(arr) {
    if (!arr) return;
    for (const m of arr) this._disposeInstancedMesh(m);
  }

  _collectMeshParts(root) {
    const meshes = [];
    root.updateWorldMatrix(true, true);
    const invRootWorld = new THREE.Matrix4().copy(root.matrixWorld).invert();
    root.traverse((o) => {
      if (!o?.isMesh || !o.geometry || !o.material) return;
      o.updateWorldMatrix(true, false);
      const localToRoot = new THREE.Matrix4().multiplyMatrices(invRootWorld, o.matrixWorld);
      meshes.push({ geometry: o.geometry, material: o.material, localToRoot });
    });
    return meshes;
  }

  _computeScaleAndYOffset(root) {
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const h = Math.max(1e-6, size.y);
    const scale = Number.isFinite(this.modelScale) ? this.modelScale : DEFAULTS.targetHeight / h;
    const baseYOffset = -box.min.y * scale + 0.01; // tiny lift to avoid z-fighting/clipping
    return { scale, baseYOffset };
  }

  _extractFirstMesh(root) {
    let found = null;
    root.traverse((o) => {
      if (found) return;
      if (o?.isMesh && o.geometry && o.material) found = o;
    });
    return found;
  }

  _tryLoadZombieGLB(url) {
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        const root = gltf.scene ?? gltf.scenes?.[0];
        if (!root) return;

        const parts = this._collectMeshParts(root);
        if (!parts.length) return;

        const { scale, baseYOffset } = this._computeScaleAndYOffset(root);
        this._modelScale = scale;
        this._baseYOffset = baseYOffset;

        // Build instanced meshes for every part (so we don't end up with "hands only").
        const newMeshes = [];
        const newOverlays = [];
        for (const p of parts) {
          const inst = new THREE.InstancedMesh(p.geometry, p.material, this.maxZombies);
          inst.userData.localToRoot = p.localToRoot;
          inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          inst.castShadow = true;
          inst.receiveShadow = true;
          inst.frustumCulled = false;
          inst.count = this.count;
          newMeshes.push(inst);

          const overlay = this._createHitOverlayFor(p.geometry);
          overlay.userData.localToRoot = p.localToRoot;
          newOverlays.push(overlay);
        }

        // Swap out placeholder single-mesh mode.
        this.scene.remove(this.mesh);
        this._disposeInstancedMesh(this.mesh);
        this.mesh = null;

        this.scene.remove(this.hitOverlayMesh);
        this._disposeInstancedMesh(this.hitOverlayMesh);
        this.hitOverlayMesh = null;

        // Remove old multi-part if any.
        if (this.meshParts) {
          for (const m of this.meshParts) this.scene.remove(m);
          this._disposeInstancedMeshes(this.meshParts);
        }
        if (this.hitOverlayParts) {
          for (const m of this.hitOverlayParts) this.scene.remove(m);
          this._disposeInstancedMeshes(this.hitOverlayParts);
        }

        this.meshParts = newMeshes;
        this.hitOverlayParts = newOverlays;
        for (const m of this.meshParts) this.scene.add(m);
        for (const m of this.hitOverlayParts) this.scene.add(m);

        // Re-upload current zombie transforms/colors
        for (let i = 0; i < this.count; i++) {
          this._writeMatrixAt(i, this.dying[i] ? 0.001 : 1);
        }
        for (const m of this.meshParts) m.instanceMatrix.needsUpdate = true;
      },
      undefined,
      () => {
        // Keep placeholder
      }
    );
  }

  dispose() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry?.dispose?.();
      this.mesh.material?.dispose?.();
    }
    if (this.hitOverlayMesh) {
      this.scene.remove(this.hitOverlayMesh);
      this.hitOverlayMesh?.geometry?.dispose?.();
      this.hitOverlayMesh?.material?.dispose?.();
    }
    if (this.meshParts) {
      for (const m of this.meshParts) this.scene.remove(m);
      this._disposeInstancedMeshes(this.meshParts);
    }
    if (this.hitOverlayParts) {
      for (const m of this.hitOverlayParts) this.scene.remove(m);
      this._disposeInstancedMeshes(this.hitOverlayParts);
    }
  }

  getPositionsArrays() {
    return { posX: this.posX, posZ: this.posZ, count: this.count };
  }

  damageZombie(i, damage, { flash = true } = {}) {
    if (i < 0 || i >= this.count) return false;
    if (this.dying[i]) return false;
    const next = (this.hp[i] -= damage);
    if (flash) this.hitFlashT[i] = DEFAULTS.hitFlashSeconds;
    if (next <= 0) {
      this._startDying(i);
      return true;
    }
    return false;
  }

  flashZombie(i) {
    if (i < 0 || i >= this.count) return;
    if (this.dying[i]) return;
    this.hitFlashT[i] = DEFAULTS.hitFlashSeconds;
  }

  _startDying(i) {
    this.dying[i] = 1;
    this.deathT[i] = 0;
    this.kills++;
  }

  _removeAt(i) {
    const last = this.count - 1;
    if (last < 0) return;

    if (i !== last) {
      // swap-last into i
      this.posX[i] = this.posX[last];
      this.posZ[i] = this.posZ[last];
      this.yaw[i] = this.yaw[last];
      this.hp[i] = this.hp[last];
      this.hitFlashT[i] = this.hitFlashT[last];
      this.hitCooldownT[i] = this.hitCooldownT[last];
      this.deathT[i] = this.deathT[last];
      this.dying[i] = this.dying[last];

      // carry instance color + matrix
      if (this.mesh) {
        this.mesh.getMatrixAt(last, this._tmpMat);
        this.mesh.setMatrixAt(i, this._tmpMat);
      } else if (this.meshParts) {
        for (const part of this.meshParts) {
          part.getMatrixAt(last, this._tmpMat);
          part.setMatrixAt(i, this._tmpMat);
        }
      }
    }

    this.count--;
    if (this.mesh) this.mesh.count = this.count;
    if (this.meshParts) for (const m of this.meshParts) m.count = this.count;
  }

  _spawnOne() {
    if (this.count >= this.maxZombies) return;
    const i = this.count++;
    if (this.mesh) this.mesh.count = this.count;
    if (this.meshParts) for (const m of this.meshParts) m.count = this.count;

    const b = this.bounds;
    const side = (Math.random() * 4) | 0;
    let x = 0;
    let z = 0;
    if (side === 0) {
      x = b.minX;
      z = b.minZ + Math.random() * (b.maxZ - b.minZ);
    } else if (side === 1) {
      x = b.maxX;
      z = b.minZ + Math.random() * (b.maxZ - b.minZ);
    } else if (side === 2) {
      z = b.minZ;
      x = b.minX + Math.random() * (b.maxX - b.minX);
    } else {
      z = b.maxZ;
      x = b.minX + Math.random() * (b.maxX - b.minX);
    }

    this.posX[i] = x;
    this.posZ[i] = z;
    this.yaw[i] = 0;
    this.hp[i] = this.baseHp;
    this.hitFlashT[i] = 0;
    this.hitCooldownT[i] = 0;
    this.deathT[i] = 0;
    this.dying[i] = 0;

    // initial matrix + color
    this._writeMatrixAt(i, 1);
  }

  _writeMatrixAt(i, scale = 1) {
    const s = scale * this._modelScale;
    const alive = scale >= 0.999;
    const bob =
      (alive ? DEFAULTS.walkBobAmp : 0) *
      Math.sin((this._animTime * Math.PI * 2) * DEFAULTS.walkBobHz + i * 0.9);
    const sway =
      (alive ? DEFAULTS.walkSwayRad : 0) *
      Math.sin((this._animTime * Math.PI * 2) * (DEFAULTS.walkBobHz * 0.5) + i * 1.7);

    this._tmpObj.position.set(this.posX[i], this._baseYOffset + bob, this.posZ[i]);
    this._tmpObj.rotation.set(0, this.yaw[i] + sway, 0);
    this._tmpObj.scale.setScalar(s);
    this._tmpObj.updateMatrix();
    if (this.mesh) {
      this.mesh.setMatrixAt(i, this._tmpObj.matrix);
      return;
    }
    if (!this.meshParts) return;

    // Multi-part: apply part-local transforms (localToRoot) to the instance root transform.
    const base = this._tmpObj.matrix;
    const final = this._finalMat ?? (this._finalMat = new THREE.Matrix4());
    for (const part of this.meshParts) {
      final.multiplyMatrices(base, part.userData.localToRoot);
      part.setMatrixAt(i, final);
    }
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3|null} playerPos
   */
  update(dt, playerPos) {
    this._animTime += dt;
    // Spawn independent of player load; movement needs player position.
    this._spawnT += dt;
    while (this._spawnT >= this.spawnEverySeconds) {
      this._spawnT -= this.spawnEverySeconds;
      this._spawnOne();
      if (this.count >= this.maxZombies) break;
    }

    if (!playerPos || this.count === 0) {
      // Still need to push instance updates if we spawned.
      if (this.mesh) this.mesh.instanceMatrix.needsUpdate = true;
      if (this.meshParts) for (const m of this.meshParts) m.instanceMatrix.needsUpdate = true;

      if (this.hitOverlayMesh) this.hitOverlayMesh.count = 0;
      if (this.hitOverlayParts) for (const m of this.hitOverlayParts) m.count = 0;
      return;
    }

    const px = playerPos.x;
    const pz = playerPos.z;
    const speedDt = this.speed * dt;

    let overlayCount = 0;

    // Update zombies. Iterate backwards so removals are easy.
    for (let i = this.count - 1; i >= 0; i--) {
      // timers
      if (this.hitFlashT[i] > 0) this.hitFlashT[i] = Math.max(0, this.hitFlashT[i] - dt);
      if (this.hitCooldownT[i] > 0) this.hitCooldownT[i] = Math.max(0, this.hitCooldownT[i] - dt);

      if (this.dying[i]) {
        this.deathT[i] += dt;
        const t = this.deathT[i] / DEFAULTS.deathShrinkSeconds;
        const s = Math.max(0, 1 - t);
        if (s <= 0) {
          this._removeAt(i);
          continue;
        }
        this._writeMatrixAt(i, s);
        continue;
      }

      // Seek in XZ.
      const dx = px - this.posX[i];
      const dz = pz - this.posZ[i];
      const invLen = 1 / Math.sqrt(dx * dx + dz * dz + this._eps);
      const vx = dx * invLen * speedDt;
      const vz = dz * invLen * speedDt;
      this.posX[i] += vx;
      this.posZ[i] += vz;
      this.yaw[i] = Math.atan2(dx, dz);

      this._writeMatrixAt(i, 1);

      // Hit flash overlay (preserves base texture/material)
      if (this.hitFlashT[i] > 0) overlayCount++;
    }

    if (this.mesh) this.mesh.instanceMatrix.needsUpdate = true;
    if (this.meshParts) for (const m of this.meshParts) m.instanceMatrix.needsUpdate = true;

    // Build overlay matrices for flashing zombies.
    if (this.hitOverlayMesh || this.hitOverlayParts) {
      let o = 0;
      for (let i = 0; i < this.count; i++) {
        if (this.hitFlashT[i] <= 0 || this.dying[i]) continue;
        this._writeMatrixAt(i, 1);
        // We just wrote base/parts matrices at index i; reuse computed base matrix for overlays:
        // - single mesh: copy current instance matrix into overlay slot
        if (this.hitOverlayMesh && this.mesh) {
          this.mesh.getMatrixAt(i, this._tmpMat);
          this.hitOverlayMesh.setMatrixAt(o++, this._tmpMat);
        } else if (this.hitOverlayParts && this.meshParts) {
          const base = this._tmpObj.matrix;
          const final = this._finalMat ?? (this._finalMat = new THREE.Matrix4());
          for (let p = 0; p < this.meshParts.length; p++) {
            final.multiplyMatrices(base, this.meshParts[p].userData.localToRoot);
            this.hitOverlayParts[p].setMatrixAt(o, final);
          }
          o++;
        }
      }

      if (this.hitOverlayMesh) {
        this.hitOverlayMesh.count = o;
        this.hitOverlayMesh.instanceMatrix.needsUpdate = true;
      }
      if (this.hitOverlayParts) {
        for (const m of this.hitOverlayParts) {
          m.count = o;
          m.instanceMatrix.needsUpdate = true;
        }
      }
    }
  }
}

