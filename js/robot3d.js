/* ============================================================
 * robot3d.js — Three.js 场景：渲染任意机器人树
 *   普通模式：拖动末端执行器标记 → 求 IK
 *   设计模式：拖动任意关节句柄 → 修改连杆长度/方向
 * ============================================================ */

class Robot3D {
  constructor(container) {
    this.container = container;
    this.model = null;
    this.mode = "pose";          // 'pose' | 'design'
    this.gripperOpen = true;
    this.activeEE = null;        // 当前选中的末端节点索引

    this.onIK = null;            // (eeIndex, point) → app 求解
    this.onIKDrop = null;        // 拖放结束
    this.onPickEE = null;        // 选中末端
    this.onPickNode = null;      // 设计模式选中节点
    this.onNodeDrag = null;      // 设计模式拖动节点 (i, worldPoint)
    this.onNodeDrop = null;
    this.onGizmoTranslate = null; // (i, worldAxis, delta)
    this.onGizmoRotate = null;    // (i, worldAxis, dAngle)
    this.onGizmoEnd = null;
    this.clickMode = false;       // 点击取点模式
    this.cadClickMode = false;    // CAD 自由放置模式
    this.clickPlaneY = 120;       // 取点所在水平面高度(mm)
    this.onClickPoint = null;     // (worldPoint) => {}
    this.onCadClickPoint = null;  // CAD 放置回调 (worldPoint) => {}
    this.onPickKf = null;         // 选中某关键帧路点 (i)
    this.onKfDrag = null;         // 拖动关键帧路点 (i, worldPoint)
    this.onKfDragEnd = null;      // (i)
    this._kfHandles = [];
    this._selJoint = -1;          // 选中的关节索引（pose 模式）
    this.onPickJoint = null;      // (i) 选中关节回调
    this.onJointDrag = null;      // (i, dx_px, dy_px) 拖动关节
    this.onJointDragEnd = null;   // (i) 拖动结束

    this._dynamic = [];          // 每帧重建的网格
    this._handles = [];          // 可拾取的句柄 {mesh, kind:'ee'|'node', index}
    this._pickableMeshes = [];   // 设计模式中可直接拖拽的几何体
    this.showDimensions = false;

    this._initScene();
    this._initPick();
    this._animate();
    window.addEventListener("resize", () => this._resize());
  }

  _initScene() {
    const w = this.container.clientWidth || 800, h = this.container.clientHeight || 600;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c1117);
    this.camera = new THREE.PerspectiveCamera(50, w / h, 1, 8000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(w, h);
    this.container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dl = new THREE.DirectionalLight(0xffffff, 0.8);
    dl.position.set(300, 700, 400); this.scene.add(dl);
    this.scene.add(new THREE.GridHelper(1400, 28, 0x2c3947, 0x141d28));
    this.scene.add(new THREE.AxesHelper(150));

    this.armGroup = new THREE.Group(); this.scene.add(this.armGroup);
    this.handleGroup = new THREE.Group(); this.scene.add(this.handleGroup);

    this.orbit = new OrbitCam(this.camera, this.renderer.domElement, new THREE.Vector3(0, 150, 0));

    this.pathGroup = new THREE.Group(); this.scene.add(this.pathGroup);
    this.kfHandleGroup = new THREE.Group(); this.scene.add(this.kfHandleGroup);
    this._dimGroup = new THREE.Group(); this.scene.add(this._dimGroup);
    this._sketchPlaneGroup = new THREE.Group(); this.scene.add(this._sketchPlaneGroup);
    this.gizmo = new Gizmo(this.scene, 90);

    this.matLink = new THREE.MeshStandardMaterial({ color: 0x6b7b8c, metalness: 0.55, roughness: 0.45 });
    this.matJoint = new THREE.MeshStandardMaterial({ color: 0xff8a3d, metalness: 0.3, roughness: 0.5 });
    this.matBody = new THREE.MeshStandardMaterial({ color: 0x4a90d9, metalness: 0.3, roughness: 0.6 });
    this._matCache = {};
  }

