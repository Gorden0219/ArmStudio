/* ============================================================
 * partslib.js — 标准工业零件库 v1
 *   包含紧固件/轴承/齿轮/型材/轴/导轨/联轴器/气动件
 *   每个零件标注标准型号与参数，可直接生成几何体
 * ============================================================ */

const PartsLib = (function () {
  const V3 = THREE.Vector3;

  /* ---------- 工具函数 ---------- */
  function hexWrench(d) { return { M3: 2.5, M4: 3, M5: 4, M6: 5, M8: 6, M10: 8, M12: 10, M14: 12, M16: 14, M18: 14, M20: 17 }[d] || d * 0.75; }
  function hexHead(d) { return { M3: 5.5, M4: 7, M5: 8, M6: 10, M8: 13, M10: 16, M12: 18, M14: 21, M16: 24, M18: 27, M20: 30 }[d] || d * 1.5; }
  function hexHeadH(d) { return { M3: 2, M4: 2.8, M5: 3.5, M6: 4, M8: 5.3, M10: 6.4, M12: 7.5, M14: 8.8, M16: 10, M18: 11.5, M20: 13 }[d] || d * 0.65; }
  function boltDiam(d) { return { M3: 3, M4: 4, M5: 5, M6: 6, M8: 8, M10: 10, M12: 12, M14: 14, M16: 16, M18: 18, M20: 20 }[d] || d; }
  function nutThick(d) { return { M3: 2.4, M4: 3.2, M5: 4, M6: 5, M8: 6.5, M10: 8, M12: 10, M14: 11, M16: 13, M18: 15, M20: 16 }[d] || d * 0.8; }

  /* 构建螺栓几何 */
  function buildBolt(size, length) {
    const d = boltDiam(size);
    const hw = hexHead(size);
    const hh = hexHeadH(size);
    const group = new THREE.Group();
    // 头部：六角柱用CylinderGeometry近似（6边）
    const head = new THREE.Mesh(
      new THREE.CylinderGeometry(hw / 2, hw / 2, hh, 6),
      new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.7, roughness: 0.3 })
    );
    head.position.y = hh / 2;
    group.add(head);
    // 螺杆
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(d / 2, d / 2, length, 12),
      new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.6, roughness: 0.4 })
    );
    shaft.position.y = hh + length / 2;
    group.add(shaft);
    return group;
  }

  function buildNut(size) {
    const d = boltDiam(size);
    const hw = hexHead(size);
    const th = nutThick(size);
    const group = new THREE.Group();
    const nut = new THREE.Mesh(
      new THREE.CylinderGeometry(hw / 2, hw / 2, th, 6),
      new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.6, roughness: 0.3 })
    );
    nut.position.y = th / 2;
    group.add(nut);
    // 螺纹孔
    const hole = new THREE.Mesh(
      new THREE.CylinderGeometry(d * 0.45, d * 0.45, th, 12),
      new THREE.MeshBasicMaterial({ color: 0x222222 })
    );
    hole.position.y = th / 2;
    group.add(hole);
    return group;
  }

  function buildBearing(innerD, outerD, width) {
    const group = new THREE.Group();
    // 外圈
    const outer = new THREE.Mesh(
      new THREE.TorusGeometry(outerD / 2, (outerD - innerD) / 4, 12, 24),
      new THREE.MeshStandardMaterial({ color: 0xcc8844, metalness: 0.8, roughness: 0.2 })
    );
    outer.rotation.x = Math.PI / 2;
    outer.position.y = width / 2;
    group.add(outer);
    // 内圈
    const inner = new THREE.Mesh(
      new THREE.CylinderGeometry(innerD / 2, innerD / 2, width, 18),
      new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.7, roughness: 0.3 })
    );
    inner.position.y = width / 2;
    group.add(inner);
    // 滚珠
    const ballR = (outerD - innerD) / 8;
    const pitchR = (outerD + innerD) / 4;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(ballR, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.9, roughness: 0.1 })
      );
      ball.position.set(Math.cos(a) * pitchR, width / 2, Math.sin(a) * pitchR);
      group.add(ball);
    }
    return group;
  }

  function buildSpurGear(module, teeth, faceWidth, holeD) {
    // 近似齿轮：用齿形拉伸
    const pitchR = module * teeth / 2;
    const addendum = module;
    const outerR = pitchR + addendum;
    const rootR = pitchR - 1.25 * module;
    const shape = new THREE.Shape();
    const segs = teeth * 4;
    const da = (Math.PI * 2) / segs;
    const toothW = (Math.PI / teeth) * 0.45; // 齿厚角
    for (let i = 0; i < segs; i++) {
      const a = i * da;
      const isTooth = (i % 4) < 2;
      const r = isTooth ? outerR : rootR;
      const fn = i === 0 ? 'moveTo' : 'lineTo';
      shape[fn](Math.cos(a) * r, Math.sin(a) * r);
    }
    shape.closePath();
    const cfg = { depth: faceWidth, bevelEnabled: false };
    const geo = new THREE.ExtrudeGeometry(shape, cfg);
    geo.translate(0, 0, -faceWidth / 2);
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xccaa66, metalness: 0.6, roughness: 0.4 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = Math.PI / 2;
    group.add(mesh);
    // 轴孔
    if (holeD > 0) {
      const hole = new THREE.Mesh(
        new THREE.CylinderGeometry(holeD / 2, holeD / 2, faceWidth, 12),
        new THREE.MeshBasicMaterial({ color: 0x222222 })
      );
      hole.position.y = 0;
      group.add(hole);
    }
    return group;
  }

  function buildAluExtrusion(w, h, slotW, slotD, wallT, length) {
    // 铝型材截面：矩形框 + T型槽
    const shape = new THREE.Shape();
    const hw = w / 2, hh = h / 2;
    // 外框
    shape.moveTo(-hw, -hh); shape.lineTo(hw, -hh); shape.lineTo(hw, hh); shape.lineTo(-hw, hh);
    shape.closePath();
    // 内框
    const innerHole = new THREE.Path();
    const iw = hw - wallT, ih = hh - wallT;
    innerHole.moveTo(-iw, -ih); innerHole.lineTo(iw, -ih); innerHole.lineTo(iw, ih); innerHole.lineTo(-iw, ih);
    shape.holes.push(innerHole);

    // 槽（每边2个）
    const slotPos = [-hw + slotD + slotW / 2, hw - slotD - slotW / 2];
    slotPos.forEach((sx) => {
      [-1, 1].forEach((side) => {
        const sy = side * (hh - slotD - slotW / 2);
        const slot = new THREE.Path();
        const sw = slotW / 2, sd = slotD;
        slot.moveTo(sx - sw, sy); slot.lineTo(sx + sw, sy);
        slot.lineTo(sx + sw, sy - side * sd);
        slot.lineTo(sx - sw, sy - side * sd);
        shape.holes.push(slot);
      });
    });
    const cfg = { depth: length, bevelEnabled: false };
    const geo = new THREE.ExtrudeGeometry(shape, cfg);
    geo.translate(0, 0, -length / 2);
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x8899aa, metalness: 0.5, roughness: 0.5 });
    group.add(new THREE.Mesh(geo, mat));
    return group;
  }

  /* ---------- 零件目录 ---------- */
  const CATALOG = {

    fasteners: {
      label: '🔩 紧固件',
      items: [
        { id: 'hex-bolt', label: '外六角螺栓 DIN933', desc: '全螺纹六角螺栓', standard: 'DIN 933',
          params: { size: { type: 'select', label: '规格', options: ['M3','M4','M5','M6','M8','M10','M12','M14','M16','M18','M20'], default: 'M6' },
                    length: { type: 'range', label: '长度 mm', min: 10, max: 200, step: 5, default: 30 } },
          build(p) { return buildBolt(p.size, p.length); } },
        { id: 'hex-nut', label: '六角螺母 DIN934', desc: '标准六角螺母', standard: 'DIN 934',
          params: { size: { type: 'select', label: '规格', options: ['M3','M4','M5','M6','M8','M10','M12','M14','M16','M18','M20'], default: 'M6' } },
          build(p) { return buildNut(p.size); } },
        { id: 'flat-washer', label: '平垫圈 DIN125', desc: 'A级平垫圈', standard: 'DIN 125',
          params: { size: { type: 'select', label: '规格', options: ['M3','M4','M5','M6','M8','M10','M12','M14','M16','M18','M20'], default: 'M6' } },
          build(p) {
            const d = boltDiam(p.size);
            const od = { M3:7,M4:9,M5:10,M6:12,M8:16,M10:20,M12:24,M14:28,M16:30,M18:34,M20:37 }[p.size]||d*2;
            const t = { M3:0.5,M4:0.8,M5:1,M6:1.6,M8:1.6,M10:2,M12:2.5,M14:2.5,M16:3,M18:3,M20:3}[p.size]||1;
            const geo = new THREE.CylinderGeometry(od/2, od/2, t, 24);
            const hole = new THREE.CylinderGeometry(d/2, d/2, t, 12);
            const group = new THREE.Group();
            group.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.5, roughness: 0.4 })));
            return group;
          } },
        { id: 'socket-cap', label: '内六角螺钉 DIN912', desc: '圆柱头内六角', standard: 'DIN 912',
          params: { size: { type: 'select', label: '规格', options: ['M3','M4','M5','M6','M8','M10','M12','M14','M16'], default: 'M6' },
                    length: { type: 'range', label: '长度 mm', min: 6, max: 100, step: 5, default: 25 } },
          build(p) {
            const d = boltDiam(p.size);
            const hk = { M3:2.5,M4:3,M5:4,M6:5,M8:6,M10:8,M12:10,M14:12,M16:14}[p.size]||d*0.75;
            const hd = d*1.5; const hh = d;
            const group = new THREE.Group();
            const head = new THREE.Mesh(new THREE.CylinderGeometry(hd/2,hd/2,hh,12), new THREE.MeshStandardMaterial({color:0x888888,metalness:0.7,roughness:0.3}));
            head.position.y = hh/2; group.add(head);
            const shaft = new THREE.Mesh(new THREE.CylinderGeometry(d/2,d/2,p.length,12), new THREE.MeshStandardMaterial({color:0xaaaaaa,metalness:0.6,roughness:0.4}));
            shaft.position.y = hh + p.length/2; group.add(shaft);
            return group;
          } },
      ],
    },

    bearings: {
      label: '⚙️ 轴承',
      items: [
        { id: 'deep-groove', label: '深沟球轴承 6系列', desc: '深沟球轴承', standard: 'GB/T 276',
          params: { model: { type: 'select', label: '型号', options: ['6000','6001','6002','6003','6004','6005','6006','6007','6008','6200','6201','6202','6203','6204','6205','6206','6207','6208'], default: '6204' } },
          build(p) {
            const spec = { '6000':[10,26,8],'6001':[12,28,8],'6002':[15,32,9],'6003':[17,35,10],'6004':[20,42,12],'6005':[25,47,12],'6006':[30,55,13],'6007':[35,62,14],'6008':[40,68,15],
                          '6200':[10,30,9],'6201':[12,32,10],'6202':[15,35,11],'6203':[17,40,12],'6204':[20,47,14],'6205':[25,52,15],'6206':[30,62,16],'6207':[35,72,17],'6208':[40,80,18] }[p.model]||[20,47,14];
            return buildBearing(spec[0], spec[1], spec[2]);
          } },
        { id: 'flange-bearing', label: '带法兰轴承', desc: '方形法兰轴承座', standard: 'UCF系列',
          params: { model: { type: 'select', label: '型号', options: ['UCF201','UCF202','UCF203','UCF204','UCF205','UCF206','UCF207','UCF208'], default: 'UCF204' } },
          build(p) {
            const spec = { 'UCF201':[12,86,64,94],'UCF202':[15,90,64,94],'UCF203':[17,90,64,94],'UCF204':[20,96,68,113],'UCF205':[25,105,70,122],'UCF206':[30,118,80,130],'UCF207':[35,125,84,138],'UCF208':[40,144,96,155]}[p.model]||[20,96,68,113];
            const group = new THREE.Group();
            const box = new THREE.Mesh(new THREE.BoxGeometry(spec[1],spec[3]*0.6,spec[1]), new THREE.MeshStandardMaterial({color:0x667788,metalness:0.3,roughness:0.6}));
            box.position.y = spec[3]*0.3; group.add(box);
            return group;
          } },
        { id: 'linear-bearing', label: '直线轴承 LM系列', desc: '直线运动球轴承', standard: 'LM系列',
          params: { model: { type: 'select', label: '型号', options: ['LM8','LM10','LM12','LM13','LM16','LM20','LM25','LM30','LM40'], default: 'LM16' } },
          build(p) {
            const spec = { 'LM8':[8,15,24],'LM10':[10,19,29],'LM12':[12,21,30],'LM13':[13,23,32],'LM16':[16,28,36],'LM20':[20,32,40],'LM25':[25,40,50],'LM30':[30,45,55],'LM40':[40,60,70]}[p.model]||[16,28,36];
            const group = new THREE.Group();
            const outer = new THREE.Mesh(new THREE.CylinderGeometry(spec[1]/2,spec[1]/2,spec[2],18), new THREE.MeshStandardMaterial({color:0xcccccc,metalness:0.7,roughness:0.3}));
            outer.position.y = spec[2]/2; group.add(outer);
            return group;
          } },
      ],
    },

    gears: {
      label: '⚙️ 齿轮',
      items: [
        { id: 'spur-gear', label: '直齿轮', desc: '渐开线直齿圆柱齿轮', standard: 'DIN 780',
          params: { module: { type: 'select', label: '模数 m', options: ['0.5','0.8','1','1.25','1.5','2','2.5','3','4','5'], default: '1' },
                    teeth: { type: 'range', label: '齿数 Z', min: 8, max: 120, step: 1, default: 20 },
                    width: { type: 'range', label: '齿宽 mm', min: 5, max: 80, step: 1, default: 15 },
                    hole: { type: 'range', label: '轴孔 mm', min: 0, max: 30, step: 1, default: 6 } },
          build(p) { return buildSpurGear(parseFloat(p.module), +p.teeth, +p.width, +p.hole); } },
        { id: 'bevel-gear', label: '锥齿轮', desc: '直齿锥齿轮', standard: 'DIN 3971',
          params: { module: { type: 'select', label: '模数', options: ['1','1.5','2','2.5','3','4'], default: '2' },
                    teeth: { type: 'range', label: '齿数', min: 8, max: 60, step: 1, default: 20 } },
          build(p) {
            const m = parseFloat(p.module); const z = +p.teeth; const R = m*z/2;
            const geo = new THREE.ConeGeometry(R, R*0.7, z*2);
            const group = new THREE.Group();
            group.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({color:0xccaa66,metalness:0.6,roughness:0.4})));
            group.rotation.x = Math.PI/2;
            return group;
          } },
      ],
    },

    profiles: {
      label: '📐 型材',
      items: [
        { id: 'alu-2020', label: '铝型材 20×20', desc: '欧洲标准铝型材', standard: 'ISO 20×20',
          params: { length: { type: 'range', label: '长度 mm', min: 50, max: 2000, step: 10, default: 300 } },
          build(p) { return buildAluExtrusion(20, 20, 5, 3, 1.5, +p.length); } },
        { id: 'alu-4040', label: '铝型材 40×40', desc: '欧洲标准铝型材', standard: 'ISO 40×40',
          params: { length: { type: 'range', label: '长度 mm', min: 50, max: 2000, step: 10, default: 300 } },
          build(p) { return buildAluExtrusion(40, 40, 8, 4.5, 2, +p.length); } },
        { id: 'alu-4080', label: '铝型材 40×80', desc: '40×80 重型铝型材', standard: 'ISO 40×80',
          params: { length: { type: 'range', label: '长度 mm', min: 50, max: 2000, step: 10, default: 300 } },
          build(p) { return buildAluExtrusion(40, 80, 8, 4.5, 2.5, +p.length); } },
        { id: 'i-beam', label: '工字钢', desc: '热轧工字钢', standard: 'GB/T 706',
          params: { model: { type: 'select', label: '型号', options: ['10#','12#','14#','16#','18#','20#','22#','25#'], default: '10#' },
                    length: { type: 'range', label: '长度 mm', min: 100, max: 3000, step: 50, default: 500 } },
          build(p) {
            const s = { '10#':[100,68,4.5,7.6],'12#':[120,74,5,8.4],'14#':[140,80,5.5,9.1],'16#':[160,88,6,9.9],'18#':[180,94,6.5,10.7],'20#':[200,100,7,11.4],'22#':[220,110,7.5,12.3],'25#':[250,116,8,13]}[p.model]||[100,68,4.5,7.6];
            const h=s[0],b=s[1],tw=s[2],tf=s[3],L=+p.length;
            const shape = new THREE.Shape();
            const hh=h/2, hb=b/2;
            shape.moveTo(-hb,-hh); shape.lineTo(hb,-hh); shape.lineTo(hb,-hh+tf); shape.lineTo(tw/2,-hh+tf);
            shape.lineTo(tw/2,hh-tf); shape.lineTo(hb,hh-tf); shape.lineTo(hb,hh); shape.lineTo(-hb,hh);
            shape.lineTo(-hb,hh-tf); shape.lineTo(-tw/2,hh-tf); shape.lineTo(-tw/2,-hh+tf); shape.lineTo(-hb,-hh+tf);
            shape.closePath();
            const cfg={depth:L,bevelEnabled:false}; const geo=new THREE.ExtrudeGeometry(shape,cfg); geo.translate(0,0,-L/2);
            const group=new THREE.Group();
            group.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({color:0x778899,metalness:0.3,roughness:0.6})));
            return group;
          } },
        { id: 'channel', label: 'C型钢', desc: '热轧槽钢', standard: 'GB/T 707',
          params: { model: { type: 'select', label: '型号', options: ['8#','10#','12#','14#','16#','18#','20#'], default: '10#' },
                    length: { type: 'range', label: '长度 mm', min: 100, max: 3000, step: 50, default: 500 } },
          build(p) {
            const s = { '8#':[80,43,5,8],'10#':[100,48,5.3,8.5],'12#':[120,53,5.5,9],'14#':[140,58,6,9.5],'16#':[160,63,6.5,10],'18#':[180,68,7,10.5],'20#':[200,73,7,11]}[p.model]||[100,48,5.3,8.5];
            const h=s[0],b=s[1],tw=s[2],tf=s[3],L=+p.length;
            const shape = new THREE.Shape();
            const hh=h/2;
            shape.moveTo(-tw/2,-hh); shape.lineTo(b,-hh); shape.lineTo(b,-hh+tf); shape.lineTo(tw/2,-hh+tf);
            shape.lineTo(tw/2,hh-tf); shape.lineTo(b,hh-tf); shape.lineTo(b,hh); shape.lineTo(-tw/2,hh);
            shape.closePath();
            const cfg={depth:L,bevelEnabled:false}; const geo=new THREE.ExtrudeGeometry(shape,cfg); geo.translate(0,0,-L/2);
            const group=new THREE.Group();
            group.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({color:0x778899,metalness:0.3,roughness:0.6})));
            return group;
          } },
      ],
    },

    shafts: {
      label: '🔧 轴类',
      items: [
        { id: 'solid-shaft', label: '实心轴', desc: '研磨圆钢', standard: 'GB/T 699',
          params: { diameter: { type: 'select', label: '直径 mm', options: ['6','8','10','12','14','15','16','18','20','22','25','28','30','35','40','50'], default: '16' },
                    length: { type: 'range', label: '长度 mm', min: 20, max: 1000, step: 10, default: 200 } },
          build(p) {
            const d = +p.diameter; const L = +p.length;
            const geo = new THREE.CylinderGeometry(d/2, d/2, L, 18);
            const group = new THREE.Group();
            group.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({color:0xbbbbbb,metalness:0.7,roughness:0.3})));
            group.rotation.x = Math.PI/2;
            return group;
          } },
        { id: 'hollow-shaft', label: '空心轴/管', desc: '精密钢管', standard: 'GB/T 3639',
          params: { od: { type: 'select', label: '外径 mm', options: ['10','12','15','16','18','20','25','30','35','40','50','60'], default: '20' },
                    id: { type: 'select', label: '内径 mm', options: ['6','8','10','12','14','16','18','20','25','30'], default: '12' },
                    length: { type: 'range', label: '长度 mm', min: 20, max: 1000, step: 10, default: 200 } },
          build(p) {
            const od = +p.od, id = +p.id, L = +p.length;
            const shape = new THREE.Shape();
            shape.moveTo(od/2,0); for(let i=1;i<=32;i++){const a=i/32*Math.PI*2;shape.lineTo(Math.cos(a)*od/2,Math.sin(a)*od/2);}
            const hole = new THREE.Path(); hole.moveTo(id/2,0); for(let i=32;i>=0;i--){const a=i/32*Math.PI*2;hole.lineTo(Math.cos(a)*id/2,Math.sin(a)*id/2);}
            shape.holes.push(hole);
            const geo = new THREE.ExtrudeGeometry(shape,{depth:L,bevelEnabled:false}); geo.translate(0,0,-L/2);
            const group=new THREE.Group();
            group.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({color:0xbbbbbb,metalness:0.7,roughness:0.3})));
            group.rotation.x=Math.PI/2; return group;
          } },
      ],
    },

    linear: {
      label: '📏 直线运动',
      items: [
        { id: 'linear-rail', label: '直线导轨 HGH', desc: '滚动直线导轨副', standard: 'HGH系列',
          params: { model: { type: 'select', label: '型号', options: ['HGH15','HGH20','HGH25','HGH30','HGH35','HGH45'], default: 'HGH20' },
                    length: { type: 'range', label: '长度 mm', min: 100, max: 2000, step: 50, default: 400 } },
          build(p) {
            const spec = { 'HGH15':[15,24,15],'HGH20':[20,31,20],'HGH25':[23,35,23],'HGH30':[28,40,28],'HGH35':[34,48,34],'HGH45':[45,60,45]}[p.model]||[20,31,20];
            const w=spec[0], h=spec[1], L=+p.length;
            const geo = new THREE.BoxGeometry( w, h, L );
            const group = new THREE.Group();
            group.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({color:0x888899,metalness:0.6,roughness:0.4})));
            // 滑块
            const sw=w*2, sh=h*0.8, sl=w*1.5;
            const slider = new THREE.Mesh(new THREE.BoxGeometry(sw,sh,sl), new THREE.MeshStandardMaterial({color:0x445566,metalness:0.4,roughness:0.5}));
            slider.position.set(0, h/2+sh/2, 0);
            group.add(slider);
            group.position.y = 0;
            return group;
          } },
        { id: 'ball-screw', label: '滚珠丝杆', desc: '精密滚珠丝杆', standard: 'SFU系列',
          params: { model: { type: 'select', label: '型号', options: ['SFU1605','SFU2005','SFU2010','SFU2505','SFU2510','SFU3210','SFU3220'], default: 'SFU1605' },
                    length: { type: 'range', label: '长度 mm', min: 100, max: 1500, step: 50, default: 400 } },
          build(p) {
            const d = { 'SFU1605':16,'SFU2005':20,'SFU2010':20,'SFU2505':25,'SFU2510':25,'SFU3210':32,'SFU3220':32}[p.model]||16;
            const L = +p.length;
            const geo = new THREE.CylinderGeometry(d/2, d/2, L, 18);
            const group = new THREE.Group();
            group.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({color:0xaaaaaa,metalness:0.7,roughness:0.3})));
            group.rotation.x = Math.PI/2; return group;
          } },
      ],
    },

    couplings: {
      label: '🔗 联轴器',
      items: [
        { id: 'jaw-coupling', label: '梅花联轴器', desc: '弹性梅花联轴器', standard: 'GB/T 5272',
          params: { model: { type: 'select', label: '型号', options: ['LM-25','LM-30','LM-38','LM-45','LM-55','LM-65'], default: 'LM-30' } },
          build(p) {
            const spec = {'LM-25':[25,34,9],'LM-30':[30,34,9],'LM-38':[38,34,10],'LM-45':[45,44,12],'LM-55':[55,57,14],'LM-65':[65,67,16]}[p.model]||[30,34,9];
            const [od, len] = spec;
            const group = new THREE.Group();
            group.add(new THREE.Mesh(new THREE.CylinderGeometry(od/2,od/2,len,18), new THREE.MeshStandardMaterial({color:0x888888,metalness:0.5,roughness:0.5})));
            return group;
          } },
        { id: 'beam-coupling', label: '柔性联轴器', desc: '螺旋切缝柔性联轴器', standard: '工业标准',
          params: { od: { type: 'select', label: '外径 mm', options: ['12','16','20','25','32','40'], default: '20' },
                    length: { type: 'range', label: '长度 mm', min: 15, max: 60, step: 1, default: 30 } },
          build(p) {
            const od = +p.od, L = +p.length;
            const group = new THREE.Group();
            group.add(new THREE.Mesh(new THREE.CylinderGeometry(od/2,od/2,L,18), new THREE.MeshStandardMaterial({color:0xccbb99,metalness:0.3,roughness:0.5})));
            return group;
          } },
      ],
    },

    pneumatics: {
      label: '💨 气动元件',
      items: [
        { id: 'compact-cyl', label: '薄型气缸 CQ2', desc: '薄型/紧凑型气缸', standard: 'CQ2系列',
          params: { bore: { type: 'select', label: '缸径 mm', options: ['20','25','32','40','50','63','80','100'], default: '32' },
                    stroke: { type: 'range', label: '行程 mm', min: 10, max: 200, step: 5, default: 50 } },
          build(p) {
            const bore = +p.bore, stroke = +p.stroke;
            const L = Math.max(stroke + bore * 0.8, bore);
            const group = new THREE.Group();
            const barrel = new THREE.Mesh(new THREE.CylinderGeometry(bore/2,bore/2,L,18), new THREE.MeshStandardMaterial({color:0xdddddd,metalness:0.5,roughness:0.4}));
            barrel.position.y = L/2; group.add(barrel);
            // 活塞杆
            const rodD = bore * 0.3;
            const rod = new THREE.Mesh(new THREE.CylinderGeometry(rodD/2,rodD/2,stroke+bore*0.4,12), new THREE.MeshStandardMaterial({color:0xbbbbbb,metalness:0.7,roughness:0.3}));
            rod.position.y = L + (stroke+bore*0.4)/2; group.add(rod);
            return group;
          } },
      ],
    },

  };

  /* ---------- API ---------- */
  function categories() { return Object.keys(CATALOG); }
  function categoryInfo(id) { return CATALOG[id]; }
  function items(catId) { return (CATALOG[catId] || {}).items || []; }
  function itemInfo(catId, itemId) { return (CATALOG[catId] || {}).items.find((i) => i.id === itemId); }

  function build(catId, itemId, params) {
    const item = itemInfo(catId, itemId);
    if (!item || !item.build) return null;
    return item.build(params || {});
  }

  /* 获取默认参数 */
  function defaultParams(catId, itemId) {
    const item = itemInfo(catId, itemId);
    if (!item || !item.params) return {};
    const out = {};
    Object.keys(item.params).forEach((k) => { out[k] = item.params[k].default; });
    return out;
  }

  return { categories, categoryInfo, items, itemInfo, build, defaultParams, CATALOG };
})();
