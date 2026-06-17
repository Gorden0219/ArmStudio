/* ============================================================
 * motion.js — 主流工业机器人运动规划
 *   · 运动类型 PTP(MoveJ) / LIN(MoveL) / CIRC(MoveC)
 *   · 梯形速度曲线（含三角形退化），计算节拍与瞬时速度
 *   · 三点圆弧插值（MoveC）
 *   · 按段规划 + TCP 轨迹采样（供可视化）
 * 速度单位 mm/s，加速度 mm/s²，时间 s，长度 mm
 * ============================================================ */

const Motion = (function () {
  const V3 = THREE.Vector3;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerpArr = (a, b, u) => a.map((v, i) => v + ((b[i] ?? v) - v) * u);

  /* 梯形速度曲线段时长 */
  function segTime(L, v, a) {
    if (L <= 1e-6) return 0.15;
    v = Math.max(v, 1); a = Math.max(a, 1);
    const da = (v * v) / (2 * a);          // 加速段距离
    if (2 * da <= L) return 2 * (v / a) + (L - 2 * da) / v; // 梯形
    return 2 * Math.sqrt(L / a);            // 三角形
  }

  /* t 时刻已走过的距离比例 (0..1) */
  function profileFrac(t, T, L, v, a) {
    if (L <= 1e-6 || T <= 0) return 1;
    v = Math.max(v, 1); a = Math.max(a, 1);
    const da = (v * v) / (2 * a);
    let d;
    if (2 * da <= L) {                       // 梯形
      const ta = v / a;
      if (t < ta) d = 0.5 * a * t * t;
      else if (t <= T - ta) d = da + v * (t - ta);
      else { const td = T - t; d = L - 0.5 * a * td * td; }
    } else {                                 // 三角形
      const tp = T / 2;
      if (t < tp) d = 0.5 * a * t * t;
      else { const td = T - t; d = L - 0.5 * a * td * td; }
    }
    return clamp(d / L, 0, 1);
  }

  /* t 时刻瞬时速度 (mm/s) */
  function speedAt(t, T, L, v, a) {
    if (L <= 1e-6 || T <= 0) return 0;
    v = Math.max(v, 1); a = Math.max(a, 1);
    const da = (v * v) / (2 * a);
    if (2 * da <= L) {
      const ta = v / a;
      if (t < ta) return a * t;
      if (t <= T - ta) return v;
      return Math.max(0, a * (T - t));
    }
    const tp = T / 2;
    return t < tp ? a * t : Math.max(0, a * (T - t));
  }

  /* 三点外接圆圆心 */
  function circumcenter(P0, P1, P2) {
    const a = P1.clone().sub(P0), b = P2.clone().sub(P0);
    const n = new V3().crossVectors(a, b);
    const n2 = n.dot(n);
    if (n2 < 1e-9) return null;            // 三点共线
    const t1 = new V3().crossVectors(b, n).multiplyScalar(a.dot(a));
    const t2 = new V3().crossVectors(n, a).multiplyScalar(b.dot(b));
    return P0.clone().add(t1.add(t2).multiplyScalar(1 / (2 * n2)));
  }

  /* 构造经 P0→P1→P2 的圆弧；返回 {point(u), length}；共线则退化为直线 */
  function makeArc(P0, P1, P2) {
    const C = circumcenter(P0, P1, P2);
    if (!C) return { point: (u) => P0.clone().lerp(P2, u), length: P0.distanceTo(P2) };
    const e1 = P0.clone().sub(C); const r = e1.length(); e1.normalize();
    const nrm = new V3().crossVectors(P1.clone().sub(P0), P2.clone().sub(P0)).normalize();
    const e2 = new V3().crossVectors(nrm, e1).normalize();
    const ang = (P) => { const v = P.clone().sub(C); return Math.atan2(v.dot(e2), v.dot(e1)); };
    const norm = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const th1 = norm(ang(P1)), th2 = norm(ang(P2));
    let dir, total;
    if (th1 < th2) { dir = 1; total = th2; }       // 逆时针经过 P1
    else { dir = -1; total = 2 * Math.PI - th2; }   // 顺时针
    return {
      point: (u) => {
        const th = dir * total * u;
        return C.clone().addScaledVector(e1, r * Math.cos(th)).addScaledVector(e2, r * Math.sin(th));
      },
      length: r * total,
    };
  }

  /* 由起终点自动生成圆弧途经点（垂直于弦方向凸起 bulge mm） */
  function viaPoint(P0, P2, bulge) {
    const mid = P0.clone().add(P2).multiplyScalar(0.5);
    const d = P2.clone().sub(P0);
    if (d.length() < 1e-3) return mid;
    let ref = new V3(0, 1, 0);
    if (Math.abs(d.clone().normalize().dot(ref)) > 0.95) ref = new V3(1, 0, 0);
    const bdir = new V3().crossVectors(new V3().crossVectors(d, ref), d).normalize();
    return mid.addScaledVector(bdir, bulge || 60);
  }

  /* 规划整条轨迹：返回每段的几何/时序与采样器，以及节拍与可视化点 */
  function plan(model, ee, frames, scale) {
    scale = scale || 1;
    const segs = [];
    let cum = 0;
    const eePos = (q) => (ee != null ? model.eePosition(ee, q) : new V3());

    for (let i = 1; i < frames.length; i++) {
      const A = frames[i - 1], B = frames[i];
      const motion = ee == null ? "PTP" : (B.motion || "PTP");
      const v = (B.speed || 150) * scale, a = (B.acc || 600) * scale;
      const pa = eePos(A.q), pb = eePos(B.q);

      let L, geom = null;
      if (motion === "LIN") { L = pa.distanceTo(pb); geom = { point: (u) => pa.clone().lerp(pb, u) }; }
      else if (motion === "CIRC") { const arc = makeArc(pa, viaPoint(pa, pb, B.bulge), pb); L = arc.length; geom = arc; }
      else { // PTP：用 TCP 直线距离作节拍估算（实际路径由关节插值得到）
        L = Math.max(pa.distanceTo(pb), jointSpan(model, A.q, B.q));
      }

      const sample = (u) => {
        const baseQ = lerpArr(A.q, B.q, u);
        if (motion === "PTP" || ee == null) return baseQ;
        model.q = baseQ.slice();
        const r = model.solveIK(ee, geom.point(u));
        return r.q;
      };
      const T = Math.max(segTime(L, v, a), 0.15);
      segs.push({ i, motion, L, v, a, T, t0: cum, gripFrom: A.grip, gripTo: B.grip, sample, geom, pa, pb });
      cum += T;
    }

    const totalT = cum;
    return { segs, totalT, sampleViz: (perSeg) => vizPoints(model, ee, segs, perSeg) };
  }

  // 关节变化幅度（作为无 TCP 时的节拍代理，deg→mm 粗略折算）
  function jointSpan(model, qa, qb) {
    let s = 0;
    model.movableIndices().forEach((i) => { s += Math.abs((qb[i] ?? 0) - (qa[i] ?? 0)); });
    return s * 60; // ~每弧度当作 60mm
  }

  /* 按时间均匀采样各段，返回 {pos, speed} 列表（速度用于着色） */
  function vizPoints(model, ee, segs, perSeg) {
    perSeg = perSeg || 18;
    const pts = [];
    const save = model.q.slice();
    let vmax = 1;
    segs.forEach((s) => {
      for (let k = 0; k <= perSeg; k++) {
        const t = (s.T * k) / perSeg;
        const u = profileFrac(t, s.T, s.L, s.v, s.a);
        const q = s.sample(u);
        const pos = ee != null ? model.eePosition(ee, q) : new V3();
        const sp = speedAt(t, s.T, s.L, s.v, s.a);
        vmax = Math.max(vmax, sp);
        pts.push({ pos, speed: sp });
      }
    });
    model.q = save;
    return { pts, vmax };
  }

  /* 速度 → 颜色（蓝慢 → 青 → 橙快） */
  function speedColor(sp, vmax) {
    const f = clamp(sp / (vmax || 1), 0, 1);
    // 0:蓝(0.6) → 0.5:青 → 1:橙(0.08)
    const hue = 0.6 - 0.52 * f;
    return new THREE.Color().setHSL(hue, 0.85, 0.55);
  }

  return { segTime, profileFrac, speedAt, makeArc, viaPoint, circumcenter, plan, speedColor };
})();
