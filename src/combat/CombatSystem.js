import { BoomerangState } from "../weapons/Boomerang.js";

const DEFAULTS = Object.freeze({
  boomerangHitRadius: 1.5,
  boomerangHitCooldownSeconds: 0.12,
  zombieContactRadius: 1.0,
  zombieContactDps: 22,
});

export class CombatSystem {
  /**
   * @param {{
   *  zombieManager: any,
   *  boomerang: any,
   *  playerMaxHp?: number,
   *  zombieContactDps?: number
   * }} params
   */
  constructor(params) {
    this.zombies = params.zombieManager;
    this.boomerang = params.boomerang;
    this.playerMaxHp = params.playerMaxHp ?? 100;
    this.playerHp = this.playerMaxHp;
    this.zombieContactDps = params.zombieContactDps ?? DEFAULTS.zombieContactDps;

    this._boomerangHitR2 = (params.boomerangHitRadius ?? DEFAULTS.boomerangHitRadius) ** 2;
    this._zombieContactR2 = (DEFAULTS.zombieContactRadius ?? 1.0) ** 2;
  }

  reset() {
    this.playerHp = this.playerMaxHp;
  }

  /**
   * @param {number} dt
   * @param {{x:number,z:number}} playerPosXZ
   */
  update(dt, playerPosXZ) {
    const zm = this.zombies;
    const count = zm.count;
    if (!count) return;

    const px = playerPosXZ.x;
    const pz = playerPosXZ.z;

    // 1) Zombie contact damage
    const contactDmg = this.zombieContactDps * dt;
    if (contactDmg > 0) {
      for (let i = 0; i < count; i++) {
        if (zm.dying[i]) continue;
        const dx = zm.posX[i] - px;
        const dz = zm.posZ[i] - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 <= this._zombieContactR2) {
          this.playerHp = Math.max(0, this.playerHp - contactDmg);
        }
      }
    }

    // 2) Boomerang hits (only while in flight)
    if (this.boomerang.state === BoomerangState.IDLE) return;

    const bx = this.boomerang.pos.x;
    const bz = this.boomerang.pos.z;
    const dmg = this.boomerang.damage;
    const cooldown = DEFAULTS.boomerangHitCooldownSeconds;

    for (let i = 0; i < count; i++) {
      if (zm.dying[i]) continue;
      if (zm.hitCooldownT[i] > 0) continue;

      const dx = zm.posX[i] - bx;
      const dz = zm.posZ[i] - bz;
      const d2 = dx * dx + dz * dz;
      if (d2 <= this._boomerangHitR2) {
        zm.hitCooldownT[i] = cooldown;
        zm.damageZombie(i, dmg, { flash: true });
      }
    }
  }
}

