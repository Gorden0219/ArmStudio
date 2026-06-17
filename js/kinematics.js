/* ============================================================
 * kinematics.js — 通用机器人树模型 + 运动学 + 内置预设
 *
 * 模型 = 一棵节点树。每个节点 = (连接到父节点的关节) + (连杆几何)。
 *   node = {
 *     name, parent(索引,-1为根),
 *     joint: { type:'revolute'|'continuous'|'prismatic'|'fixed',
 *              axis:Vec3, origin:Vec3(相对父节点的平移), limit:[min,max] },
 *     geometry: 可选 {type:'box'|'cylinder'|'sphere', size:[...]}（用于根/机身等显式形状）
 *     endEffector: bool（是否为可拖拽求解的末端）
 *   }
 * 单位：长度 mm；revolute 限位与关节值用弧度；prismatic 用 mm。
 * 坐标系 Y 轴向上。节点须按拓扑序（父索引 < 子索引）。
 * ============================================================ */

const Kin = (function () {
  const V3 = THREE.Vector3;
  const M4 = THREE.Matrix4;
  const deg = (r) => (r * 180) / Math.PI;
  const rad = (d) => (d * Math.PI) / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // RPY(绕固定轴 X→Y→Z) → 四元数
  function quatFromRPY(r, p, y) {
    const qx = new THREE.Quaternion().setFromAxisAngle(new V3(1, 0, 0), r);
    const qy = new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), p);
    const qz = new THREE.Quaternion().setFromAxisAngle(new V3(0, 0, 1), y);
    return qz.multiply(qy).multiply(qx);
  }

  class RobotModel {
    constructor(def) {
      this.name = def.name || "机器人";
      this.type = def.type || "custom";
      this.hasGripper = def.hasGripper ?? this.type === "arm";
      this.nodes = (def.links || def.nodes).map((n) => this._normNode(n));
      // home 在预设/JSON 中以度(revolute)给出 → 内部统一转弧度
      const rawHome = def.home || this.nodes.map(() => 0);
      this.home = rawHome.map((v, i) => {
        const t = this.nodes[i] && this.nodes[i].joint.type;
        return t === "revolute" || t === "continuous" ? rad(v) : v;
      });
      this.q = this.home.slice();
    }

    _normNode(n) {
      const j = n.joint || { type: "fixed" };
      const isRev = j.type === "revolute" || j.type === "continuous";
      const lim = j.limit || (isRev ? [-180, 180] : [0, 200]);
      // 节点固定姿态偏移：支持 rot([x,y,z,w] 四元数) 或 rpy([roll,pitch,yaw] 弧度)
      let rot = new THREE.Quaternion();
      if (n.rot) rot.fromArray(n.rot);
      else if (n.rpy) rot = quatFromRPY(n.rpy[0], n.rpy[1], n.rpy[2]);
      return {
        name: n.name || "node",
        parent: n.parent ?? -1,
        rot,
        joint: {
          type: j.type || "fixed",
          axis: new V3().fromArray(j.axis || [0, 0, 1]).normalize(),
          origin: new V3().fromArray(j.origin || [0, 0, 0]),
          limit: isRev ? [rad(lim[0]), rad(lim[1])] : lim.slice(), // 内部弧度/mm
        },
        geometry: n.geometry || null,
        linkShape: n.linkShape || null,   // {type:'cylinder'|'box', radius?, w?, d?}
        color: n.color || null,           // 外观颜色 '#rrggbb'
        endEffector: !!n.endEffector,
      };
    }

    isMovable(i) {
      const t = this.nodes[i].joint.type;
      return t === "revolute" || t === "continuous" || t === "prismatic";
    }
    movableIndices() { return this.nodes.map((_, i) => i).filter((i) => this.isMovable(i)); }
    endEffectors() { return this.nodes.map((_, i) => i).filter((i) => this.nodes[i].endEffector); }

    /* 正运动学：返回每节点世界矩阵、关节位置(旋转支点)、世界旋转轴、连杆起点 */
    forward(q) {
      q = q || this.q;
      const world = [], jointPos = [], worldAxis = [], linkStart = [];
      for (let i = 0; i < this.nodes.length; i++) {
        const n = this.nodes[i];
        const pw = n.parent < 0 ? new M4() : world[n.parent];
        const afterOrigin = pw.clone().multiply(
          new M4().makeTranslation(n.joint.origin.x, n.joint.origin.y, n.joint.origin.z)
        ).multiply(new M4().makeRotationFromQuaternion(n.rot));
        const jp = new V3().setFromMatrixPosition(afterOrigin);
        const rot = new M4().extractRotation(afterOrigin);
        worldAxis[i] = n.joint.axis.clone().applyMatrix4(rot).normalize();
        jointPos[i] = jp;
        linkStart[i] = n.parent < 0 ? jp.clone() : new V3().setFromMatrixPosition(world[n.parent]);

        let W = afterOrigin;
        const qi = q[i] || 0;
        if (n.joint.type === "revolute" || n.joint.type === "continuous") {
          W = afterOrigin.clone().multiply(new M4().makeRotationAxis(n.joint.axis, qi));
        } else if (n.joint.type === "prismatic") {
          const t = n.joint.axis.clone().multiplyScalar(qi);
          W = afterOrigin.clone().multiply(new M4().makeTranslation(t.x, t.y, t.z));
        }
        world[i] = W;
      }
      return { world, jointPos, worldAxis, linkStart };
    }

    eePosition(i, q) { return new V3().setFromMatrixPosition(this.forward(q).world[i]); }

    /* 末端节点 ee 到根的可动关节链（根→末端顺序） */
    chainTo(ee) {
      const chain = [];
      let i = ee;
      while (i >= 0) { if (this.isMovable(i)) chain.push(i); i = this.nodes[i].parent; }
      return chain.reverse();
    }

    /* CCD 逆解：只调整 ee 所在链上的关节，把 ee 拉向 target */
    solveIK(ee, target, opts) {
      opts = opts || {};
      const maxIter = opts.maxIter || 50;
      const tol = opts.tol || 1.0;
      const damping = opts.damping ?? 0.55;
      const chain = this.chainTo(ee);
      const q = this.q.slice();

      for (let iter = 0; iter < maxIter; iter++) {
        const fk = this.forward(q);
        const end = new V3().setFromMatrixPosition(fk.world[ee]);
        if (end.distanceTo(target) < tol) break;

        for (let c = chain.length - 1; c >= 0; c--) {
          const i = chain[c];
          const f = this.forward(q);
          const endP = new V3().setFromMatrixPosition(f.world[ee]);
          const jp = f.jointPos[i];
          const axis = f.worldAxis[i];
          const lim = this.nodes[i].joint.limit;

          if (this.nodes[i].joint.type === "prismatic") {
            const move = target.clone().sub(endP).dot(axis) * damping;
            q[i] = clamp(q[i] + move, lim[0], lim[1]);
          } else {
            const toEnd = endP.clone().sub(jp);
            const toTgt = target.clone().sub(jp);
            const e = toEnd.sub(axis.clone().multiplyScalar(toEnd.dot(axis)));
            const t = toTgt.sub(axis.clone().multiplyScalar(toTgt.dot(axis)));
            if (e.length() < 1e-4 || t.length() < 1e-4) continue;
            e.normalize(); t.normalize();
            let ang = Math.acos(clamp(e.dot(t), -1, 1));
            if (new V3().crossVectors(e, t).dot(axis) < 0) ang = -ang;
            ang *= damping;
            let nv = q[i] + ang;
            if (this.nodes[i].joint.type === "revolute") nv = clamp(nv, lim[0], lim[1]);
            q[i] = nv;
          }
        }
      }
      const fk = this.forward(q);
      const reached = new V3().setFromMatrixPosition(fk.world[ee]);
      return { q, error: reached.distanceTo(target), reached };
    }

    /* 导出为自定义 JSON */
    toJSON() {
      return {
        name: this.name, type: this.type, hasGripper: this.hasGripper,
        home: this.home.map((v, i) =>
          this.nodes[i] && (this.nodes[i].joint.type === "revolute" || this.nodes[i].joint.type === "continuous")
            ? +deg(v).toFixed(2) : +(+v).toFixed(2)),
        links: this.nodes.map((n) => ({
          name: n.name, parent: n.parent,
          rot: n.rot.toArray().map((x) => +x.toFixed(5)),
          joint: {
            type: n.joint.type,
            axis: n.joint.axis.toArray().map((x) => +x.toFixed(4)),
            origin: n.joint.origin.toArray().map((x) => +x.toFixed(2)),
            limit: (n.joint.type === "revolute" || n.joint.type === "continuous")
              ? n.joint.limit.map((x) => +deg(x).toFixed(1)) : n.joint.limit.slice(),
          },
          geometry: n.geometry, linkShape: n.linkShape, color: n.color, endEffector: n.endEffector,
        })),
      };
    }
  }

  return { RobotModel, deg, rad, clamp, V3, M4, quatFromRPY };
})();
