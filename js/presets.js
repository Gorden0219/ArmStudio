/* ============================================================
 * presets.js — 内置机器人定义（自定义 JSON 格式）
 * 角度单位：度；长度：mm。节点按父<子拓扑序排列。
 * ============================================================ */

const Presets = {
  /* 6 轴机械臂：单链，6 个旋转关节 + 末端夹爪 */
  arm6: {
    name: "6 轴机械臂",
    type: "arm",
    hasGripper: true,
    home: [0, -20, 40, -20, 0, 0, 0],
    links: [
      { name: "base 底座旋转", parent: -1, joint: { type: "revolute", axis: [0, 1, 0], origin: [0, 0, 0], limit: [-180, 180] }, geometry: { type: "cylinder", size: [50, 30] } },
      { name: "J2 肩部", parent: 0, joint: { type: "revolute", axis: [0, 0, 1], origin: [0, 70, 0], limit: [-110, 110] } },
      { name: "J3 肘部", parent: 1, joint: { type: "revolute", axis: [0, 0, 1], origin: [0, 150, 0], limit: [-135, 135] } },
      { name: "J4 腕俯仰", parent: 2, joint: { type: "revolute", axis: [0, 0, 1], origin: [0, 130, 0], limit: [-120, 120] } },
      { name: "J5 腕翻转", parent: 3, joint: { type: "revolute", axis: [0, 1, 0], origin: [0, 70, 0], limit: [-180, 180] } },
      { name: "J6 腕旋转", parent: 4, joint: { type: "revolute", axis: [0, 0, 1], origin: [0, 45, 0], limit: [-180, 180] } },
      { name: "tip 末端", parent: 5, joint: { type: "fixed", origin: [0, 40, 0] }, endEffector: true },
    ],
  },

  /* 四足机器人：机身 + 4 条腿（髋 + 膝），4 个足端为末端执行器 */
  quad: (function () {
    const corners = [
      ["RF 右前", 95, 55], ["LF 左前", 95, -55],
      ["RH 右后", -95, 55], ["LH 左后", -95, -55],
    ];
    const links = [
      { name: "body 机身", parent: -1, joint: { type: "fixed", origin: [0, 170, 0] }, geometry: { type: "box", size: [240, 50, 150] } },
    ];
    const home = [0];
    corners.forEach(([nm, x, z]) => {
      const hip = links.length;
      links.push({ name: nm + " 髋", parent: 0, joint: { type: "revolute", axis: [0, 0, 1], origin: [x, -10, z], limit: [-70, 70] } });
      links.push({ name: nm + " 膝", parent: hip, joint: { type: "revolute", axis: [0, 0, 1], origin: [0, -85, 0], limit: [-120, 10] } });
      links.push({ name: nm + " 足", parent: hip + 1, joint: { type: "fixed", origin: [0, -85, 0] }, endEffector: true });
      home.push(15, -35, 0); // 髋, 膝, 足(fixed)
    });
    return { name: "四足机器人", type: "legged", hasGripper: false, home, links };
  })(),

  /* SCARA：2 个旋转 + 1 个升降(prismatic)，常见平面取放 */
  scara: {
    name: "SCARA 平面臂",
    type: "arm",
    hasGripper: true,
    home: [0, 0, 0, -60, 0],
    links: [
      { name: "base 立柱", parent: -1, joint: { type: "fixed", origin: [0, 30, 0] }, geometry: { type: "cylinder", size: [45, 60] } },
      { name: "J1 大臂", parent: 0, joint: { type: "revolute", axis: [0, 1, 0], origin: [0, 30, 0], limit: [-150, 150] } },
      { name: "J2 小臂", parent: 1, joint: { type: "revolute", axis: [0, 1, 0], origin: [180, 0, 0], limit: [-150, 150] } },
      { name: "Z 升降", parent: 2, joint: { type: "prismatic", axis: [0, -1, 0], origin: [150, 0, 0], limit: [0, 120] } },
      { name: "tip 末端", parent: 3, joint: { type: "fixed", origin: [0, -20, 0] }, endEffector: true },
    ],
  },

  list() {
    return [
      { id: "arm6", name: this.arm6.name },
      { id: "quad", name: this.quad.name },
      { id: "scara", name: this.scara.name },
    ];
  },
  get(id) { return JSON.parse(JSON.stringify(this[id] || this.arm6)); },
};
