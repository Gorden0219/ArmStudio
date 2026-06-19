/* ============================================================
 * app.js — 主控制器（v2：多机型 / 关键帧 / 导入导出 / 设计器）
 * ============================================================ */

(function () {
  const $ = (s) => document.querySelector(s);
  const status = (m) => ($("#status").textContent = m);

  const robot = new Robot3D($("#view3d"));
  const view2d = new View2D($("#canvas2d"), $("#height-slider"), $("#height-val"));
  const kf = new Keyframes();

  let model = null;
  let gripperOpen = true;
  let currentLang = "arduino";
  let designMode = false;
  let selNode = -1;
  let selFrame = -1;
  let selJoint = -1;
  let importedDef = null;
  const sliderInputs = {};

  /* ---------- 统一刷新 ---------- */
  let tcpViz = { pts: [], vmax: 1 };
  // 轻量刷新：姿态变化时调用（不重算 TCP 规划）
  function refreshAll() {
    robot.rebuild();
    const path = kf.eePath(model, robot.activeEE);
    robot.setKfHandles(path, selFrame);     // 可拖动的关键帧路点句柄
    view2d.model = model;
    view2d.activeEE = robot.activeEE;
    view2d.framesPath = path;
    view2d.selFrame = selFrame;
    view2d.tcpViz = tcpViz;
    view2d.draw();
    syncSliders();
    updateTargetFields();
    updateWpPanel();
  }
  // 重算 TCP 轨迹规划（关键帧/速度/末端变化时）
  function refreshTcp() {
    const ee = robot.activeEE;
    tcpViz = kf.tcpViz(model, ee, 16);
    robot.updateTcp(tcpViz);
    view2d.tcpViz = tcpViz;
    updateCycle();
    refreshAll();
  }
  // 把当前位姿写回选中的关键帧
  function writeBackSel() {
    if (selFrame >= 0 && kf.frames[selFrame]) kf.frames[selFrame].q = model.q.slice();
  }
  function updateCycle() {
    const t = kf.cycleTime(model, robot.activeEE);
    $("#cycle-time").textContent = t > 0 ? `节拍：${t.toFixed(2)} s（${kf.frames.length} 帧）` : "节拍：—";
  }
  function setQ(q) { model.q = q.slice(); refreshAll(); }

  /* ---------- 关节滑块 ---------- */
  function buildSliders() {
    const box = $("#joint-sliders"); box.innerHTML = "";
    for (const k in sliderInputs) delete sliderInputs[k];
    model.movableIndices().forEach((i) => {
      const n = model.nodes[i], prism = n.joint.type === "prismatic";
      const lim = n.joint.limit;
      const min = prism ? lim[0] : Math.round(Kin.deg(lim[0]));
      const max = prism ? lim[1] : Math.round(Kin.deg(lim[1]));
      const val = prism ? model.q[i] : Math.round(Kin.deg(model.q[i]));
      const unit = prism ? "mm" : "°";
      const w = document.createElement("div");
      w.className = "jslider" + (i === selJoint ? " sel" : "");
      w.id = "jslider-" + i;
      w.innerHTML = `<div class="lab"><span>${n.name}</span><b id="jv${i}">${val}${unit}</b></div>
        <input type="range" id="js${i}" min="${min}" max="${max}" step="${prism ? 1 : 1}" value="${val}">`;
      box.appendChild(w);
      const input = w.querySelector("input");
      input.oninput = () => {
        $("#jv" + i).textContent = input.value + unit;
        model.q[i] = prism ? +input.value : Kin.rad(+input.value);
        robot.rebuild();
        view2d.activeEE = robot.activeEE; view2d.draw();
      };
      sliderInputs[i] = { input, prism, unit };
    });
    // 自动滚动到选中的关节滑块
    if (selJoint >= 0) {
      const el = document.getElementById("jslider-" + selJoint);
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
  function syncSliders() {
    model.movableIndices().forEach((i) => {
      const s = sliderInputs[i]; if (!s) return;
      const v = s.prism ? Math.round(model.q[i]) : Math.round(Kin.deg(model.q[i]));
      s.input.value = v; $("#jv" + i).textContent = v + s.unit;
    });
  }

  /* ---------- 末端执行器列表 ---------- */
  function buildEEList() {
    const box = $("#ee-list"); box.innerHTML = "";
    const ees = model.endEffectors();
    if (robot.activeEE == null || !ees.includes(robot.activeEE)) robot.activeEE = ees[0] ?? null;
    ees.forEach((i) => {
      const b = document.createElement("button");
      b.className = "ee-btn" + (i === robot.activeEE ? " active" : "");
      b.textContent = model.nodes[i].name;
      b.onclick = () => { robot.setActiveEE(i); buildEEList(); refreshTcp(); };
      box.appendChild(b);
    });
    if (!ees.length) box.innerHTML = '<span class="muted">该机型无末端执行器，可在设计模式中标记</span>';
    $("#gripper-row").style.display = model.hasGripper ? "" : "none";
  }

  /* ---------- 加载模型 ---------- */
  function loadModel(def, selectValue) {
    model = new Kin.RobotModel(def);
    robot.setModel(model);
    gripperOpen = true; $("#gripper-state").textContent = "张开"; robot.setGripper(true);
    selFrame = -1; $("#seg-editor").style.display = "none";
    kf.clear();
    buildSliders();
    buildEEList();
    populateExamples();
    refreshTcp();
    if (selectValue) $("#robot-select").value = selectValue;
    status(`已加载：${model.name}（${model.movableIndices().length} 个关节，${model.endEffectors().length} 个末端）`);
  }

  /* ---------- 机器人下拉 ---------- */
  function buildRobotSelect() {
    const sel = $("#robot-select"); sel.innerHTML = "";
    Presets.list().forEach((r) => { const o = document.createElement("option"); o.value = r.id; o.textContent = r.name; sel.appendChild(o); });
    sel.onchange = () => {
      if (sel.value === "imported" && importedDef) loadModel(importedDef, "imported");
      else loadModel(Presets.get(sel.value), sel.value);
      if (designMode) toggleDesign(false);
    };
  }

  /* ---------- 3D 交互回调 ---------- */
  function curEE() { return robot.activeEE == null ? new THREE.Vector3() : model.eePosition(robot.activeEE, model.q); }
  function lockTarget(t) {
    const c = curEE();
    if ($("#lockx").checked) t.x = c.x;
    if ($("#locky").checked) t.y = c.y;
    if ($("#lockz").checked) t.z = c.z;
    return t;
  }
  function updateTargetFields() {
    if (designMode || robot.activeEE == null) return;
    const c = curEE(), ae = document.activeElement;
    if (ae !== $("#tx")) $("#tx").value = c.x.toFixed(0);
    if (ae !== $("#ty")) $("#ty").value = c.y.toFixed(0);
    if (ae !== $("#tz")) $("#tz").value = c.z.toFixed(0);
  }

  /* ---------- 选定路点坐标编辑 ---------- */
  function updateWpPanel() {
    const panel = $("#wp-panel");
    if (selFrame >= 0 && kf.frames[selFrame] && robot.activeEE != null) {
      panel.style.display = "";
      const ee = robot.activeEE;
      const p = model.eePosition(ee, kf.frames[selFrame].q);
      $("#wp-index").textContent = `#${selFrame + 1}`;
      $("#wp-ee-name").textContent = model.nodes[ee].name;
      const ae = document.activeElement;
      if (ae !== $("#wpx")) $("#wpx").value = p.x.toFixed(0);
      if (ae !== $("#wpy")) $("#wpy").value = p.y.toFixed(0);
      if (ae !== $("#wpz")) $("#wpz").value = p.z.toFixed(0);
      // 同步更新目标面板的标题提示
      $("#target-panel h3 small").textContent = `路点 ${selFrame + 1} (mm)`;
    } else {
      panel.style.display = "none";
      $("#target-panel h3 small").textContent = `当前末端 (mm)`;
    }
  }
  // 路点坐标修改 → 解 IK 并更新该路点
  function onWpCoordChange() {
    if (selFrame < 0 || robot.activeEE == null) return;
    const t = new THREE.Vector3(+$("#wpx").value, +$("#wpy").value, +$("#wpz").value);
    lockTarget(t);
    const r = model.solveIK(robot.activeEE, t);
    model.q = r.q.slice();
    kf.frames[selFrame].q = model.q.slice();
    refreshAll(); renderKfList();
    status(`路点 ${selFrame + 1} → (${t.x.toFixed(0)},${t.y.toFixed(0)},${t.z.toFixed(0)}) 误差 ${r.error.toFixed(1)}mm`);
  }
  $("#wpx").oninput = onWpCoordChange;
  $("#wpy").oninput = onWpCoordChange;
  $("#wpz").oninput = onWpCoordChange;
  function moveTo(t) {
    if (robot.activeEE == null) { status("当前机型无末端执行器"); return; }
    lockTarget(t);
    const r = model.solveIK(robot.activeEE, t);
    model.q = r.q.slice();
    writeBackSel();
    if (selFrame >= 0) { renderKfList(); refreshTcp(); } else refreshAll();
    status(`${selFrame >= 0 ? `路点 ${selFrame + 1}` : "末端"}→(${t.x.toFixed(0)},${t.y.toFixed(0)},${t.z.toFixed(0)}) 误差 ${r.error.toFixed(1)}mm`);
  }
  $("#btn-moveto").onclick = () => moveTo(new THREE.Vector3(+$("#tx").value, +$("#ty").value, +$("#tz").value));
  $("#tx").oninput = $("#ty").oninput = $("#tz").oninput = () =>
    moveTo(new THREE.Vector3(+$("#tx").value, +$("#ty").value, +$("#tz").value));

  // 点击取点模式
  function setClickMode(on) {
    robot.clickMode = on;
    robot.clickPlaneY = +$("#height-slider").value;
    $("#btn-clickmode").classList.toggle("active", on);
    $("#btn-clickmode").textContent = on ? "🖱 点击取点模式：开" : "🖱 点击取点模式：关";
    robot.renderer.domElement.style.cursor = on ? "crosshair" : "";
    if (on) status("点击取点已开启：在 3D 地面点击落下运动点");
  }
  $("#btn-clickmode").onclick = () => setClickMode(!robot.clickMode);
  $("#height-slider").addEventListener("input", () => { robot.clickPlaneY = +$("#height-slider").value; });
  robot.onClickPoint = (p) => {
    // 点击取点：落新点（不编辑已选点）
    selFrame = -1; $("#seg-editor").style.display = "none";
    lockTarget(p);
    const r = model.solveIK(robot.activeEE, p);
    model.q = r.q.slice();
    const n = kf.capture(model, gripperOpen ? "open" : "close");
    kf.setSeg(n - 1, "speed", Math.max(1, +$("#move-speed").value || 150)); // 触发刷新
    status(`已落运动点 #${kf.frames.length}（${p.x.toFixed(0)}, ${robot.clickPlaneY}, ${p.z.toFixed(0)}）`);
  };

  // 拖动末端球：选中了路点则编辑该路点，否则只是摆当前位姿
  robot.onIK = (ee, p) => {
    lockTarget(p);
    const r = model.solveIK(ee, p);
    model.q = r.q.slice();
    writeBackSel();
    refreshAll();
    status(`末端→(${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}) 误差${r.error.toFixed(1)}mm`);
  };
  robot.onIKDrop = () => { if (selFrame >= 0) refreshTcp(); };

  // 选中 / 拖动关键帧路点（3D 与 2D 复用）
  function dragKf(i, p) {
    selFrame = i;
    lockTarget(p);
    const r = model.solveIK(robot.activeEE, p);
    model.q = r.q.slice();
    kf.frames[i].q = model.q.slice();
    refreshAll(); renderKfList(); updateWpPanel();
    status(`路点 ${i + 1} → (${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}) 误差 ${r.error.toFixed(1)}mm`);
  }
  robot.onPickKf = (i) => loadFrame(i);
  robot.onKfDrag = dragKf;
  robot.onKfDragEnd = () => refreshTcp();
  view2d.onPickKf2D = (i) => loadFrame(i);
  view2d.onKfDrag2D = dragKf;
  view2d.onKfDragEnd2D = () => refreshTcp();

  robot.onPickEE = (i) => { buildEEList(); refreshTcp(); };
  robot.onPickNode = (i) => selectNode(i);
  robot.onPickJoint = (i) => {
    selJoint = i;
    robot.setSelectedJoint(i);
    buildSliders();
    if (i >= 0) status(`已选中关节「${model.nodes[i].name}」— 拖拽改变角度`);
    else status(`已取消关节选中`);
  };
  // 关节拖拽：水平拖动→旋转角，垂直拖动→伸缩
  robot.onJointDrag = (i, dx, dy) => {
    const n = model.nodes[i];
    if (!n || !sliderInputs[i]) return;
    const prism = n.joint.type === "prismatic";
    const lim = n.joint.limit;
    let delta, min, max;
    if (prism) {
      delta = -dy * 0.5;           // 垂直拖→伸缩 (mm/px)
      min = lim[0]; max = lim[1];
      let val = model.q[i] + delta;
      val = Math.max(min, Math.min(max, val));
      model.q[i] = val;
    } else {
      delta = dx * 0.3;            // 水平拖→旋转 (°/px)
      min = Kin.deg(lim[0]); max = Kin.deg(lim[1]);
      let val = Kin.deg(model.q[i]) + delta;
      val = Math.max(min, Math.min(max, val));
      model.q[i] = Kin.rad(val);
    }
    robot.rebuild();
    view2d.draw();
    // 更新滑块显示
    const s = sliderInputs[i];
    if (s) {
      const v = prism ? Math.round(model.q[i]) : Math.round(Kin.deg(model.q[i]));
      s.input.value = v;
      $("#jv" + i).textContent = v + s.unit;
    }
  };
  robot.onJointDragEnd = (i) => {
    status(`关节「${model.nodes[i].name}」= ${model.nodes[i].joint.type === "prismatic" ? Math.round(model.q[i]) + "mm" : Math.round(Kin.deg(model.q[i])) + "°"}`);
  };
  robot.onNodeDrag = (i, p) => { Designer.setOriginFromWorld(model, i, p); robot.rebuild(); };
  robot.onNodeDrop = () => { refreshAll(); };

  /* ---------- 2D 交互 ---------- */
  view2d.onMoveEE = (p) => {
    if (robot.activeEE == null) return;
    lockTarget(p);
    const r = model.solveIK(robot.activeEE, p);
    setQ(r.q);
  };

  /* ---------- 关键帧 ---------- */
  kf.onChange = () => {
    renderKfList();
    $("#kf-count").textContent = kf.frames.length + " 个";
    if (selFrame >= kf.frames.length) { selFrame = -1; $("#seg-editor").style.display = "none"; }
    refreshTcp();
  };
  kf.onFrame = (q, gOpen) => { robot.setGripper(gOpen); setQ(q); };
  kf.onPlayEnd = () => { $("#btn-play").textContent = "▶ 播放"; status("播放完成"); $("#play-progress").textContent = ""; };
  kf.onTime = (t, T) => { $("#play-progress").textContent = `▶ ${t.toFixed(2)} / ${T.toFixed(2)} s`; };

  const MSHORT = { PTP: "J", LIN: "L", CIRC: "C" };
  function renderKfList() {
    const ol = $("#kf-list"); ol.innerHTML = "";
    kf.frames.forEach((f, i) => {
      const ee = robot.activeEE;
      let coord = "";
      if (ee != null) { const p = model.eePosition(ee, f.q); coord = `${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}`; }
      const tag = i === 0 ? `<span class="mtag PTP">起</span>` : `<span class="mtag ${f.motion || "PTP"}">${MSHORT[f.motion || "PTP"]}</span>`;
      const li = document.createElement("li");
      if (i === selFrame) li.className = "sel";
      li.innerHTML = `<span class="idx">${i + 1}</span>${tag}
        <span class="coord kf-thumb">${coord}</span>
        ${model.hasGripper ? `<span class="grip">${f.grip === "open" ? "✋" : "✊"}</span>` : ""}
        <span class="del" data-del="${i}">✕</span>`;
      li.onclick = (e) => { if (e.target.dataset.del !== undefined) return; loadFrame(i); };
      li.querySelector(".del").onclick = (e) => { e.stopPropagation(); selFrame = -1; $("#seg-editor").style.display = "none"; kf.remove(i); };
      ol.appendChild(li);
    });
  }
  function loadFrame(i) {
    const f = kf.frames[i];
    selFrame = i;
    // 加载关键帧时取消关节选中
    if (selJoint >= 0) { selJoint = -1; robot.setSelectedJoint(-1); buildSliders(); }
    if (model.hasGripper) { gripperOpen = f.grip === "open"; $("#gripper-state").textContent = gripperOpen ? "张开" : "闭合"; robot.setGripper(gripperOpen); }
    setQ(f.q);
    openSegEditor(i);
    renderKfList();
    status(`已载入关键帧 ${i + 1}`);
  }
  function openSegEditor(i) {
    if (i <= 0) { $("#seg-editor").style.display = "none"; return; }
    const f = kf.frames[i];
    $("#seg-editor").style.display = "";
    $("#seg-idx").textContent = i + 1;
    $("#seg-motion").value = f.motion || "PTP";
    $("#seg-speed").value = f.speed || 150;
    $("#seg-acc").value = f.acc || 600;
    $("#seg-bulge").value = f.bulge || 60;
    $("#seg-bulge-row").style.display = (f.motion === "CIRC") ? "" : "none";
  }
  $("#seg-motion").onchange = () => {
    if (selFrame <= 0) return;
    kf.setSeg(selFrame, "motion", $("#seg-motion").value);
    $("#seg-bulge-row").style.display = ($("#seg-motion").value === "CIRC") ? "" : "none";
  };
  $("#seg-speed").oninput = () => { if (selFrame > 0) kf.setSeg(selFrame, "speed", Math.max(1, +$("#seg-speed").value)); };
  $("#seg-acc").oninput = () => { if (selFrame > 0) kf.setSeg(selFrame, "acc", Math.max(1, +$("#seg-acc").value)); };
  $("#seg-bulge").oninput = () => { if (selFrame > 0) kf.setSeg(selFrame, "bulge", +$("#seg-bulge").value); };

  $("#btn-capture").onclick = () => {
    const n = kf.capture(model, gripperOpen ? "open" : "close");
    const sp = Math.max(1, +$("#move-speed").value || 150);
    kf.setSeg(n - 1, "speed", sp);   // 到点速度写入该段并刷新
    status(`已捕获关键帧 ${kf.frames.length}（到点速度 ${sp} mm/s）`);
  };
  $("#btn-clear").onclick = () => { kf.clear(); status("已清空关键帧"); };
  $("#btn-play").onclick = () => {
    if (kf.playing) { kf.stop(); $("#btn-play").textContent = "▶ 播放"; status("已暂停"); return; }
    if (kf.frames.length < 2) { status("至少需要 2 个关键帧"); return; }
    kf.play(model, robot.activeEE);
    $("#btn-play").textContent = "⏸ 暂停"; status("播放中…（按梯形速度曲线）");
  };
  $("#btn-stop").onclick = () => { kf.stop(); $("#btn-play").textContent = "▶ 播放"; status("已停止"); $("#play-progress").textContent = ""; };
  $("#speed-slider").oninput = () => {
    kf.speedScale = (+$("#speed-slider").value) / 5;
    $("#speed-mult").textContent = kf.speedScale.toFixed(1) + "×";
    refreshTcp();
  };

  $("#btn-gripper").onclick = () => {
    gripperOpen = !gripperOpen; robot.setGripper(gripperOpen);
    $("#gripper-state").textContent = gripperOpen ? "张开" : "闭合";
  };
  $("#btn-home").onclick = () => { gripperOpen = true; $("#gripper-state").textContent = "张开"; robot.setGripper(true); selFrame = -1; $("#seg-editor").style.display = "none"; setQ(model.home); status("已回到初始姿态（取消选中路点）"); };

  /* ---------- 视图切换 ---------- */
  document.querySelectorAll(".vtab").forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll(".vtab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".view-pane").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      const v = tab.dataset.view; $("#view" + v).classList.add("active");
      if (v === "3d") robot._resize(); else { view2d.resize(); view2d.draw(); }
    };
  });

  /* ---------- 代码弹窗 ---------- */
  function refreshCode() { $("#code-output").querySelector("code").textContent = CodeGen.generate(currentLang, model, kf.frames); }
  $("#btn-code").onclick = () => { if (!kf.frames.length) status("请先捕获至少一个关键帧"); refreshCode(); $("#code-modal").classList.add("show"); };
  document.querySelectorAll(".ctab").forEach((t) => {
    t.onclick = () => { document.querySelectorAll(".ctab").forEach((x) => x.classList.remove("active")); t.classList.add("active"); currentLang = t.dataset.lang; refreshCode(); };
  });
  $("#btn-copy").onclick = async () => {
    try { await navigator.clipboard.writeText($("#code-output").textContent); $("#copy-tip").textContent = "已复制 ✓"; }
    catch { $("#copy-tip").textContent = "请手动选择复制"; }
    setTimeout(() => ($("#copy-tip").textContent = ""), 2000);
  };
  $("#btn-download").onclick = () => downloadText($("#code-output").textContent, "trajectory." + CodeGen.ext[currentLang]);

  /* ---------- 导入 / 导出 ---------- */
  $("#btn-import").onclick = () => $("#file-input").click();
  $("#file-input").onchange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        let def;
        if (/\.(urdf|xml)$/i.test(file.name)) def = URDF.parse(reader.result);
        else {
          const obj = JSON.parse(reader.result);
          if (!(obj.links || obj.nodes)) throw new Error("不是机器人定义文件（缺少 links）");
          def = obj;
        }
        importedDef = def;
        const sel = $("#robot-select");
        if (!sel.querySelector('option[value="imported"]')) {
          const o = document.createElement("option"); o.value = "imported"; sel.appendChild(o);
        }
        sel.querySelector('option[value="imported"]').textContent = "📂 " + (def.name || "导入机型");
        loadModel(def, "imported");
      } catch (err) { status("导入失败：" + err.message); alert("导入失败：" + err.message); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };
  $("#btn-export").onclick = () => downloadText(JSON.stringify(model.toJSON(), null, 2), (model.name || "robot") + ".json");

  function downloadText(text, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = name; a.click(); URL.revokeObjectURL(a.href);
  }

  /* ---------- CAD 设计模式 ---------- */
  function snapStep() { return $("#snap-on").checked ? Math.max(0, +$("#snap-step").value) : 0; }

  function toggleDesign(on) {
    designMode = on;
    if (on) { selJoint = -1; robot.setSelectedJoint(-1); }
    robot.setMode(on ? "design" : "pose");
    $("#mode-cad").classList.toggle("active", on);
    $("#mode-action").classList.toggle("active", !on);
    $("#design-panel").style.display = on ? "" : "none";
    ["#ee-panel", "#target-panel", "#joint-panel", "#kf-panel"].forEach((s) => ($(s).style.display = on ? "none" : ""));
    $("#view-hint").textContent = on
      ? "选中连杆后用箭头/圆环手柄精确调整；结构树可切换选中"
      : "拖动场景旋转，拖动橙色末端球体设计姿态";
    if (on) {
      setClickMode(false);
      if (fpActive) setFP(false);
      renderTree();
      robot.setGizmoMode($("#giz-rot").classList.contains("active") ? "rotate" : "translate");
    } else {
      // 退出 CAD：关闭自由放置、草图
      if (fpActive) setFP(false);
      if (sketch.active) exitSketch();
      // 把结构变化同步进动作模式（关节滑块/末端列表/TCP）
      selNode = -1; $("#node-editor").style.display = "none";
      buildSliders(); buildEEList(); refreshTcp();
    }
    refreshAll();
  }
  $("#mode-cad").onclick = () => { if (!designMode) toggleDesign(true); };
  $("#mode-action").onclick = () => { if (designMode) toggleDesign(false); };

  // 结构树
  function renderTree() {
    const ul = $("#struct-tree"); ul.innerHTML = "";
    model.nodes.forEach((n, i) => {
      const depth = nodeDepth(i);
      const li = document.createElement("li");
      if (i === selNode) li.className = "sel";
      li.style.paddingLeft = 6 + depth * 12 + "px";
      li.innerHTML = `${n.name}<span class="jt">${n.joint.type}</span>${n.endEffector ? '<span class="ee">●末端</span>' : ""}`;
      li.onclick = () => selectNode(i);
      ul.appendChild(li);
    });
  }
  function nodeDepth(i) { let d = 0, p = model.nodes[i].parent; while (p >= 0) { d++; p = model.nodes[p].parent; } return d; }

  function selectNode(i) {
    selNode = i; robot.setSelectedNode(i);
    const n = model.nodes[i];
    $("#node-editor").style.display = "";
    $("#nd-name").value = n.name;
    $("#nd-type").value = n.joint.type;
    const ax = n.joint.axis;
    $("#nd-axis").value = Math.abs(ax.x) > 0.5 ? "X" : Math.abs(ax.y) > 0.5 ? "Y" : "Z";
    fillOrigin(n);
    const prism = n.joint.type === "prismatic";
    $("#nd-lo").value = prism ? n.joint.limit[0] : Math.round(Kin.deg(n.joint.limit[0]));
    $("#nd-hi").value = prism ? n.joint.limit[1] : Math.round(Kin.deg(n.joint.limit[1]));
    const ls = n.linkShape || { type: "cylinder", radius: 9 };
    $("#nd-shape").value = ls.type;
    $("#nd-radius").value = ls.radius || 9;
    $("#nd-w").value = ls.w || 16; $("#nd-d").value = ls.d || 16;
    $("#shape-cyl").style.display = ls.type === "cylinder" ? "" : "none";
    $("#shape-box").style.display = ls.type === "box" ? "" : "none";
    // 色彩与材质
    const col = n.color || "#6b7b8c";
    $("#nd-color").value = col;
    $("#nd-material").value = n.materialType || "standard";
    const op = n.opacity != null ? Math.round(n.opacity * 100) : 100;
    $("#nd-opacity").value = op;
    $("#nd-opacity-val").textContent = op + "%";
    // 调色板高亮
    document.querySelectorAll(".palette .chip").forEach((ch) => ch.classList.toggle("active", ch.dataset.c === col));
    // 增强外形编辑器
    const hasGeom = !!(n.geometry && n.geometry.shape);
    $("#nd-geom-enable").checked = hasGeom;
    $("#geom-editor").style.display = hasGeom ? "" : "none";
    $("#geom-label").textContent = hasGeom ? Shapes.shapeLabel(n.geometry.shape) : "关闭";
    if (hasGeom) {
      const sh = n.geometry.shape;
      const type = sh.type || "box";
      const p = sh.params || {};
      $("#nd-geom-type").value = type;
      showGeomParams(type);
      // fill each type's fields
      fillGeomBox(p);
      fillGeomCyl(p);
      fillGeomSph(p);
      fillGeomCone(p);
      fillGeomTorus(p);
      fillGeomPyramid(p);
      fillGeomWedge(p);
      fillGeomPipe(p);
      fillGeomGear(p);
      fillGeomExtrude(sh, p);
      renderCutoutList(sh.cutouts || []);
      // 草图变换控件：选中拉伸体时显示
      const showSketchEdit = type === "extrude" && sh.profile && sh.profile !== "circle";
      $("#sketch-edit-controls").style.display = showSketchEdit ? "" : "none";
    } else {
      renderCutoutList([]);
      $("#sketch-edit-controls").style.display = "none";
    }
    renderTree();
    // 刷新尺寸标注（如果开启）
    if (robot.showDimensions) robot.updateDimensions(i);
  }
  function showGeomParams(type) {
    // 隐藏所有，只显示对应的
    document.querySelectorAll(".geom-params").forEach((el) => (el.style.display = el.dataset.for === type ? "" : "none"));
    document.querySelectorAll(".gext-profile").forEach((el) => (el.style.display = "none"));
    if (type === "extrude") {
      const prof = $("#nd-gext-profile").value || "rect";
      document.querySelectorAll(`.gext-profile[data-profile="${prof}"]`).forEach((el) => (el.style.display = ""));
    }
  }
  function fillGeomBox(p) { $("#nd-gbox-w").value = p.width || 40; $("#nd-gbox-d").value = p.depth || 40; $("#nd-gbox-h").value = p.height || 30; }
  function fillGeomCyl(p) { $("#nd-gcyl-r").value = p.radius || 20; $("#nd-gcyl-h").value = p.height || 40; }
  function fillGeomSph(p) { $("#nd-gsph-r").value = p.radius || 25; }
  function fillGeomCone(p) { $("#nd-gcone-r").value = p.radius || 20; $("#nd-gcone-h").value = p.height || 40; }
  function fillGeomTorus(p) { $("#nd-gtor-r").value = p.radius || 30; $("#nd-gtor-t").value = p.tube || 10; }
  function fillGeomPyramid(p) { $("#nd-gpyr-w").value = p.width || 40; $("#nd-gpyr-h").value = p.height || 30; }
  function fillGeomWedge(p) { $("#nd-gwd-w").value = p.width || 40; $("#nd-gwd-d").value = p.depth || 40; $("#nd-gwd-h").value = p.height || 30; }
  function fillGeomPipe(p) { $("#nd-gpip-r").value = p.radius || 30; $("#nd-gpip-ir").value = p.innerRadius || 15; $("#nd-gpip-h").value = p.height || 30; }
  function fillGeomGear(p) { $("#nd-ggear-r").value = p.radius || 30; $("#nd-ggear-t").value = p.teeth || 12; $("#nd-ggear-h").value = p.height || 20; }
  function fillGeomExtrude(sh, p) {
    const prof = sh.profile || "rect";
    $("#nd-gext-profile").value = prof;
    $("#nd-gext-depth").value = sh.depth || 30;
    // only toggle profile visibility if we're in extrude mode
    if ($("#nd-geom-type").value === "extrude") {
      document.querySelectorAll(".gext-profile").forEach((el) => (el.style.display = el.dataset.profile === prof ? "" : "none"));
    }
    switch (prof) {
      case "rect": $("#nd-gext-rw").value = p.width || 40; $("#nd-gext-rh").value = p.height || 30; break;
      case "circle": $("#nd-gext-cr").value = p.radius || 20; break;
      case "triangle": $("#nd-gext-ts").value = p.side || 40; break;
      case "polygon": {
        const verts = p.vertices || [];
        $("#gext-poly-count").textContent = verts.length + " 个";
        break;
      }
    }
  }

  /* ---- 读取外形编辑器状态 → 写入 node.geometry.shape ---- */
  function readNodeShape() {
    if (selNode < 0) return null;
    const type = $("#nd-geom-type").value;
    const shape = { type, params: {} };
    switch (type) {
      case "box":
        shape.params = { width: +$("#nd-gbox-w").value || 40, depth: +$("#nd-gbox-d").value || 40, height: +$("#nd-gbox-h").value || 30 };
        break;
      case "cylinder":
        shape.params = { radius: +$("#nd-gcyl-r").value || 20, height: +$("#nd-gcyl-h").value || 40 };
        break;
      case "sphere":
        shape.params = { radius: +$("#nd-gsph-r").value || 25 };
        break;
      case "cone":
        shape.params = { radius: +$("#nd-gcone-r").value || 20, height: +$("#nd-gcone-h").value || 40 };
        break;
      case "torus":
        shape.params = { radius: +$("#nd-gtor-r").value || 30, tube: +$("#nd-gtor-t").value || 10 };
        break;
      case "pyramid":
        shape.params = { width: +$("#nd-gpyr-w").value || 40, height: +$("#nd-gpyr-h").value || 30 };
        break;
      case "wedge":
        shape.params = { width: +$("#nd-gwd-w").value || 40, depth: +$("#nd-gwd-d").value || 40, height: +$("#nd-gwd-h").value || 30 };
        break;
      case "pipe":
        shape.params = { radius: +$("#nd-gpip-r").value || 30, innerRadius: +$("#nd-gpip-ir").value || 15, height: +$("#nd-gpip-h").value || 30 };
        break;
      case "gear":
        shape.params = { radius: +$("#nd-ggear-r").value || 30, teeth: +$("#nd-ggear-t").value || 12, toothDepth: 6 };
        shape.height = +$("#nd-ggear-h").value || 20;
        break;
      case "extrude": {
        const profile = $("#nd-gext-profile").value;
        shape.profile = profile;
        shape.depth = +$("#nd-gext-depth").value || 30;
        switch (profile) {
          case "rect": shape.params = { width: +$("#nd-gext-rw").value || 40, height: +$("#nd-gext-rh").value || 30 }; break;
          case "circle": shape.params = { radius: +$("#nd-gext-cr").value || 20 }; break;
          case "triangle": shape.params = { side: +$("#nd-gext-ts").value || 40 }; break;
          case "polygon": {
            const n = model.nodes[selNode];
            const existing = n.geometry && n.geometry.shape;
            shape.params = { vertices: (existing && existing.params && existing.params.vertices) || [] };
            break;
          }
        }
        // read cutouts from stored data
        const cn = model.nodes[selNode];
        const curCutouts = (cn.geometry && cn.geometry.shape && cn.geometry.shape.cutouts) || [];
        shape.cutouts = curCutouts;
        break;
      }
    }
    return shape;
  }
  function applyNodeGeom() {
    if (selNode < 0) return;
    const enabled = $("#nd-geom-enable").checked;
    if (!enabled) {
      Designer.setGeometry(model, selNode, null);
      $("#geom-editor").style.display = "none";
      $("#geom-label").textContent = "关闭";
    } else {
      const shape = readNodeShape();
      Designer.setGeometry(model, selNode, { shape });
      $("#geom-editor").style.display = "";
      $("#geom-label").textContent = Shapes.shapeLabel(shape);
    }
    refreshAll();
  }

  // 切换外形启用
  $("#nd-geom-enable").onchange = applyNodeGeom;
  // 切换类型 → 显示对应参数
  $("#nd-geom-type").onchange = () => {
    if (selNode < 0) return;
    const type = $("#nd-geom-type").value;
    showGeomParams(type);
    // fill defaults for the new type
    const n = model.nodes[selNode];
    const existing = n.geometry && n.geometry.shape;
    const p = (existing && existing.type === type) ? existing.params : {};
    switch (type) {
      case "box": fillGeomBox(p); break;
      case "cylinder": fillGeomCyl(p); break;
      case "sphere": fillGeomSph(p); break;
      case "cone": fillGeomCone(p); break;
      case "torus": fillGeomTorus(p); break;
      case "pyramid": fillGeomPyramid(p); break;
      case "wedge": fillGeomWedge(p); break;
      case "pipe": fillGeomPipe(p); break;
      case "gear": fillGeomGear(p); break;
      case "extrude": fillGeomExtrude((existing && existing.type === "extrude") ? existing : { profile: "rect", depth: 30 }, p); break;
    }
    applyNodeGeom();
  };
  // 外形参数变化
  function onGeomParamChange() { if (selNode >= 0) applyNodeGeom(); }
  document.querySelectorAll("#nd-gbox-w,#nd-gbox-d,#nd-gbox-h,#nd-gcyl-r,#nd-gcyl-h,#nd-gsph-r,#nd-gext-depth,#nd-gcone-r,#nd-gcone-h,#nd-gtor-r,#nd-gtor-t,#nd-gpyr-w,#nd-gpyr-h,#nd-gwd-w,#nd-gwd-d,#nd-gwd-h,#nd-gpip-r,#nd-gpip-ir,#nd-gpip-h,#nd-ggear-r,#nd-ggear-t,#nd-ggear-h").forEach((el) => {
    el.oninput = onGeomParamChange;
  });
  // Extrude profile 切换
  $("#nd-gext-profile").onchange = () => {
    if (selNode < 0) return;
    const prof = $("#nd-gext-profile").value;
    document.querySelectorAll(".gext-profile").forEach((el) => (el.style.display = el.dataset.profile === prof ? "" : "none"));
    // potentially load polygon vertex count
    if (prof === "polygon") {
      const n = model.nodes[selNode];
      const existing = n.geometry && n.geometry.shape;
      const verts = (existing && existing.params && existing.params.vertices) || [];
      $("#gext-poly-count").textContent = verts.length + " 个";
    }
    // Restore defaults for the new profile
    const n = model.nodes[selNode];
    const existing = n.geometry && n.geometry.shape;
    const p = (existing && existing.profile === prof) ? existing.params : {};
    switch (prof) {
      case "rect": $("#nd-gext-rw").value = p.width || 40; $("#nd-gext-rh").value = p.height || 30; break;
      case "circle": $("#nd-gext-cr").value = p.radius || 20; break;
      case "triangle": $("#nd-gext-ts").value = p.side || 40; break;
    }
    applyNodeGeom();
  };
  // Extrude profile params
  document.querySelectorAll("#nd-gext-rw,#nd-gext-rh,#nd-gext-cr,#nd-gext-ts").forEach((el) => {
    el.oninput = onGeomParamChange;
  });

  /* ---- 孔洞 (Cutout) 管理 ---- */
  function renderCutoutList(cutouts) {
    const list = $("#cutout-list");
    const count = $("#cutout-count");
    count.textContent = (cutouts.length || 0) + " 个";
    list.innerHTML = "";
    (cutouts || []).forEach((c, i) => {
      const div = document.createElement("div");
      div.className = "cutout-item";
      let label = "";
      const cp = c.params || {};
      switch (c.profile) {
        case "circle": label = `● 圆孔 r=${cp.radius} @(${c.x||0},${c.y||0})`; break;
        case "rect": label = `▬ 方孔 ${cp.width}×${cp.height} @(${c.x||0},${c.y||0})`; break;
        case "triangle": label = `△ 三角 a=${cp.side} @(${c.x||0},${c.y||0})`; break;
      }
      div.innerHTML = `<span class="ct-label">${label}</span>
        <a href="#" class="del" data-ci="${i}">✕</a>`;
      div.querySelector(".del").onclick = (e) => {
        e.preventDefault();
        removeCutout(i);
      };
      list.appendChild(div);
    });
  }
  function removeCutout(idx) {
    if (selNode < 0) return;
    const n = model.nodes[selNode];
    const sh = n.geometry && n.geometry.shape;
    if (!sh) return;
    const cutouts = sh.cutouts || [];
    cutouts.splice(idx, 1);
    sh.cutouts = cutouts;
    renderCutoutList(cutouts);
    applyNodeGeom();
    status("已移除孔洞");
  }
  $("#btn-add-cutout").onclick = () => {
    if (selNode < 0) { status("请先选中一个连杆"); return; }
    const n = model.nodes[selNode];
    const sh = n.geometry && n.geometry.shape;
    if (!sh) { status("请先启用自定义外形"); return; }
    const cutouts = sh.cutouts || [];
    cutouts.push({ profile: "circle", params: { radius: 5 }, x: 0, y: 0 });
    sh.cutouts = cutouts;
    renderCutoutList(cutouts);
    applyNodeGeom();
    status("已添加孔洞");
  };

  /* ---- 多边形顶点编辑器 ---- */
  function openPolyEditor() {
    if (selNode < 0) return;
    const n = model.nodes[selNode];
    const sh = n.geometry && n.geometry.shape;
    const verts = (sh && sh.params && sh.params.vertices) ? sh.params.vertices.slice() : [];
    renderPolyVerts(verts);
    // store temporary working copy on the modal
    $("#poly-modal")._polyVerts = verts;
    $("#poly-modal").classList.add("show");
  }
  function renderPolyVerts(verts) {
    const list = $("#poly-vert-list");
    list.innerHTML = "";
    if (!verts.length) {
      // default triangle
      verts.push([-15, -10], [15, -10], [0, 15]);
    }
    verts.forEach((v, i) => {
      const row = document.createElement("div");
      row.className = "poly-vert-row";
      row.innerHTML = `<label>V${i}</label>
        X <input type="number" class="pvx" value="${v[0]}">
        Y <input type="number" class="pvy" value="${v[1]}">
        <a href="#" class="del" data-pvi="${i}">✕</a>`;
      row.querySelector(".pvx").oninput = () => { verts[i][0] = +row.querySelector(".pvx").value; };
      row.querySelector(".pvy").oninput = () => { verts[i][1] = +row.querySelector(".pvy").value; };
      row.querySelector(".del").onclick = (e) => {
        e.preventDefault();
        verts.splice(i, 1);
        renderPolyVerts(verts);
      };
      list.appendChild(row);
    });
  }
  $("#btn-gext-poly-edit").onclick = openPolyEditor;
  $("#btn-poly-add").onclick = () => {
    const verts = $("#poly-modal")._polyVerts || [];
    verts.push([0, 0]);
    renderPolyVerts(verts);
  };
  $("#btn-poly-done").onclick = () => {
    const verts = $("#poly-modal")._polyVerts || [];
    if (verts.length < 3) { status("至少需要 3 个顶点"); return; }
    if (selNode >= 0) {
      const n = model.nodes[selNode];
      let sh = n.geometry && n.geometry.shape;
      if (sh) {
        sh.params.vertices = verts.map((v) => [Math.round(v[0]), Math.round(v[1])]);
        $("#gext-poly-count").textContent = verts.length + " 个";
        applyNodeGeom();
        status(`多边形已更新：${verts.length} 个顶点`);
      }
    }
    $("#poly-modal").classList.remove("show");
  };

  function fillOrigin(n) {
    $("#nd-ox").value = +n.joint.origin.x.toFixed(1);
    $("#nd-oy").value = +n.joint.origin.y.toFixed(1);
    $("#nd-oz").value = +n.joint.origin.z.toFixed(1);
  }

  $("#nd-name").oninput = () => { if (selNode >= 0) { Designer.rename(model, selNode, $("#nd-name").value); renderTree(); } };
  $("#nd-type").onchange = () => { Designer.setType(model, selNode, $("#nd-type").value); selectNode(selNode); buildSliders(); refreshAll(); };
  $("#nd-axis").onchange = () => { Designer.setAxis(model, selNode, $("#nd-axis").value); refreshAll(); };
  $("#nd-ox").oninput = $("#nd-oy").oninput = $("#nd-oz").oninput = () => {
    if (selNode < 0) return;
    Designer.setOrigin(model, selNode, +$("#nd-ox").value, +$("#nd-oy").value, +$("#nd-oz").value);
    refreshAll();
  };
  $("#nd-lo").oninput = $("#nd-hi").oninput = () => { if (selNode >= 0) Designer.setLimit(model, selNode, +$("#nd-lo").value, +$("#nd-hi").value); };
  $("#nd-ee").onchange = () => { Designer.toggleEE(model, selNode); buildEEList(); renderTree(); refreshAll(); };
  function applyShape() {
    const t = $("#nd-shape").value;
    const shape = t === "box" ? { type: "box", w: +$("#nd-w").value || 16, d: +$("#nd-d").value || 16 } : { type: "cylinder", radius: +$("#nd-radius").value || 9 };
    Designer.setLinkShape(model, selNode, shape);
    $("#shape-cyl").style.display = t === "cylinder" ? "" : "none";
    $("#shape-box").style.display = t === "box" ? "" : "none";
    refreshAll();
  }
  $("#nd-shape").onchange = applyShape;
  $("#nd-radius").oninput = $("#nd-w").oninput = $("#nd-d").oninput = () => { if (selNode >= 0) applyShape(); };
  $("#nd-resetrot").onclick = () => { if (selNode >= 0) { Designer.resetRot(model, selNode); refreshAll(); } };
  $("#nd-color").oninput = () => { if (selNode >= 0) { Designer.setColor(model, selNode, $("#nd-color").value); refreshAll(); } };
  // 调色板
  document.querySelectorAll(".palette .chip").forEach((ch) => {
    ch.onclick = () => {
      if (selNode < 0) return;
      const c = ch.dataset.c;
      Designer.setColor(model, selNode, c);
      $("#nd-color").value = c;
      document.querySelectorAll(".palette .chip").forEach((x) => x.classList.remove("active"));
      ch.classList.add("active");
      refreshAll();
    };
  });
  // 随机颜色
  $("#btn-rand-color").onclick = () => {
    if (selNode < 0) return;
    const rand = "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
    Designer.setColor(model, selNode, rand);
    $("#nd-color").value = rand;
    document.querySelectorAll(".palette .chip").forEach((x) => x.classList.toggle("active", x.dataset.c === rand));
    refreshAll();
    status("🎲 已应用随机颜色");
  };
  // 材质
  $("#nd-material").onchange = () => {
    if (selNode < 0) return;
    model.nodes[selNode].materialType = $("#nd-material").value;
    // clear material cache for this node's color
    const c = model.nodes[selNode].color;
    if (c && robot._matCache[c]) robot._matCache[c] = { _isNodeCache: true };
    refreshAll();
  };
  // 透明度
  $("#nd-opacity").oninput = () => {
    if (selNode < 0) return;
    const val = +$("#nd-opacity").value / 100;
    $("#nd-opacity-val").textContent = Math.round(val * 100) + "%";
    model.nodes[selNode].opacity = val;
    const c = model.nodes[selNode].color;
    if (c && robot._matCache[c]) robot._matCache[c] = { _isNodeCache: true };
    refreshAll();
  };

  function addPart(type) {
    if (selNode < 0) { status("请先在结构树中选中一个父连杆"); return; }
    kf.clear();
    const ni = Designer.addChild(model, selNode, { type });
    buildSliders(); buildEEList(); selectNode(ni); refreshAll();
    status("已添加部件，用手柄或数值调整位置/尺寸");
  }
  document.querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => addPart(b.dataset.add)));

  /* 直接创建新零件（带外形） */
  function addShapePart(shapeType) {
    if (selNode < 0) { status("请先在结构树中选中一个父连杆"); return; }
    kf.clear();
    const ni = Designer.addChild(model, selNode, { type: "fixed", shape: shapeType });
    buildSliders(); buildEEList(); selectNode(ni); refreshAll();
    status(`已创建新零件「${model.nodes[ni].name}」，在下方外形编辑器中调整尺寸`);
  }
  document.querySelectorAll("[data-shape]").forEach((b) => (b.onclick = () => addShapePart(b.dataset.shape)));

  /* ---- 草图绘制 ---- */
  const sketch = new SketchManager();
  function startSketch() {
    // 没有选父连杆则自动挂到根
    if (selNode < 0 && model.nodes.length > 0) {
      selNode = 0;
      robot.setSelectedNode(0);
      $("#node-editor").style.display = "";
      renderTree();
    }
    sketch.start();
    view2d.sketchMode = true;
    view2d.sketchPoints = sketch.points;
    view2d.draw();
    $("#btn-sketch-start").style.display = "none";
    $("#btn-sketch-finish").style.display = "";
    $("#btn-sketch-cancel").style.display = "";
    $("#sketch-coord-row").style.display = "";
    $("#sketch-depth-row").style.display = "";
    $("#sketch-hint").style.display = "";
    $("#sketch-count").textContent = "0";
    updateSketchCoordLabel();
    status("✏ 草图模式：在 2D 俯视图点击放置顶点，或在下方输入 X/Z 坐标");
    // 切换到 2D 视图
    document.querySelector('.vtab[data-view="2d"]').click();
  }
  function updateSketchCoordLabel() {
    $("#sketch-vert-label").textContent = `顶点 ${sketch.points.length + 1}`;
    if (sketch.points.length) {
      const last = sketch.points[sketch.points.length - 1];
      $("#sketch-input-x").value = Math.round(last.x);
      $("#sketch-input-z").value = Math.round(last.z);
    }
  }
  function finishSketch() {
    if (sketch.points.length < 3) { status("至少需要 3 个顶点才能完成草图"); return; }
    const depth = +$("#sketch-depth").value || 30;
    const shape = sketch.toShape(depth);
    if (!shape) { status("草图无效"); return; }
    sketch.close();
    // 创建新零件（自动挂到当前父节点或根）
    const parent = selNode >= 0 ? selNode : 0;
    const ni = Designer.addChild(model, parent, { type: "fixed" });
    const n = model.nodes[ni];
    n.name = "草图" + ni;
    n.geometry = { shape };
    // 还原 UI
    exitSketch();
    buildSliders(); buildEEList(); selectNode(ni); refreshAll();
    status(`✅ 草图已创建为拉伸体「${n.name}」，深度 ${depth} mm`);
  }
  function exitSketch() {
    sketch.stop();
    view2d.sketchMode = false;
    view2d.sketchPoints = [];
    view2d.draw();
    $("#btn-sketch-start").style.display = "";
    $("#btn-sketch-finish").style.display = "none";
    $("#btn-sketch-cancel").style.display = "none";
    $("#sketch-coord-row").style.display = "none";
    $("#sketch-depth-row").style.display = "none";
    $("#sketch-hint").style.display = "none";
  }
  $("#btn-sketch-start").onclick = startSketch;
  $("#btn-sketch-finish").onclick = finishSketch;
  $("#btn-sketch-cancel").onclick = () => { exitSketch(); status("草图已取消"); };
  // 坐标输入添加草图顶点
  $("#btn-sketch-add-coord").onclick = () => {
    if (!sketch.active) return;
    const x = +$("#sketch-input-x").value || 0;
    const z = +$("#sketch-input-z").value || 0;
    sketch.addPoint(x, z);
    view2d.sketchPoints = sketch.points;
    view2d.draw();
    $("#sketch-count").textContent = sketch.points.length;
    updateSketchCoordLabel();
  };
  view2d.onSketchPoint = () => {
    $("#sketch-count").textContent = sketch.points.length;
    updateSketchCoordLabel();
  };
  view2d.onSketchComplete = (pts) => {
    // 自动闭合：设置点，然后完成
    sketch.points = pts;
    finishSketch();
  };

  /* ---- 草图深度同步 ---- */
  $("#sketch-depth-slider").oninput = () => {
    $("#sketch-depth").value = $("#sketch-depth-slider").value;
  };
  $("#sketch-depth").oninput = () => {
    $("#sketch-depth-slider").value = $("#sketch-depth").value;
  };

  /* ---- 草图变换：翻转 / 旋转 ---- */
  function applySketchTransform(fn) {
    if (selNode < 0) return;
    const n = model.nodes[selNode];
    const sh = n.geometry && n.geometry.shape;
    if (!sh || sh.type !== "extrude" || !sh.params || !sh.params.vertices) return;
    const v = sh.params.vertices;
    fn(v);
    sh.params.vertices = v.map((pt) => [Math.round(pt[0]), Math.round(pt[1])]);
    $("#gext-poly-count").textContent = v.length + " 个";
    applyNodeGeom();
  }
  $("#btn-sketch-flip-x").onclick = () => {
    applySketchTransform((v) => v.forEach((p) => (p[0] = -p[0])));
    status("✅ 已水平翻转");
  };
  $("#btn-sketch-flip-y").onclick = () => {
    applySketchTransform((v) => v.forEach((p) => (p[1] = -p[1])));
    status("✅ 已垂直翻转");
  };
  $("#sketch-rotate").oninput = function () {
    const deg = +this.value;
    $("#sketch-rotate-val").textContent = deg + "°";
    if (selNode < 0) return;
    const n = model.nodes[selNode];
    const sh = n.geometry && n.geometry.shape;
    if (!sh || sh.type !== "extrude" || !sh.params || !sh.params.vertices) return;
    const rad = deg * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const v = sh.params.vertices;
    const rotV = v.map((p) => [Math.round(p[0] * cos - p[1] * sin), Math.round(p[0] * sin + p[1] * cos)]);
    sh.params.vertices = rotV;
    $("#gext-poly-count").textContent = v.length + " 个";
    applyNodeGeom();
  };

  /* ---- 镜像 & 阵列 ---- */
  $("#btn-mirror").onclick = () => {
    if (selNode <= 0) { status("不能镜像根节点"); return; }
    const plane = prompt("镜像平面: XY / YZ / XZ", "XZ");
    if (!plane || !["XY", "YZ", "XZ"].includes(plane)) return;
    kf.clear();
    const ni = Designer.mirrorPart(model, selNode, plane);
    buildSliders(); buildEEList(); selectNode(ni); refreshAll();
    status(`✅ 已镜像创建「${model.nodes[ni].name}」`);
  };
  $("#btn-pattern").onclick = () => {
    if (selNode <= 0) { status("不能阵列根节点"); return; }
    const type = prompt("阵列类型: linear / circular", "linear");
    if (!type || !["linear", "circular"].includes(type)) return;
    if (type === "linear") {
      const count = parseInt(prompt("数量:", "3")) || 3;
      const step = parseInt(prompt("间距 (mm):", "60")) || 60;
      const axis = prompt("方向轴 (X/Y/Z):", "Z");
      const d = { X: [step, 0, 0], Y: [0, step, 0], Z: [0, 0, step] }[axis] || [step, 0, 0];
      kf.clear();
      const indices = Designer.patternLinear(model, selNode, count, d[0], d[1], d[2]);
      buildSliders(); buildEEList(); selectNode(indices[indices.length - 1]); refreshAll();
      status(`✅ 已创建线性阵列，共 ${count} 个`);
    } else {
      const count = parseInt(prompt("数量:", "6")) || 6;
      const angle = parseFloat(prompt("总角度:", "360")) || 360;
      kf.clear();
      const indices = Designer.patternCircular(model, selNode, count, 0, 0, 0, angle);
      buildSliders(); buildEEList(); selectNode(indices[indices.length - 1]); refreshAll();
      status(`✅ 已创建圆周阵列，共 ${count} 个`);
    }
  };

  /* ---- 尺寸标注 ---- */
  $("#chk-dim").onchange = () => {
    robot.showDimensions = $("#chk-dim").checked;
    if (robot.showDimensions && selNode >= 0) {
      robot.updateDimensions(selNode);
    } else {
      robot.showDimensions = false;
      [...robot._dimGroup.children].forEach((o) => robot._dimGroup.remove(o));
    }
  };

  /* ---- 3D 自由放置 ---- */
  let fpActive = false;
  function setFP(on) {
    fpActive = on;
    robot.cadClickMode = on;
    robot.clickPlaneY = +$("#fp-y").value || 120;
    robot.renderer.domElement.style.cursor = on ? "crosshair" : "";
    $("#btn-fp-toggle").textContent = on ? "📍 放置中…点击场景" : "📍 开始放置";
    $("#btn-fp-toggle").classList.toggle("active", on);
    if (on) status("🎯 自由放置：在 3D 场景地面点击即可放置零件");
    else status("");
  }
  function placeAt(x, y, z) {
    const shapeType = $("#fp-shape").value;
    // 如果没有父节点，用根节点
    const parent = selNode >= 0 ? selNode : 0;
    const ni = Designer.addChild(model, parent, { type: "fixed", shape: shapeType });
    const n = model.nodes[ni];
    // 把原点设在点击位置的世界坐标
    Designer.setOriginFromWorld(model, ni, new THREE.Vector3(x, y, z));
    buildSliders(); buildEEList(); selectNode(ni); refreshAll();
    status(`✅ 已放置「${n.name}」到 (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)})`);
  }
  $("#btn-fp-toggle").onclick = () => setFP(!fpActive);
  $("#btn-fp-place").onclick = () => {
    const x = +$("#fp-x").value || 0;
    const y = +$("#fp-y").value || 120;
    const z = +$("#fp-z").value || 0;
    placeAt(x, y, z);
  };
  // 3D 场景点击放置
  robot.onCadClickPoint = (p) => {
    if (!fpActive) return;
    const x = p.x, y = robot.clickPlaneY, z = p.z;
    $("#fp-x").value = Math.round(x);
    $("#fp-y").value = Math.round(y);
    $("#fp-z").value = Math.round(z);
    placeAt(x, y, z);
    // 放置后保持模式激活，可以继续点
  };
  $("#nd-del").onclick = () => {
    if (selNode <= 0) { status("不能删除根节点"); return; }
    kf.clear();
    Designer.removeSubtree(model, selNode);
    selNode = -1; $("#node-editor").style.display = "none";
    buildSliders(); buildEEList(); renderTree(); refreshAll();
    status("已删除连杆及其子树");
  };
  $("#cad-new").onclick = () => {
    if (!confirm("新建空白机器人？当前机型与轨迹将被清空。")) return;
    importedDef = Designer.blank();
    const sel = $("#robot-select");
    if (!sel.querySelector('option[value="imported"]')) { const o = document.createElement("option"); o.value = "imported"; sel.appendChild(o); }
    sel.querySelector('option[value="imported"]').textContent = "🛠 " + importedDef.name;
    loadModel(importedDef, "imported");
    toggleDesign(true); selectNode(0);
    status("已新建空白机器人，从底座开始添加子连杆");
  };
  $("#cad-done").onclick = () => { toggleDesign(false); status("已切换到动作设计模式，可拖动末端设计轨迹"); };
  $("#cad-export").onclick = () => downloadText(JSON.stringify(model.toJSON(), null, 2), (model.name || "robot") + ".json");

  // 手柄模式
  $("#giz-move").onclick = () => { $("#giz-move").classList.add("active"); $("#giz-rot").classList.remove("active"); robot.setGizmoMode("translate"); };
  $("#giz-rot").onclick = () => { $("#giz-rot").classList.add("active"); $("#giz-move").classList.remove("active"); robot.setGizmoMode("rotate"); };

  // Gizmo 拖拽回调
  robot.onGizmoTranslate = (i, axis, d) => { Designer.translate(model, i, axis, d, snapStep()); robot.rebuild(); fillOrigin(model.nodes[i]); };
  robot.onGizmoRotate = (i, axis, da) => { Designer.rotate(model, i, axis, da); robot.rebuild(); };
  robot.onGizmoEnd = () => refreshAll();

  $("#btn-sethome").onclick = () => { Designer.setHomeToCurrent(model); status("已把当前姿态设为初始姿态"); };

  /* ---------- 帮助 / 示例 ---------- */
  function populateExamples() {
    const box = $("#example-buttons"); box.innerHTML = "";
    Examples.listFor(model).forEach((ex) => {
      const b = document.createElement("button");
      b.className = "ex"; b.textContent = ex.label;
      b.onclick = () => {
        const frames = Examples.build(model, ex.id);
        kf.clear();
        frames.forEach((f) => { model.q = f.q.slice(); kf.capture(model, f.grip); });
        if (kf.frames.length) loadFrame(0);
        $("#help-modal").classList.remove("show");
        status(`已加载示例「${ex.label.trim()}」，共 ${kf.frames.length} 帧，点播放预览`);
      };
      box.appendChild(b);
    });
  }
  $("#btn-help").onclick = () => $("#help-modal").classList.add("show");
  $("#btn-start").onclick = () => $("#help-modal").classList.remove("show");
  document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => b.closest(".modal").classList.remove("show")));

  /* ---------- 启动 ---------- */
  buildRobotSelect();
  loadModel(Presets.get("arm6"), "arm6");
  view2d.resize();
  status("就绪 — 选择机器人，拖动末端或调关节设计姿态，捕获关键帧后生成代码");
})();
