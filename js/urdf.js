/* ============================================================
 * urdf.js — 简化 URDF 解析器（解析常见子集）
 * 支持: <link name>, <joint type parent child origin axis limit>
 * 关节类型: revolute / continuous / prismatic / fixed
 * 把 URDF 的 link/joint 关系转成本软件的节点树（自定义 JSON）
 *
 * 说明: URDF 用米/弧度、Z 轴常向上。这里转为 mm，并将 Z-up 映射到本软件 Y-up
 *       （绕 X 轴 -90°），坐标做近似换算，足以用于可视化与轨迹设计。
 * ============================================================ */

const URDF = (function () {
  const num = (s, d = 0) => { const v = parseFloat(s); return isNaN(v) ? d : v; };
  const xyz = (s) => (s || "0 0 0").trim().split(/\s+/).map(Number);

  // URDF(Z-up, m) → 本软件(Y-up, mm):  (x,y,z)_urdf → (x*1000, z*1000, -y*1000)
  const M = 1000;
  const toLocal = (v) => [v[0] * M, v[2] * M, -v[1] * M];
  const axisLocal = (v) => { const a = [v[0], v[2], -v[1]]; const n = Math.hypot(...a) || 1; return a.map((x) => x / n); };

  function parse(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("URDF 解析失败：XML 格式错误");

    const linkEls = [...doc.querySelectorAll("robot > link")];
    const jointEls = [...doc.querySelectorAll("robot > joint")];
    if (!linkEls.length) throw new Error("URDF 中未找到 <link>");

    const name = doc.querySelector("robot")?.getAttribute("name") || "URDF 机器人";

    // child link -> joint（每个非根 link 由一个 joint 连接到 parent）
    const jointByChild = {};
    jointEls.forEach((j) => {
      const child = j.querySelector("child")?.getAttribute("link");
      if (child) jointByChild[child] = j;
    });

    // 找根 link（不作为任何 joint 的 child）
    const childSet = new Set(Object.keys(jointByChild));
    const roots = linkEls.map((l) => l.getAttribute("name")).filter((n) => !childSet.has(n));
    const rootName = roots[0] || linkEls[0].getAttribute("name");

    // 拓扑排序（BFS from root）
    const childrenOf = {};
    jointEls.forEach((j) => {
      const p = j.querySelector("parent")?.getAttribute("link");
      const c = j.querySelector("child")?.getAttribute("link");
      if (p && c) (childrenOf[p] = childrenOf[p] || []).push(c);
    });
    const order = [], indexOf = {};
    const queue = [rootName];
    while (queue.length) {
      const nm = queue.shift();
      if (indexOf[nm] !== undefined) continue;
      indexOf[nm] = order.length; order.push(nm);
      (childrenOf[nm] || []).forEach((c) => queue.push(c));
    }
    // 补上未连通的 link
    linkEls.forEach((l) => { const nm = l.getAttribute("name"); if (indexOf[nm] === undefined) { indexOf[nm] = order.length; order.push(nm); } });

    // 末端 = 没有子节点的 link
    const isLeaf = (nm) => !(childrenOf[nm] && childrenOf[nm].length);

    const links = order.map((nm) => {
      const j = jointByChild[nm];
      if (!j) {
        return { name: nm, parent: -1, joint: { type: "fixed", origin: [0, 0, 0] }, endEffector: isLeaf(nm) };
      }
      const parentName = j.querySelector("parent")?.getAttribute("link");
      const originEl = j.querySelector("origin");
      const origin = toLocal(xyz(originEl?.getAttribute("xyz")));
      const axisEl = j.querySelector("axis");
      const axis = axisLocal(xyz(axisEl?.getAttribute("xyz") || "0 0 1"));
      const type = j.getAttribute("type") || "fixed";
      const limEl = j.querySelector("limit");
      let limit;
      if (type === "prismatic") {
        limit = [num(limEl?.getAttribute("lower"), 0) * M, num(limEl?.getAttribute("upper"), 0.2) * M];
      } else if (type === "revolute") {
        limit = [Kin.deg(num(limEl?.getAttribute("lower"), -Math.PI)), Kin.deg(num(limEl?.getAttribute("upper"), Math.PI))];
      } else {
        limit = [-180, 180];
      }
      return {
        name: nm, parent: indexOf[parentName] ?? -1,
        joint: { type, axis, origin, limit },
        endEffector: isLeaf(nm),
      };
    });

    return { name, type: "urdf", hasGripper: false, home: links.map(() => 0), links };
  }

  return { parse };
})();