  setModel(model) {
    this.model = model;
    const ees = model.endEffectors();
    this.activeEE = ees.length ? ees[0] : null;
    this.rebuild();
    // 自适应视距
    const fk = model.forward(model.home);
    let maxR = 200;
    fk.jointPos.forEach((p) => (maxR = Math.max(maxR, p.length())));
    this.orbit.radius = maxR * 3 + 200;
    this.orbit.target.set(0, maxR * 0.5, 0);
    this.orbit.update();
  }

  setMode(m) { this.mode = m; this.rebuild(); }
  setActiveEE(i) { this.activeEE = i; this.rebuild(); }
  setGripper(open) { this.gripperOpen = open; this.rebuild(); }

  _orient(mesh, a, b, rx, rz) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = Math.max(dir.length(), 1);
    mesh.scale.set(rx, len, rz == null ? rx : rz);
    mesh.position.copy(a).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  }

  /* 重建机器人几何 + 句柄（关节角改变后或结构改变后调用） */
  rebuild() {
    if (!this.model) return;
    const m = this.model, fk = m.forward(m.q);
    [...this._dynamic].forEach((o) => this.armGroup.remove(o));
    this._dynamic = [];
    [...this.handleGroup.children].forEach((o) => this.handleGroup.remove(o));
    this._handles = [];
    [...this.kfHandleGroup.children].forEach((o) => this.kfHandleGroup.remove(o));
    this._kfHandles = [];
    if (!this.showDimensions) {
      [...this._dimGroup.children].forEach((o) => this._dimGroup.remove(o));
    }
    this._pickableMeshes = [];

    // 连杆 + 关节
    m.nodes.forEach((n, i) => {
      // 标准零件组（parts library）
      if (n._partGroup) {
        const clone = n._partGroup.clone(true);
        clone.position.copy(fk.jointPos[i]);
        clone.quaternion.setFromRotationMatrix(fk.world[i]);
        clone.userData.nodeIndex = i;
        this.armGroup.add(clone); this._dynamic.push(clone);
        this._pickableMeshes.push(clone);
      }
      // 显式几何（机身/底座/自定义外形）
      if (n.geometry) {
        // 兼容旧格式：简单 box/cylinder/sphere
        if (n.geometry.type === 'box' || n.geometry.type === 'cylinder' || n.geometry.type === 'sphere') {
          let g;
          if (n.geometry.type === 'box') g = new THREE.BoxGeometry(...n.geometry.size);
          else if (n.geometry.type === 'cylinder') g = new THREE.CylinderGeometry(n.geometry.size[0], n.geometry.size[0], n.geometry.size[1], 24);
          else g = new THREE.SphereGeometry(n.geometry.size[0], 18, 14);
          const mesh = new THREE.Mesh(g, this._matNode(n) || this.matBody);
          mesh.position.copy(fk.jointPos[i]);
          mesh.quaternion.setFromRotationMatrix(fk.world[i]);
          mesh.userData.nodeIndex = i;
          this.armGroup.add(mesh); this._dynamic.push(mesh);
          this._pickableMeshes.push(mesh);
        } else if (n.geometry.shape) {
          // 新格式：完整 shape 定义 → Shapes.buildGeometry
          const g = Shapes.buildGeometry(n.geometry.shape);
          if (g) {
            const mesh = new THREE.Mesh(g, this._matNode(n) || this.matBody);
            mesh.position.copy(fk.jointPos[i]);
            mesh.quaternion.setFromRotationMatrix(fk.world[i]);
            mesh.userData.nodeIndex = i;
            this.armGroup.add(mesh); this._dynamic.push(mesh);
            this._pickableMeshes.push(mesh);
          }
        }
      }
      // 连杆骨架（标准零件跳过骨架）
      if (n.parent >= 0 && !n._partGroup) {
        const b = Shapes.buildBoneGeometry(n.linkShape);
        const link = new THREE.Mesh(b.geo, this._matNode(n) || this.matLink);
        this._orient(link, fk.linkStart[i], fk.jointPos[i], b.rx, b.rz);
        link.userData.nodeIndex = i;
        this.armGroup.add(link); this._dynamic.push(link);
        this._pickableMeshes.push(link);
      }
      // 关节球（跳过标准零件）
      if (m.isMovable(i) && !n._partGroup) {
        const jm = new THREE.Mesh(new THREE.SphereGeometry(15, 18, 14), this.matJoint);
        jm.position.copy(fk.jointPos[i]);
        this.armGroup.add(jm); this._dynamic.push(jm);
      }
    });

    // 夹爪（末端有夹爪的机型）
    if (m.hasGripper && this.activeEE != null) {
      const ee = fk.world[this.activeEE];
      const grp = new THREE.Group();
      const gMat = new THREE.MeshStandardMaterial({ color: 0xffc04d, metalness: 0.4, roughness: 0.4 });
      const gap = this.gripperOpen ? 16 : 5;
      [gap, -gap].forEach((z) => {
        const f = new THREE.Mesh(new THREE.BoxGeometry(6, 28, 6), gMat);
        f.position.set(0, 12, z); grp.add(f);
      });
      grp.position.setFromMatrixPosition(ee);
      grp.quaternion.setFromRotationMatrix(ee);
      this.armGroup.add(grp); this._dynamic.push(grp);
    }

    // 句柄
    if (this.mode === "design") {
      m.nodes.forEach((n, i) => {
        const sel = i === this._selNode;
        const h = new THREE.Mesh(new THREE.SphereGeometry(sel ? 20 : 14, 16, 12),
          new THREE.MeshBasicMaterial({ color: sel ? 0xffce6b : 0x46d369, transparent: true, opacity: 0.85 }));
        h.position.copy(fk.jointPos[i]);
        this.handleGroup.add(h); this._handles.push({ mesh: h, kind: "node", index: i });
      });
    } else {
      // 末端句柄
      m.endEffectors().forEach((i) => {
        const active = i === this.activeEE;
        const h = new THREE.Mesh(new THREE.SphereGeometry(active ? 20 : 14, 20, 16),
          new THREE.MeshBasicMaterial({ color: active ? 0xff8a3d : 0x3da9ff, transparent: true, opacity: active ? 0.6 : 0.45 }));
        h.position.copy(fk.jointPos[i]);
        this.handleGroup.add(h); this._handles.push({ mesh: h, kind: "ee", index: i });
      });
      // 可动关节句柄（便于点击选中对应滑块）
      m.movableIndices().forEach((i) => {
        const sel = i === this._selJoint;
        const h = new THREE.Mesh(new THREE.SphereGeometry(sel ? 20 : 14, 16, 12),
          new THREE.MeshBasicMaterial({ color: sel ? 0x46d369 : 0x5a7a9a, transparent: true, opacity: sel ? 0.7 : 0.4 }));
        h.position.copy(fk.jointPos[i]);
        this.handleGroup.add(h); this._handles.push({ mesh: h, kind: "joint", index: i });
      });
    }

    // 操作手柄：设计模式且已选中节点时显示在该节点
    if (this.mode === "design" && this._selNode != null && this._selNode >= 0 && m.nodes[this._selNode]) {
      this.gizmo.show(fk.jointPos[this._selNode]);
    } else { this.gizmo.hide(); }
  }
  setGizmoMode(m) { this.gizmo.setMode(m); }
  _matNode(n) {
    if (!n || !n.color) return null;
    const c = n.color;
    // Initialize cache entry if needed
    if (!this._matCache[c] || !this._matCache[c]._isNodeCache) {
      if (this._matCache[c] && this._matCache[c] instanceof THREE.Material) {
        // legacy single material
        this._matCache[c] = { _isNodeCache: true, __default: this._matCache[c] };
      } else {
        this._matCache[c] = { _isNodeCache: true };
      }
    }
    const cache = this._matCache[c];
    const mt = n.materialType || 'standard';
    const op = n.opacity;
    const key = mt + '_' + ((op != null) ? op : 1);
    if (cache[key]) return cache[key];
    const base = { color: c };
    if (op != null && op < 1) { base.transparent = true; base.opacity = Math.max(0.05, op); }
    let mat;
    switch (mt) {
      case 'metallic': mat = new THREE.MeshStandardMaterial(Object.assign({}, base, { metalness: 0.85, roughness: 0.15 })); break;
      case 'matte': mat = new THREE.MeshStandardMaterial(Object.assign({}, base, { metalness: 0.0, roughness: 0.9 })); break;
      case 'glossy': mat = new THREE.MeshStandardMaterial(Object.assign({}, base, { metalness: 0.3, roughness: 0.05 })); break;
      case 'emissive': mat = new THREE.MeshStandardMaterial(Object.assign({}, base, { metalness: 0.2, roughness: 0.4, emissive: c, emissiveIntensity: 0.35 })); break;
      default: mat = new THREE.MeshStandardMaterial(Object.assign({}, base, { metalness: 0.5, roughness: 0.5 })); break;
    }
    cache[key] = mat;
    return mat;
  }

  setSelectedNode(i) { this._selNode = i; this.rebuild(); }
  setSelectedJoint(i) { this._selJoint = i; this.rebuild(); }
  clearJointSelection() { this._selJoint = -1; }

  _initPick() {
    const ray = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const hit = new THREE.Vector3();
    let drag = null;

    const ndc = (e) => {
      const r = this.renderer.domElement.getBoundingClientRect();
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    const pickHandle = () => {
      const all = this._handles.concat(this._kfHandles);
      const hits = ray.intersectObjects(all.map((h) => h.mesh));
      if (hits.length) return all.find((h) => h.mesh === hits[0].object);
      // 设计模式：直接点击几何体表面也可选中拖拽
      if (this.mode === "design" && this._pickableMeshes.length) {
        const meshHits = ray.intersectObjects(this._pickableMeshes);
        if (meshHits.length) {
          const ni = meshHits[0].object.userData.nodeIndex;
          if (ni != null) return { mesh: meshHits[0].object, kind: "node", index: ni };
        }
      }
      return null;
    };
    const pickGizmo = () => {
      if (!(this.mode === "design" && this.gizmo.visible)) return null;
      const hits = ray.intersectObjects(this.gizmo.pickList());
      return hits.length ? this.gizmo.infoFor(hits[0].object) : null;
    };

    this.orbit._suppress = (e) => { ndc(e); ray.setFromCamera(mouse, this.camera); return !!(pickGizmo() || pickHandle()); };

    this.renderer.domElement.addEventListener("pointerdown", (e) => {
      ndc(e); ray.setFromCamera(mouse, this.camera);

      // 1) 操作手柄优先
      const g = pickGizmo();
      if (g) {
        const pos = this.gizmo.group.position.clone();
        const axis = g.axis.clone().normalize();
        const plane = new THREE.Plane();
        if (g.kind === "T") {
          const camDir = this.camera.getWorldDirection(new THREE.Vector3());
          let nrm = camDir.clone().sub(axis.clone().multiplyScalar(camDir.dot(axis)));
          if (nrm.lengthSq() < 1e-6) nrm = camDir;
          plane.setFromNormalAndCoplanarPoint(nrm.normalize(), pos);
          ray.ray.intersectPlane(plane, hit);
          drag = { type: "gizmoT", axis, pos, plane, last: hit.clone().sub(pos).dot(axis) };
        } else {
          plane.setFromNormalAndCoplanarPoint(axis, pos);
          ray.ray.intersectPlane(plane, hit);
          const ref = Math.abs(axis.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
          const e1 = new THREE.Vector3().crossVectors(axis, ref).normalize();
          const e2 = new THREE.Vector3().crossVectors(axis, e1).normalize();
          const v = hit.clone().sub(pos);
          drag = { type: "gizmoR", axis, pos, plane, e1, e2, last: Math.atan2(v.dot(e2), v.dot(e1)) };
        }
        return;
      }

      // 2) 末端 / 节点句柄
      const h = pickHandle();
      if (!h) {
        // 点击空白处：取消选中的关节
        if (this._selJoint >= 0 && this.onPickJoint) { this._selJoint = -1; this.onPickJoint(-1); }
        // CAD 自由放置模式（设计模式中）
        if (this.cadClickMode) drag = { type: "cadclick", x: e.clientX, y: e.clientY };
        // 点击取点模式（动作模式中）
        else if (this.clickMode) drag = { type: "click", x: e.clientX, y: e.clientY };
        return;
      }
      // 关节句柄：选中并启动拖拽
      if (h.kind === "joint") {
        this._selJoint = h.index;
        if (this.onPickJoint) this.onPickJoint(h.index);
        const n = this.camera.getWorldDirection(new THREE.Vector3());
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, h.mesh.position);
        if (ray.ray.intersectPlane(plane, hit)) drag = { type: "joint", index: h.index, plane, start: hit.clone() };
        return;
      }
      const n = this.camera.getWorldDirection(new THREE.Vector3());
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, h.mesh.position);
      drag = { type: h.kind, index: h.index, plane };
      if (h.kind === "ee") { this.activeEE = h.index; if (this.onPickEE) this.onPickEE(h.index); }
      else if (h.kind === "kf") { if (this.onPickKf) this.onPickKf(h.index); }
      else { this.setSelectedNode(h.index); if (this.onPickNode) this.onPickNode(h.index); }
    });

    window.addEventListener("pointermove", (e) => {
      if (!drag) return;
      ndc(e); ray.setFromCamera(mouse, this.camera);
      if (drag.type === "gizmoT") {
        if (!ray.ray.intersectPlane(drag.plane, hit)) return;
        const s = hit.clone().sub(drag.pos).dot(drag.axis);
        const d = s - drag.last; drag.last = s;
        if (this.onGizmoTranslate) this.onGizmoTranslate(this._selNode, drag.axis.clone(), d);
      } else if (drag.type === "gizmoR") {
        if (!ray.ray.intersectPlane(drag.plane, hit)) return;
        const v = hit.clone().sub(drag.pos);
        const a = Math.atan2(v.dot(drag.e2), v.dot(drag.e1));
        let d = a - drag.last; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
        drag.last = a;
        if (this.onGizmoRotate) this.onGizmoRotate(this._selNode, drag.axis.clone(), d);
      } else if (drag.type === "ee" || drag.type === "node" || drag.type === "kf") {
        if (!ray.ray.intersectPlane(drag.plane, hit)) return;
        hit.y = Math.max(2, hit.y);
        if (drag.type === "ee" && this.onIK) this.onIK(drag.index, hit.clone());
        else if (drag.type === "kf" && this.onKfDrag) this.onKfDrag(drag.index, hit.clone());
        else if (drag.type === "node" && this.onNodeDrag) this.onNodeDrag(drag.index, hit.clone());
      } else if (drag.type === "joint") {
        if (!ray.ray.intersectPlane(drag.plane, hit)) return;
        // 把 3D 增量转为屏幕像素增量
        const startNdc = drag.start.clone().project(this.camera);
        const hitNdc = hit.clone().project(this.camera);
        const w = this.renderer.domElement.width;
        const h = this.renderer.domElement.height;
        const dx = (hitNdc.x - startNdc.x) * w / 2;
        const dy = (hitNdc.y - startNdc.y) * h / 2;
        if (this.onJointDrag) this.onJointDrag(drag.index, dx, dy);
        drag.start.copy(hit);
      }
    });

    window.addEventListener("pointerup", (e) => {
      if (drag) {
        if (drag.type === "ee" && this.onIKDrop) this.onIKDrop(drag.index, hit.clone());
        if (drag.type === "kf" && this.onKfDragEnd) this.onKfDragEnd(drag.index);
        if (drag.type === "node" && this.onNodeDrop) this.onNodeDrop(drag.index, hit.clone());
        if (drag.type === "joint" && this.onJointDragEnd) this.onJointDragEnd(drag.index);
        if ((drag.type === "gizmoT" || drag.type === "gizmoR") && this.onGizmoEnd) this.onGizmoEnd(this._selNode);
        if (drag.type === "click" && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) {
          ndc(e); ray.setFromCamera(mouse, this.camera);
          const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.clickPlaneY); // 水平面 y=clickPlaneY
          if (ray.ray.intersectPlane(plane, hit) && this.onClickPoint) this.onClickPoint(hit.clone());
        }
        // CAD 自由放置点击
        if (drag.type === "cadclick" && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) {
          ndc(e); ray.setFromCamera(mouse, this.camera);
          const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.clickPlaneY);
          if (ray.ray.intersectPlane(plane, hit) && this.onCadClickPoint) this.onCadClickPoint(hit.clone());
        }
      }
      drag = null;
    });
  }

  /* TCP 轨迹：viz={pts:[{pos,speed}],vmax} 按速度着色的折线 */
  updateTcp(viz) {
    [...this.pathGroup.children].forEach((o) => this.pathGroup.remove(o));
    if (viz && viz.pts.length >= 2) {
      const pos = [], col = [];
      viz.pts.forEach((p) => {
        pos.push(p.pos.x, p.pos.y, p.pos.z);
        const c = Motion.speedColor(p.speed, viz.vmax);
        col.push(c.r, c.g, c.b);
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      this.pathGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true })));
    }
  }

  /* 关键帧路点：可点选/拖动的句柄（仅动作模式显示），selIdx 高亮 */
  setKfHandles(points, selIdx) {
    [...this.kfHandleGroup.children].forEach((o) => this.kfHandleGroup.remove(o));
    this._kfHandles = [];
    if (this.mode !== "pose") return;
    (points || []).forEach((p, i) => {
      const sel = i === selIdx;
      const m = new THREE.Mesh(new THREE.SphereGeometry(sel ? 14 : 10, 16, 12),
        new THREE.MeshBasicMaterial({ color: sel ? 0xffce6b : 0x3da9ff }));
      m.position.copy(p);
      this.kfHandleGroup.add(m);
      this._kfHandles.push({ mesh: m, kind: "kf", index: i });

      // 坐标标签精灵（纯视觉，不参与拾取）
      const text = `(${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)})`;
      const label = this._makeLabel(text, sel);
      if (label) {
        label.position.copy(p);
        label.position.y += sel ? 28 : 22;
        this.kfHandleGroup.add(label);
      }
    });
  }

  /* 创建坐标文字精灵 */
  _makeLabel(text, selected) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = 256;
    canvas.height = 64;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = "bold 28px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // 背景
    const tw = ctx.measureText(text).width;
    const pad = 10;
    ctx.fillStyle = selected ? "rgba(255,206,107,0.9)" : "rgba(15,20,25,0.85)";
    const bw = Math.max(tw + pad * 2, 40);
    const bx = (canvas.width - bw) / 2;
    const r = 6;
    ctx.beginPath();
    ctx.moveTo(bx + r, 10); ctx.lineTo(bx + bw - r, 10);
    ctx.quadraticCurveTo(bx + bw, 10, bx + bw, 10 + r);
    ctx.lineTo(bx + bw, 54 - r);
    ctx.quadraticCurveTo(bx + bw, 54, bx + bw - r, 54);
    ctx.lineTo(bx + r, 54);
    ctx.quadraticCurveTo(bx, 54, bx, 54 - r);
    ctx.lineTo(bx, 10 + r);
    ctx.quadraticCurveTo(bx, 10, bx + r, 10);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = selected ? "#ffce6b" : "#3da9ff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = selected ? "#1a1207" : "#e6edf3";
    ctx.fillText(text, canvas.width / 2, 33);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(90, 22, 1);
    return sprite;
  }

  /* 在选中零件周围显示尺寸标注 */
  updateDimensions(selIdx) {
    [...this._dimGroup.children].forEach((o) => this._dimGroup.remove(o));
    if (!this.showDimensions || selIdx < 0 || !this.model) return;
    const m = this.model, fk = m.forward(m.q);
    const n = m.nodes[selIdx];
    if (!n) return;
    const pos = fk.jointPos[selIdx];
    // 根据几何估算外框
    let halfW = 30, halfD = 30, halfH = 20;
    if (n.geometry && n.geometry.shape) {
      const p = n.geometry.shape.params || {};
      switch (n.geometry.shape.type) {
        case "box": halfW = (p.width || 40) / 2; halfD = (p.depth || 40) / 2; halfH = (p.height || 30) / 2; break;
        case "cylinder": halfW = p.radius || 20; halfD = p.radius || 20; halfH = (p.height || 40) / 2; break;
        case "sphere": halfW = halfD = halfH = p.radius || 25; break;
        case "extrude": halfW = 30; halfD = 30; halfH = (n.geometry.shape.depth || 30) / 2; break;
      }
    } else if (n.linkShape) {
      const ls = n.linkShape;
      if (ls.type === "box") { halfW = (ls.w || 16) / 2; halfD = (ls.d || 16) / 2; }
      else { halfW = halfD = ls.radius || 9; }
    }
    const labels = [
      { text: `W ${(halfW * 2).toFixed(0)} mm`, pos: new THREE.Vector3(pos.x + halfW + 20, pos.y, pos.z) },
      { text: `D ${(halfD * 2).toFixed(0)} mm`, pos: new THREE.Vector3(pos.x, pos.y, pos.z + halfD + 20) },
      { text: `H ${(halfH * 2).toFixed(0)} mm`, pos: new THREE.Vector3(pos.x, pos.y + halfH + 20, pos.z) },
      { text: `(${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)})`, pos: new THREE.Vector3(pos.x, pos.y - halfH - 20, pos.z) },
    ];
    labels.forEach((l) => {
      const sprite = this._makeLabel(l.text, false);
      sprite.position.copy(l.pos);
      sprite.scale.set(120, 26, 1);
      this._dimGroup.add(sprite);
    });
  }

  _resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /* ---- 草图平面可视化 ---- */
  showSketchPlane(plane, pos) {
    [...this._sketchPlaneGroup.children].forEach((o) => this._sketchPlaneGroup.remove(o));
    const grid = Shapes.sketchPlaneGrid(plane, 400, 8);
    grid.position.copy(pos || new THREE.Vector3(0, 0, 0));
    this._sketchPlaneGroup.add(grid);
  }
  hideSketchPlane() {
    [...this._sketchPlaneGroup.children].forEach((o) => this._sketchPlaneGroup.remove(o));
  }

  /* ---- 选中多边形顶点高亮 ---- */
  setVertexHandles(points, selIdx) {
    [...this.kfHandleGroup.children].forEach((o) => this.kfHandleGroup.remove(o));
    this._kfHandles = [];
    (points || []).forEach((p, i) => {
      const sel = i === selIdx;
      const m = new THREE.Mesh(new THREE.SphereGeometry(sel ? 10 : 7, 12, 10),
        new THREE.MeshBasicMaterial({ color: sel ? 0xffce6b : 0x46d369 }));
      m.position.set(p[0], 0, p[1]);
      this.kfHandleGroup.add(m);
      this._kfHandles.push({ mesh: m, kind: "kf", index: i });
    });
  }
  clearVertexHandles() {
    [...this.kfHandleGroup.children].forEach((o) => this.kfHandleGroup.remove(o));
    this._kfHandles = [];
  }

  _animate() { requestAnimationFrame(() => this._animate()); this.renderer.render(this.scene, this.camera); }
}
