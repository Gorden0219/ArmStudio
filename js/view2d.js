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
    this._sketchDragIdx = -1;

    // 草图模式
    this.sketchMode = false;
    this.sketchPoints = [];    // [{x, z}] 世界坐标
    this.sketchMouse = null;   // 跟随鼠标的临时点
    this.onSketchPoint = null; // () => {} 有点变化时
    this.onSketchComplete = null; // (points[]) => {}

    canvas.addEventListener("pointerdown", (e) => this._down(e));
    canvas.addEventListener("pointermove", (e) => { this._move(e); if (this.sketchMode) { this.sketchMouse = this._px(e); this.draw(); } });
    canvas.addEventListener("contextmenu", (e) => { if (this.sketchMode && this.sketchPoints.length) { e.preventDefault(); this.sketchPoints.pop(); if (this.onSketchPoint) this.onSketchPoint(); this.draw(); } });
    window.addEventListener("pointerup", () => {
      if (this._kfDrag >= 0 && this.onKfDragEnd2D) this.onKfDragEnd2D();
      this._drag = false; this._kfDrag = -1; this._sketchDragIdx = -1;
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
    // 草图模式：添加/完成顶点
    if (this.sketchMode) {
      const w = this.s2w(p.x, p.y);
      if (this.sketchPoints.length >= 3) {
        const f = this.sketchPoints[0];
        if (Math.hypot(w.x - f.x, w.z - f.z) < 20) {
          // 靠近起点 → 闭合草图
          if (this.onSketchComplete) this.onSketchComplete(this.sketchPoints);
          return;
        }
      }
      // 检查是否点击在已有顶点上拖拽移动
      for (let i = 0; i < this.sketchPoints.length; i++) {
        const s = this.w2s(this.sketchPoints[i].x, this.sketchPoints[i].z);
        if (Math.hypot(s.x - p.x, s.y - p.y) < 10) {
          this._sketchDragIdx = i;
          this._drag = true;
          return;
        }
      }
      this.sketchPoints.push({ x: w.x, z: w.z });
      if (this.onSketchPoint) this.onSketchPoint();
      this.draw();
      return;
    }
    const kfi = this._hitKf(p.x, p.y);
    if (kfi >= 0) { this._kfDrag = kfi; if (this.onPickKf2D) this.onPickKf2D(kfi); return; }
    if (this.activeEE == null) return;
    const w = this.s2w(p.x, p.y);
    this._drag = true;
    if (this.onMoveEE) this.onMoveEE(new THREE.Vector3(w.x, this.workH, w.z));
  }
  _move(e) {
    const p = this._px(e), w = this.s2w(p.x, p.y);
    if (this._sketchDragIdx >= 0 && this.sketchMode) {
      this.sketchPoints[this._sketchDragIdx] = { x: w.x, z: w.z };
      if (this.onSketchPoint) this.onSketchPoint();
      this.draw();
      return;
    }
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

    // 草图
    if (this.sketchMode && this.sketchPoints.length) {
      ctx.strokeStyle = "#ff8a3d"; ctx.lineWidth = 2.5; ctx.lineJoin = "round"; ctx.lineCap = "round";
      // 画实线（顶点之间的连线）
      ctx.beginPath();
      const s0 = this.w2s(this.sketchPoints[0].x, this.sketchPoints[0].z);
      ctx.moveTo(s0.x, s0.y);
      for (let i = 1; i < this.sketchPoints.length; i++) {
        const s = this.w2s(this.sketchPoints[i].x, this.sketchPoints[i].z);
        ctx.lineTo(s.x, s.y);
      }
      ctx.stroke();
      // 画虚线预览（最后一点→鼠标→起点）
      if (this.sketchMouse && this._sketchDragIdx < 0) {
        const last = this.sketchPoints.length - 1;
        const sl = this.w2s(this.sketchPoints[last].x, this.sketchPoints[last].z);
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "rgba(255,138,61,0.4)";
        ctx.beginPath();
        ctx.moveTo(sl.x, sl.y);
        ctx.lineTo(this.sketchMouse.x, this.sketchMouse.y);
        if (this.sketchPoints.length >= 3) {
          ctx.lineTo(s0.x, s0.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // 填充
      if (this.sketchPoints.length >= 3) {
        ctx.fillStyle = "rgba(61,169,255,0.08)";
        ctx.closePath(); ctx.fill();
      }
      // 顶点标记
      this.sketchPoints.forEach((p, i) => {
        const s = this.w2s(p.x, p.z);
        ctx.fillStyle = i === 0 ? "#46d369" : "#ff8a3d";
        ctx.beginPath(); ctx.arc(s.x, s.y, i === 0 ? 8 : 6, 0, 7); ctx.fill();
        if (i === 0) { ctx.strokeStyle = "#46d369"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s.x, s.y, 12, 0, 7); ctx.stroke(); }
        ctx.fillStyle = "#04121f"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(i + 1, s.x, s.y);
      });
      // 坐标
      ctx.fillStyle = "#e6edf3"; ctx.font = "9px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
      this.sketchPoints.forEach((p, i) => {
        const s = this.w2s(p.x, p.z);
        ctx.fillText(`(${p.x.toFixed(0)},${p.z.toFixed(0)})`, s.x, s.y + 12);
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
