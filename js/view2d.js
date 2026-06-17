/* ============================================================
 * view2d.js — 2D 俯视图（XZ 平面）
 *   显示所有末端执行器与机身投影；拖动“当前末端”→ 求 IK
 *   点击空白处把当前末端移动到该点
 * ============================================================ */

class View2D {
  constructor(canvas, heightSlider, heightVal) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.heightSlider = heightSlider;
    this.heightVal = heightVal;
    this.scale = 0.5;
    this.workH = 120;
    this.model = null;
    this.activeEE = null;
    this.framesPath = [];      // 当前末端的关键帧路径点（世界坐标）

    this.onMoveEE = null;      // (worldVec3) => {}
    this.onPickKf2D = null;    // (i)
    this.onKfDrag2D = null;    // (i, worldVec3)
    this.onKfDragEnd2D = null;
    this.selFrame = -1;
    this._drag = false;
    this._kfDrag = -1;

    canvas.addEventListener("pointerdown", (e) => this._down(e));
    canvas.addEventListener("pointermove", (e) => this._move(e));
    window.addEventListener("pointerup", () => {
      if (this._kfDrag >= 0 && this.onKfDragEnd2D) this.onKfDragEnd2D();
      this._drag = false; this._kfDrag = -1;
    });
    heightSlider.addEventListener("input", () => {
      this.workH = +heightSlider.value; heightVal.textContent = this.workH;
    });
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = r.width * devicePixelRatio;
    this.canvas.height = r.height * devicePixelRatio;
    this.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    this.draw();
  }

  w2s(x, z) { const r = this.canvas.getBoundingClientRect(); return { x: r.width / 2 + x * this.scale, y: r.height / 2 + z * this.scale }; }
  s2w(px, py) { const r = this.canvas.getBoundingClientRect(); return { x: (px - r.width / 2) / this.scale, z: (py - r.height / 2) / this.scale }; }
  _px(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  _hitKf(px, py) {
    for (let i = 0; i < this.framesPath.length; i++) {
      const s = this.w2s(this.framesPath[i].x, this.framesPath[i].z);
      if (Math.hypot(s.x - px, s.y - py) < 12) return i;
    }
    return -1;
  }
  _down(e) {
    const p = this._px(e);
    const kfi = this._hitKf(p.x, p.y);
    if (kfi >= 0) { this._kfDrag = kfi; if (this.onPickKf2D) this.onPickKf2D(kfi); return; }
    if (this.activeEE == null) return;
    const w = this.s2w(p.x, p.y);
    this._drag = true;
    if (this.onMoveEE) this.onMoveEE(new THREE.Vector3(w.x, this.workH, w.z));
  }
  _move(e) {
    const p = this._px(e), w = this.s2w(p.x, p.y);
    if (this._kfDrag >= 0) { if (this.onKfDrag2D) this.onKfDrag2D(this._kfDrag, new THREE.Vector3(w.x, this.workH, w.z)); return; }
    if (!this._drag || this.activeEE == null) return;
    if (this.onMoveEE) this.onMoveEE(new THREE.Vector3(w.x, this.workH, w.z));
  }

  draw() {
    const ctx = this.ctx, r = this.canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    // 网格
    ctx.strokeStyle = "#16202c"; ctx.lineWidth = 1;
    const step = 50 * this.scale;
    for (let x = (r.width / 2) % step; x < r.width; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, r.height); ctx.stroke(); }
    for (let y = (r.height / 2) % step; y < r.height; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(r.width, y); ctx.stroke(); }
    const c = this.w2s(0, 0);
    ctx.fillStyle = "#46d369"; ctx.beginPath(); ctx.arc(c.x, c.y, 7, 0, 7); ctx.fill();

    if (!this.model) return;
    const fk = this.model.forward(this.model.q);

    // 机身/连杆投影（淡）
    ctx.strokeStyle = "#33485c"; ctx.lineWidth = 3; ctx.lineCap = "round";
    this.model.nodes.forEach((n, i) => {
      if (n.parent < 0) return;
      const a = this.w2s(fk.linkStart[i].x, fk.linkStart[i].z);
      const b = this.w2s(fk.jointPos[i].x, fk.jointPos[i].z);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    });

    // TCP 速度色阶路径
    if (this.tcpViz && this.tcpViz.pts.length >= 2) {
      ctx.lineWidth = 3; ctx.lineCap = "round";
      for (let k = 1; k < this.tcpViz.pts.length; k++) {
        const p0 = this.tcpViz.pts[k - 1], p1 = this.tcpViz.pts[k];
        const a = this.w2s(p0.pos.x, p0.pos.z), b = this.w2s(p1.pos.x, p1.pos.z);
        const c = Motion.speedColor((p0.speed + p1.speed) / 2, this.tcpViz.vmax);
        ctx.strokeStyle = `rgb(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0})`;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }

    // 关键帧节点
    if (this.framesPath.length >= 1) {
      this.framesPath.forEach((p, i) => {
        const s = this.w2s(p.x, p.z);
        const sel = i === this.selFrame;
        ctx.fillStyle = sel ? "#ffce6b" : "#3da9ff";
        ctx.beginPath(); ctx.arc(s.x, s.y, sel ? 11 : 9, 0, 7); ctx.fill();
        ctx.fillStyle = "#04121f"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(i + 1, s.x, s.y);
        // 坐标标签
        ctx.fillStyle = sel ? "#ffce6b" : "#8b97a5";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(`(${p.x.toFixed(0)},${p.z.toFixed(0)})`, s.x, s.y + 14);
      });
    }

    // 末端执行器
    this.model.endEffectors().forEach((i) => {
      const p = fk.jointPos[i]; const s = this.w2s(p.x, p.z);
      const active = i === this.activeEE;
      ctx.fillStyle = active ? "#ff8a3d" : "#3da9ff";
      ctx.beginPath(); ctx.arc(s.x, s.y, active ? 9 : 6, 0, 7); ctx.fill();
      if (active) { ctx.strokeStyle = "rgba(255,138,61,.4)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s.x, s.y, 15, 0, 7); ctx.stroke(); }
    });
  }
}
