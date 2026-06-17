/* ============================================================
 * orbit.js — 轻量轨道相机控制（自包含，不依赖 OrbitControls）
 * 左键空白处拖动=旋转，滚轮=缩放，右键拖动=平移
 * 暴露 enabled 开关，便于在拖动机械臂目标时临时禁用旋转
 * ============================================================ */

class OrbitCam {
  constructor(camera, dom, target) {
    this.cam = camera;
    this.dom = dom;
    this.target = target || new THREE.Vector3(0, 150, 0);
    this.enabled = true;

    this.theta = Math.PI / 4;   // 水平角
    this.phi = Math.PI / 3;     // 极角
    this.radius = 700;
    this.minR = 200;
    this.maxR = 2000;

    this._drag = null; // 'rot' | 'pan'
    this._lx = 0; this._ly = 0;

    dom.addEventListener("pointerdown", (e) => this._down(e));
    window.addEventListener("pointermove", (e) => this._move(e));
    window.addEventListener("pointerup", () => (this._drag = null));
    dom.addEventListener("wheel", (e) => this._wheel(e), { passive: false });
    dom.addEventListener("contextmenu", (e) => e.preventDefault());
    this.update();
  }

  _down(e) {
    if (!this.enabled) return;
    if (this._suppress && this._suppress(e)) return; // 命中机械臂目标时跳过
    this._drag = e.button === 2 ? "pan" : "rot";
    this._lx = e.clientX; this._ly = e.clientY;
  }

  _move(e) {
    if (!this._drag || !this.enabled) return;
    const dx = e.clientX - this._lx, dy = e.clientY - this._ly;
    this._lx = e.clientX; this._ly = e.clientY;
    if (this._drag === "rot") {
      this.theta -= dx * 0.008;
      this.phi = THREE.MathUtils.clamp(this.phi - dy * 0.008, 0.15, Math.PI - 0.15);
    } else {
      const panS = this.radius * 0.0015;
      const right = new THREE.Vector3().setFromMatrixColumn(this.cam.matrix, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(this.cam.matrix, 1);
      this.target.addScaledVector(right, -dx * panS);
      this.target.addScaledVector(up, dy * panS);
    }
    this.update();
  }

  _wheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    this.radius = THREE.MathUtils.clamp(this.radius * (1 + Math.sign(e.deltaY) * 0.1), this.minR, this.maxR);
    this.update();
  }

  update() {
    const x = this.radius * Math.sin(this.phi) * Math.cos(this.theta);
    const y = this.radius * Math.cos(this.phi);
    const z = this.radius * Math.sin(this.phi) * Math.sin(this.theta);
    this.cam.position.set(this.target.x + x, this.target.y + y, this.target.z + z);
    this.cam.lookAt(this.target);
  }
}
