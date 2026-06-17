/* ============================================================
 * trajectory.js — 全身姿态关键帧 + 主流运动指令(MoveJ/L/C)
 * 每帧 = { q:[关节值], grip, motion:'PTP'|'LIN'|'CIRC', speed, acc, bulge }
 *   motion/speed/acc/bulge 描述「上一帧 → 本帧」这一段的运动
 * 播放由 motion.js 的梯形速度曲线驱动，可估算节拍。
 * ============================================================ */

class Keyframes {
  constructor() {
    this.frames = [];
    this.playing = false;
    this.speedScale = 1;     // 全局速度倍率
    this._raf = null;
    this.onFrame = null;     // (q, gripOpen) => {}
    this.onChange = null;
    this.onPlayEnd = null;
    this.onTime = null;      // (elapsed, total) => {} 播放进度
  }
  _changed() { if (this.onChange) this.onChange(); }

  defaults() { return { motion: "PTP", speed: 150, acc: 600, bulge: 60 }; }

  capture(model, grip) {
    this.frames.push(Object.assign({ q: model.q.slice(), grip: grip || "open" }, this.defaults()));
    this._changed();
    return this.frames.length;
  }
  setSeg(i, attr, val) { if (this.frames[i]) { this.frames[i][attr] = val; this._changed(); } }
  toggleGrip(i) { if (this.frames[i]) { this.frames[i].grip = this.frames[i].grip === "open" ? "close" : "open"; this._changed(); } }
  remove(i) { this.frames.splice(i, 1); this._changed(); }
  clear() { this.stop(); this.frames = []; this._changed(); }

  eePath(model, ee) { return ee == null ? [] : this.frames.map((f) => model.eePosition(ee, f.q)); }

  /* 节拍（秒） */
  cycleTime(model, ee) {
    if (this.frames.length < 2) return 0;
    return Motion.plan(model, ee, this.frames, this.speedScale).totalT;
  }
  /* TCP 可视化采样（含速度，用于着色） */
  tcpViz(model, ee, perSeg) {
    if (this.frames.length < 2 || ee == null) return { pts: [], vmax: 1 };
    return Motion.plan(model, ee, this.frames, this.speedScale).sampleViz(perSeg);
  }

  play(model, ee) {
    if (this.frames.length < 2 || this.playing) return;
    this.playing = true;
    const plan = Motion.plan(model, ee, this.frames, this.speedScale);
    let si = 0;
    const start = performance.now();

    const tick = (now) => {
      if (!this.playing) return;
      const t = (now - start) / 1000;
      if (this.onTime) this.onTime(Math.min(t, plan.totalT), plan.totalT);
      if (t >= plan.totalT) {
        const last = this.frames[this.frames.length - 1];
        if (this.onFrame) this.onFrame(last.q.slice(), last.grip === "open");
        this.stop(); if (this.onPlayEnd) this.onPlayEnd(); return;
      }
      while (si < plan.segs.length - 1 && t >= plan.segs[si].t0 + plan.segs[si].T) si++;
      const s = plan.segs[si];
      const lt = t - s.t0;
      const frac = Motion.profileFrac(lt, s.T, s.L, s.v, s.a);
      const q = s.sample(frac);
      const grip = frac < 0.5 ? s.gripFrom : s.gripTo;
      if (this.onFrame) this.onFrame(q, grip === "open");
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }
  stop() { this.playing = false; if (this._raf) cancelAnimationFrame(this._raf); this._raf = null; }
}
