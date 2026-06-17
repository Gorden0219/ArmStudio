/* ============================================================
 * gizmo.js — 平移/旋转操作手柄（自实现，世界轴对齐）
 *   平移：3 根彩色箭头（X红 Y绿 Z蓝），沿世界轴拖动
 *   旋转：3 个彩色圆环，绕世界轴旋转
 * 仅负责构建可拾取的句柄与几何；拖拽 math 由 robot3d 驱动。
 * ============================================================ */

class Gizmo {
  constructor(scene, size) {
    this.size = size || 90;
    this.mode = "translate";
    this.visible = false;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.handles = [];        // {mesh, axis:Vector3, kind:'T'|'R'}
    this._build();
    this.setMode("translate");
  }

  _axisColor(a) { return a === "x" ? 0xff5c6c : a === "y" ? 0x46d369 : 0x3da9ff; }

  _build() {
    const S = this.size;
    const axes = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
    for (const key in axes) {
      const dir = axes[key], col = this._axisColor(key);
      const mat = new THREE.MeshBasicMaterial({ color: col, depthTest: false, transparent: true });
      // 平移箭头：杆 + 锥
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, S, 10), mat);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(7, 18, 12), mat);
      tip.position.y = S / 2 + 9;
      const arrow = new THREE.Group(); arrow.add(shaft); arrow.add(tip);
      arrow.position.copy(dir.clone().multiplyScalar(S / 2));
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      arrow.renderOrder = 999;
      this.group.add(arrow);
      this.handles.push({ mesh: shaft, axis: dir.clone(), kind: "T" });
      this.handles.push({ mesh: tip, axis: dir.clone(), kind: "T" });
      arrow.userData.tgroup = true;

      // 旋转圆环
      const ring = new THREE.Mesh(new THREE.TorusGeometry(S * 0.85, 2.2, 8, 40),
        new THREE.MeshBasicMaterial({ color: col, depthTest: false, transparent: true }));
      // Torus 默认在 XY 平面（法线 Z）；旋转到法线=该轴
      if (key === "x") ring.rotation.y = Math.PI / 2;
      else if (key === "y") ring.rotation.x = Math.PI / 2;
      ring.renderOrder = 999;
      this.group.add(ring);
      this.handles.push({ mesh: ring, axis: dir.clone(), kind: "R" });
      ring.userData.rgroup = true;
    }
  }

  setMode(m) {
    this.mode = m;
    this.group.traverse((o) => {
      if (o.userData.tgroup) o.visible = m === "translate";
      if (o.userData.rgroup) o.visible = m === "rotate";
    });
  }

  show(pos) { this.visible = true; this.group.visible = true; this.group.position.copy(pos); }
  hide() { this.visible = false; this.group.visible = false; }

  pickList() {
    return this.handles.filter((h) => (this.mode === "translate" ? h.kind === "T" : h.kind === "R")).map((h) => h.mesh);
  }
  infoFor(mesh) { return this.handles.find((h) => h.mesh === mesh); }
}
