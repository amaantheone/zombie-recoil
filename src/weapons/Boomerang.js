import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const BASE_URL = import.meta.env.BASE_URL;

export const BoomerangState = Object.freeze({
  IDLE: "IDLE",
  THROWN: "THROWN",
  RETURNING: "RETURNING",
});

const DEFAULTS = Object.freeze({
  speed: 14,
  maxDistance: 20,
  spinSpeed: 18, // rad/sec
  radius: 1.5,
  damage: 50,
  returnSnapDistance: 0.6,
  holdHeight: 1.15,
  holdForward: 0.25,
  holdRight: 0.38,
});

export class Boomerang {
  /**
   * @param {{
   *  scene: THREE.Scene,
   *  speed?: number,
   *  maxDistance?: number,
   *  spinSpeed?: number,
   *  radius?: number,
   *  damage?: number,
   * }} params
   */
  constructor(params) {
    this.scene = params.scene;
    this.speed = params.speed ?? DEFAULTS.speed;
    this.maxDistance = params.maxDistance ?? DEFAULTS.maxDistance;
    this.spinSpeed = params.spinSpeed ?? DEFAULTS.spinSpeed;
    this.radius = params.radius ?? DEFAULTS.radius;
    this.damage = params.damage ?? DEFAULTS.damage;

    this.state = BoomerangState.IDLE;
    this.travelled = 0;

    this.pos = new THREE.Vector3(0, DEFAULTS.holdHeight, 0);
    this._dir = new THREE.Vector3(0, 0, -1);
    this._tmp = new THREE.Vector3();
    this._right = new THREE.Vector3(1, 0, 0);

    // Visual: load GLB (fallback to placeholder if needed).
    this.mesh = this._createPlaceholderMesh();
    this.scene.add(this.mesh);
    this._loadModel(`${BASE_URL}boomerang.glb`);
  }

  _createPlaceholderMesh() {
    const geom = new THREE.BoxGeometry(0.08, 0.08, 1.0);
    geom.translate(0, 0, -0.5);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xd7e2ff,
      roughness: 0.35,
      metalness: 0.65,
      emissive: new THREE.Color(0x18233a),
      emissiveIntensity: 0.3,
    });
    const m = new THREE.Mesh(geom, mat);
    m.castShadow = true;
    m.receiveShadow = false;
    return m;
  }

  _loadModel(url) {
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        const root = gltf.scene ?? gltf.scenes?.[0];
        if (!root) return;

        // Swap mesh
        this.scene.remove(this.mesh);
        this.mesh.geometry?.dispose?.();
        this.mesh.material?.dispose?.();

        this.mesh = root;
        this.mesh.traverse((o) => {
          if (!o?.isMesh) return;
          o.castShadow = true;
          o.receiveShadow = false;
        });

        // Scale/orient to feel dagger-like (best-effort defaults).
        this.mesh.scale.setScalar(0.9);
        this.scene.add(this.mesh);
      },
      undefined,
      () => {
        // Keep placeholder
      }
    );
  }

  dispose() {
    this.scene.remove(this.mesh);
    // If it's a loaded scene root, it may contain multiple meshes/materials.
    this.mesh.traverse?.((o) => {
      if (!o?.isMesh) return;
      o.geometry?.dispose?.();
      if (Array.isArray(o.material)) o.material.forEach((m) => m?.dispose?.());
      else o.material?.dispose?.();
    });
    this.mesh.geometry?.dispose?.();
    this.mesh.material?.dispose?.();
  }

  /**
   * Throw forward based on cameraYaw (world-space).
   * @param {{position:THREE.Vector3}|null} player
   * @param {number} cameraYaw
   */
  tryThrow(player, cameraYaw) {
    if (!player) return false;
    if (this.state !== BoomerangState.IDLE) return false;

    // Use character-facing yaw if available, otherwise fall back to camera yaw.
    const yaw = player?.rotation?.y ?? cameraYaw;
    // Forward vector for our yaw convention (matches movement's targetYaw=atan2(x,z)):
    // forward = (sin(yaw), 0, cos(yaw))
    this._dir.set(Math.sin(yaw), 0, Math.cos(yaw)).normalize();

    this.pos.copy(player.position);
    this.pos.y = DEFAULTS.holdHeight;

    this.travelled = 0;
    this.state = BoomerangState.THROWN;
    return true;
  }

  _updateHeldPose(player) {
    const yaw = player?.rotation?.y ?? 0;
    // forward/right from character yaw (movement system)
    this._dir.set(Math.sin(yaw), 0, Math.cos(yaw)); // forward
    this._right.set(Math.cos(yaw), 0, -Math.sin(yaw)); // right

    this.pos.copy(player.position);
    this.pos.y = DEFAULTS.holdHeight;
    this.pos.addScaledVector(this._right, DEFAULTS.holdRight);
    this.pos.addScaledVector(this._dir, DEFAULTS.holdForward);

    // Make it look like it's "held" alongside facing
    this.mesh.rotation.y = yaw;
  }

  /**
   * @param {number} dt
   * @param {{position:THREE.Vector3}|null} player
   * @param {number} cameraYaw
   */
  update(dt, player, cameraYaw) {
    if (!player) return;

    // Keep dagger in-hand in IDLE (camera-facing hold).
    if (this.state === BoomerangState.IDLE) {
      this._updateHeldPose(player);
    } else if (this.state === BoomerangState.THROWN) {
      const step = this.speed * dt;
      this.pos.addScaledVector(this._dir, step);
      this.travelled += step;
      if (this.travelled >= this.maxDistance) {
        this.state = BoomerangState.RETURNING;
      }
      this.mesh.rotation.y += this.spinSpeed * dt;
    } else if (this.state === BoomerangState.RETURNING) {
      this._tmp.copy(player.position);
      this._tmp.y = DEFAULTS.holdHeight;
      this._tmp.sub(this.pos);
      const d = this._tmp.length();
      if (d <= DEFAULTS.returnSnapDistance) {
        this.state = BoomerangState.IDLE;
      } else {
        this._tmp.multiplyScalar(1 / Math.max(1e-6, d));
        this.pos.addScaledVector(this._tmp, this.speed * dt);
      }
      this.mesh.rotation.y += this.spinSpeed * dt;
    }

    this.mesh.position.copy(this.pos);
  }
}

