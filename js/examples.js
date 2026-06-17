/* ============================================================
 * examples.js — 按机器人类型生成示例关键帧序列
 * 返回: [{ q:[每个节点的关节值(rad/mm)], grip }]
 * ============================================================ */

const Examples = {
  // 列出某机器人可用的示例
  listFor(model) {
    if (model.type === "legged") return [{ id: "walk", label: "🐾 行走步态" }, { id: "wave", label: "🙌 抬腿打招呼" }];
    if (model.type === "arm" || model.type === "urdf") return [{ id: "square", label: "⬜ 画方形" }, { id: "pick", label: "📦 抓取搬运" }];
    return [{ id: "sweep", label: "🔄 各关节摆动" }];
  },

  build(model, id) {
    if (model.type === "legged") return this._legged(model, id);
    if (model.type === "arm" || model.type === "urdf") {
      const ee = model.endEffectors()[0];
      if (ee != null) return this._armIK(model, id, ee);
    }
    return this._sweep(model);
  },

  /* —— 机械臂：用末端目标点求 IK，连续求解保证平滑 —— */
  _armIK(model, id, ee) {
    const fk = model.forward(model.home);
    const base = fk.jointPos[ee].length();
    const R = Math.max(180, base * 0.6);
    let targets;
    if (id === "pick") {
      const x = R, zo = R * 0.55;
      targets = [
        [x, R + 60, -zo, "open"], [x, 90, -zo, "open"], [x, 90, -zo, "close"],
        [x, R + 80, -zo, "close"], [x, R + 80, zo, "close"], [x, 90, zo, "close"],
        [x, 90, zo, "open"], [x, R + 60, zo, "open"],
      ];
    } else { // square
      const x = R * 0.8, s = R * 0.45, y = R * 0.55;
      targets = [[x, y, -s, "open"], [x, y, s, "open"], [x, y + 2 * s, s, "open"], [x, y + 2 * s, -s, "open"], [x, y, -s, "open"]];
    }
    const save = model.q.slice();
    const frames = [];
    model.q = model.home.slice();
    targets.forEach((t) => {
      const r = model.solveIK(ee, new Kin.V3(t[0], t[1], t[2]));
      model.q = r.q;
      frames.push({ q: r.q.slice(), grip: t[3] });
    });
    model.q = save;
    return frames;
  },

  /* —— 四足：按关节名设置髋/膝角度，构造步态关键帧 —— */
  _legged(model, id) {
    const set = (q, part, deg) => {
      model.nodes.forEach((n, i) => { if (n.name.includes(part)) q[i] = Kin.rad(deg); });
    };
    const setLeg = (q, leg, hip, knee) => {
      model.nodes.forEach((n, i) => {
        if (n.name.includes(leg) && n.name.includes("髋")) q[i] = Kin.rad(hip);
        if (n.name.includes(leg) && n.name.includes("膝")) q[i] = Kin.rad(knee);
      });
    };
    const stand = () => model.nodes.map((n) => (n.name.includes("髋") ? Kin.rad(15) : n.name.includes("膝") ? Kin.rad(-35) : 0));

    if (id === "wave") {
      const a = stand(), b = stand();
      setLeg(b, "RF", -55, -90); // 抬右前腿
      return [{ q: a, grip: "open" }, { q: b, grip: "open" }, { q: stand(), grip: "open" }, { q: b, grip: "open" }, { q: stand(), grip: "open" }];
    }
    // walk: 对角腿交替抬起前摆
    const frames = [];
    const swing = (legsUp, fwd) => {
      const q = stand();
      legsUp.forEach((leg) => setLeg(q, leg, fwd ? 40 : -10, -75));
      return { q, grip: "open" };
    };
    frames.push({ q: stand(), grip: "open" });
    frames.push(swing(["RF", "LH"], true));
    frames.push({ q: stand(), grip: "open" });
    frames.push(swing(["LF", "RH"], true));
    frames.push({ q: stand(), grip: "open" });
    return frames;
  },

  /* —— 通用：依次摆动每个可动关节 —— */
  _sweep(model) {
    const mi = model.movableIndices();
    const frames = [{ q: model.home.slice(), grip: "open" }];
    mi.forEach((i) => {
      const q = model.home.slice();
      const lim = model.nodes[i].joint.limit;
      q[i] = (lim[0] + lim[1]) / 2 + (lim[1] - lim[0]) * 0.3;
      frames.push({ q, grip: "open" });
    });
    frames.push({ q: model.home.slice(), grip: "open" });
    return frames;
  },
};
