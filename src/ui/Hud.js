const DEFAULTS = Object.freeze({
  barSegments: 10,
});

export class Hud {
  /**
   * @param {{playerMaxHp?: number}} params
   */
  constructor(params = {}) {
    this.playerMaxHp = params.playerMaxHp ?? 100;
    this._lastHp = null;
    this._lastKills = null;

    this.root = document.createElement("div");
    this.root.id = "zombie-recoil-hud";
    this.root.innerHTML = `
      <div class="panel">
        <div class="row" data-health></div>
        <div class="row" data-kills></div>
      </div>
    `;
    document.body.appendChild(this.root);

    this._healthEl = this.root.querySelector("[data-health]");
    this._killsEl = this.root.querySelector("[data-kills]");

    const style = document.createElement("style");
    style.setAttribute("data-zombie-recoil-hud-style", "true");
    style.textContent = `
      #zombie-recoil-hud{
        position: fixed;
        top: 14px;
        left: 14px;
        z-index: 20;
        pointer-events: none;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        color: #e9f0ff;
        text-shadow: 0 2px 10px rgba(0,0,0,0.55);
      }
      #zombie-recoil-hud .panel{
        background: rgba(10,16,26,0.35);
        border: 1px solid rgba(255,255,255,0.10);
        backdrop-filter: blur(6px);
        border-radius: 12px;
        padding: 10px 12px;
        min-width: 220px;
      }
      #zombie-recoil-hud .row{
        font-size: 13px;
        letter-spacing: 0.02em;
        margin: 6px 0;
        white-space: pre;
      }
    `;
    document.head.appendChild(style);
    this._styleEl = style;
  }

  dispose() {
    this.root?.remove?.();
    this._styleEl?.remove?.();
  }

  update(playerHp, kills) {
    const hp = Math.max(0, Math.min(this.playerMaxHp, playerHp));

    if (this._lastHp !== hp && this._healthEl) {
      const segs = DEFAULTS.barSegments;
      const filled = Math.round((hp / this.playerMaxHp) * segs);
      const bar = "|".repeat(filled) + " ".repeat(segs - filled);
      this._healthEl.textContent = `[ HEALTH: ${bar} ]`;
      this._lastHp = hp;
    }

    if (this._lastKills !== kills && this._killsEl) {
      this._killsEl.textContent = `[ ZOMBIES KILLED: ${kills} ]`;
      this._lastKills = kills;
    }
  }
}

