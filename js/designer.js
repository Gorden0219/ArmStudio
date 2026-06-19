/* ============================================================
 * designer.js — 机器人结构编辑（设计模式）
 * 直接操作 RobotModel 的 nodes / q / home，并保持拓扑一致
 * ============================================================ */

const Designer = {
  /* 在父节点下新增一个子关节（默认绕 Z 旋转，向下生长）
   * opts.type: 'revolute'|'prismatic'|'fixed'|'tool'
   * opts.shape: 'box'|'cylinder'|'sphere'|'extrude' — 同时创建外形 */
  addChild(model, parentIdx, opts) {
    opts = opts || {};
    const isTool = opts.type === "tool";
    const type = isTool ? "fixed" : (opts.type || "revolute");
    const names = { revolute: "旋转关节", prismatic: "移动关节", fixed: "骨骼", tool: "工具" };
    const shapeName = opts.shape || null;
    // 带形状的新零件默认名
    const shapeLabels = { box: "方块", cylinder: "圆柱", sphere: "球体", cone: "圆锥", torus: "圆环", pyramid: "棱锥", wedge: "楔形", pipe: "管材", gear: "齿轮", extrude: "拉伸体" };
    const baseName = shapeName ? (shapeLabels[shapeName] || "零件") : (names[opts.type] || "连杆");
    const node = {
      name: baseName + model.nodes.length,
      parent: parentIdx,
      rot: new THREE.Quaternion(),
      joint: {
        type,
        axis: new Kin.V3(0, 0, 1),
        origin: new Kin.V3(0, -80, 0),
        limit: type === "prismatic" ? [0, 150] : [Kin.rad(-150), Kin.rad(150)],
      },
      geometry: shapeName ? { shape: Shapes.defaultShape(shapeName) } : (isTool ? { type: "sphere", size: [14] } : null),
      linkShape: { type: "cylinder", radius: 9 },
      color: null,
      endEffector: false,
    };
    model.nodes.push(node);
    model.q.push(0);
    model.home.push(0);
    // 新节点为当前末梢 → 标记末端；父节点不再是末端
    node.endEffector = true;
    if (model.nodes[parentIdx]) model.nodes[parentIdx].endEffector = false;
    return model.nodes.length - 1;
  },

  /* 删除某节点及其所有后代，并重映射父索引 */
  removeSubtree(model, idx) {
    if (idx === 0) return false; // 不允许删根
    const remove = new Set([idx]);
    let grew = true;
    while (grew) {
      grew = false;
      model.nodes.forEach((n, i) => { if (remove.has(n.parent) && !remove.has(i)) { remove.add(i); grew = true; } });
    }
    const keep = model.nodes.map((_, i) => i).filter((i) => !remove.has(i));
    const map = {}; keep.forEach((old, ni) => (map[old] = ni));
    const newNodes = [], newQ = [], newHome = [];
    keep.forEach((old) => {
      const n = model.nodes[old];
      n.parent = n.parent < 0 ? -1 : map[n.parent];
      newNodes.push(n); newQ.push(model.q[old]); newHome.push(model.home[old]);
    });
    model.nodes = newNodes; model.q = newQ; model.home = newHome;
    return true;
  },

  /* 拖动节点：把世界坐标换算为相对父节点的 origin */
  setOriginFromWorld(model, idx, worldPoint) {
    const n = model.nodes[idx];
    if (n.parent < 0) { n.joint.origin.copy(worldPoint); return; }
    const fk = model.forward(model.q);
    const inv = new Kin.M4().copy(fk.world[n.parent]).invert();
    n.joint.origin.copy(worldPoint.clone().applyMatrix4(inv));
  },

  // 父节点世界旋转（用于把世界轴换算到父坐标系）
  _parentRot(model, idx) {
    const n = model.nodes[idx];
    if (n.parent < 0) return new Kin.M4();
    return new Kin.M4().extractRotation(model.forward(model.q).world[n.parent]);
  },

  /* Gizmo 平移：沿世界轴移动 delta(mm)，换算进父坐标系叠加到 origin，可吸附 */
  translate(model, idx, worldAxis, delta, snap) {
    const n = model.nodes[idx];
    const invRot = this._parentRot(model, idx).invert();
    const dParent = worldAxis.clone().multiplyScalar(delta).applyMatrix4(invRot);
    n.joint.origin.add(dParent);
    if (snap && snap > 0) {
      const o = n.joint.origin;
      o.set(Math.round(o.x / snap) * snap, Math.round(o.y / snap) * snap, Math.round(o.z / snap) * snap);
    }
  },

  /* Gizmo 旋转：绕世界轴转 dAngle，作用到节点 rot（连同子树一起转） */
  rotate(model, idx, worldAxis, dAngle) {
    const n = model.nodes[idx];
    const invRot = this._parentRot(model, idx).invert();
    const axisParent = worldAxis.clone().applyMatrix4(invRot).normalize();
    const dq = new THREE.Quaternion().setFromAxisAngle(axisParent, dAngle);
    n.rot.premultiply(dq).normalize();
  },

  setOrigin(model, idx, x, y, z) { model.nodes[idx].joint.origin.set(x, y, z); },
  resetRot(model, idx) { model.nodes[idx].rot.set(0, 0, 0, 1); },

  /* 连杆形状/尺寸 */
  setLinkShape(model, idx, shape) { model.nodes[idx].linkShape = shape; },
  setColor(model, idx, hex) { model.nodes[idx].color = hex; },
  setGeometry(model, idx, geom) { model.nodes[idx].geometry = geom; },

  /* 新建空白机器人（仅一个底座） */
  blank() {
    return {
      name: "自定义机器人", type: "custom", hasGripper: false, home: [0],
      links: [{ name: "base 底座", parent: -1, joint: { type: "fixed", origin: [0, 0, 0] },
        geometry: { type: "cylinder", size: [45, 30] } }],
    };
  },

  setType(model, idx, type) {
    const j = model.nodes[idx].joint;
    j.type = type;
    if (type === "prismatic") j.limit = [0, 150];
    else if (type === "revolute") j.limit = [Kin.rad(-150), Kin.rad(150)];
  },
  setAxis(model, idx, axisName) {
    const map = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
    model.nodes[idx].joint.axis.fromArray(map[axisName]);
  },
  setLimit(model, idx, lo, hi) {
    const j = model.nodes[idx].joint;
    j.limit = j.type === "prismatic" ? [lo, hi] : [Kin.rad(lo), Kin.rad(hi)];
  },
  toggleEE(model, idx) { model.nodes[idx].endEffector = !model.nodes[idx].endEffector; },
  rename(model, idx, name) { model.nodes[idx].name = name; },

  /* 把当前姿态设为初始姿态 */
  setHomeToCurrent(model) { model.home = model.q.slice(); },

  /* ---- 镜像 ---- */
  /* plane: 'XY'|'YZ'|'XZ' — 镜像对称平面 */
  mirrorPart(model, idx, plane) {
    const src = model.nodes[idx];
    const ni = this.addChild(model, src.parent, { type: "fixed" });
    const dst = model.nodes[ni];
    dst.name = src.name + "_mirror";
    dst.color = src.color;
    dst.linkShape = src.linkShape ? Object.assign({}, src.linkShape) : null;
    dst.geometry = src.geometry ? JSON.parse(JSON.stringify(src.geometry)) : null;
    dst.endEffector = src.endEffector;
    // 镜像原点
    const o = src.joint.origin;
    if (plane === "XY") dst.joint.origin.set(o.x, o.y, -o.z);
    else if (plane === "YZ") dst.joint.origin.set(-o.x, o.y, o.z);
    else if (plane === "XZ") dst.joint.origin.set(o.x, -o.y, o.z);
    // 镜像朝向(旋转)
    const q = src.rot;
    if (plane === "XY") dst.rot.set(q.x, q.y, -q.z, q.w);
    else if (plane === "YZ") dst.rot.set(-q.x, q.y, q.z, q.w);
    else if (plane === "XZ") dst.rot.set(q.x, -q.y, q.z, q.w);
    return ni;
  },

  /* ---- 线性阵列 ---- */
  patternLinear(model, idx, count, dx, dy, dz) {
    if (count < 2) return [idx];
    const indices = [idx];
    const src = model.nodes[idx];
    // 排除末端标记：父节点仍是末端
    for (let k = 1; k < count; k++) {
      const ni = this.addChild(model, src.parent, { type: "fixed" });
      const dst = model.nodes[ni];
      dst.name = src.name + "_" + (k + 1);
      dst.color = src.color;
      dst.linkShape = src.linkShape ? Object.assign({}, src.linkShape) : null;
      dst.geometry = src.geometry ? JSON.parse(JSON.stringify(src.geometry)) : null;
      dst.endEffector = src.endEffector;
      dst.joint.origin.set(src.joint.origin.x + dx * k, src.joint.origin.y + dy * k, src.joint.origin.z + dz * k);
      dst.rot.copy(src.rot);
      indices.push(ni);
    }
    return indices;
  },

  /* ---- 圆周阵列 ---- */
  patternCircular(model, idx, count, centerX, centerZ, startAngle, totalAngle) {
    if (count < 2) return [idx];
    const indices = [idx];
    const src = model.nodes[idx];
    const o = src.joint.origin;
    const cx = o.x, cz = o.z;
    const sa = (startAngle || 0) * Math.PI / 180;
    const ta = (totalAngle || 360) * Math.PI / 180;
    for (let k = 1; k < count; k++) {
      const angle = sa + (ta * k) / count;
      const nx = cx + (o.x - cx) * Math.cos(angle) - (o.z - cz) * Math.sin(angle);
      const nz = cz + (o.x - cx) * Math.sin(angle) + (o.z - cz) * Math.cos(angle);
      const ni = this.addChild(model, src.parent, { type: "fixed" });
      const dst = model.nodes[ni];
      dst.name = src.name + "_" + (k + 1);
      dst.color = src.color;
      dst.linkShape = src.linkShape ? Object.assign({}, src.linkShape) : null;
      dst.geometry = src.geometry ? JSON.parse(JSON.stringify(src.geometry)) : null;
      dst.endEffector = src.endEffector;
      dst.joint.origin.set(nx, o.y, nz);
      dst.rot.copy(src.rot);
      indices.push(ni);
    }
    return indices;
  },
};
