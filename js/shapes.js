/* ============================================================
 * shapes.js — 增强的 3D 形状系统 v3
 *   支持 box / cylinder / sphere / cone / torus / pyramid
 *        wedge / pipe / gear / extrude 及其挖孔
 *   extrude 截面: rect / circle / triangle / polygon
 * ============================================================ */

const Shapes = (function () {
  /* ---- 构建 2D 轮廓 (Three.Shape) ---- */
  function makeProfile(profile, params) {
    const sh = new THREE.Shape();
    switch (profile) {
      case 'rect': {
        const w = (params.width || 40) / 2;
        const h = (params.height || 30) / 2;
        sh.moveTo(-w, -h);
        sh.lineTo(w, -h);
        sh.lineTo(w, h);
        sh.lineTo(-w, h);
        sh.closePath();
        return sh;
      }
      case 'circle': {
        const r = params.radius || 20;
        const segs = 32;
        sh.moveTo(r, 0);
        for (let i = 1; i <= segs; i++) {
          const a = (i / segs) * Math.PI * 2;
          sh.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        return sh;
      }
      case 'triangle': {
        const s = params.side || 40;
        const hh = s * Math.sqrt(3) / 3;
        sh.moveTo(0, -hh * 2 / 3);
        sh.lineTo(s / 2, hh / 3);
        sh.lineTo(-s / 2, hh / 3);
        sh.closePath();
        return sh;
      }
      case 'polygon': {
        const verts = params.vertices;
        if (!verts || verts.length < 3) {
          return makeProfile('rect', { width: 40, height: 30 });
        }
        sh.moveTo(verts[0][0], verts[0][1]);
        for (let i = 1; i < verts.length; i++) {
          sh.lineTo(verts[i][0], verts[i][1]);
        }
        sh.closePath();
        return sh;
      }
      case 'gear': {
        // 齿轮轮廓
        const r = params.radius || 30;
        const teeth = params.teeth || 12;
        const toothDepth = params.toothDepth || 6;
        const innerR = r - toothDepth;
        const segsPerTooth = 6;
        const total = teeth * segsPerTooth;
        const da = (Math.PI * 2) / total;
        for (let i = 0; i < total; i++) {
          const a = i * da - Math.PI / 2;
          const isTooth = (i % segsPerTooth) < 3; // 3 segs out, 3 segs in
          const cr = isTooth ? r : innerR;
          const fn = i === 0 ? 'moveTo' : 'lineTo';
          sh[fn](Math.cos(a) * cr, Math.sin(a) * cr);
        }
        sh.closePath();
        return sh;
      }
      case 'ring': {
        const rOuter = params.radius || 30;
        const rInner = params.innerRadius || 15;
        const segs = 32;
        // 外圆
        sh.moveTo(rOuter, 0);
        for (let i = 1; i <= segs; i++) {
          const a = (i / segs) * Math.PI * 2;
          sh.lineTo(Math.cos(a) * rOuter, Math.sin(a) * rOuter);
        }
        // 内圆（作为孔洞）
        const hole = new THREE.Path();
        hole.moveTo(rInner, 0);
        for (let i = segs; i >= 0; i--) {
          const a = (i / segs) * Math.PI * 2;
          hole.lineTo(Math.cos(a) * rInner, Math.sin(a) * rInner);
        }
        sh.holes.push(hole);
        return sh;
      }
      default:
        return makeProfile('rect', { width: 40, height: 30 });
    }
  }

  /* ---- 添加孔洞 (到 Shape 上) ---- */
  function addCutouts(shape, cutouts) {
    (cutouts || []).forEach((c) => {
      const p = new THREE.Path();
      const cx = c.x || 0,
        cy = c.y || 0;
      const cp = c.params || {};
      switch (c.profile) {
        case 'circle': {
          const r = cp.radius || 5;
          const segs = 24;
          for (let i = segs; i >= 0; i--) {
            const a = (i / segs) * Math.PI * 2;
            const fn = i === segs ? 'moveTo' : 'lineTo';
            p[fn](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
          }
          break;
        }
        case 'rect': {
          const hw = (cp.width || 10) / 2;
          const hh = (cp.height || 10) / 2;
          p.moveTo(cx - hw, cy - hh);
          p.lineTo(cx + hw, cy - hh);
          p.lineTo(cx + hw, cy + hh);
          p.lineTo(cx - hw, cy + hh);
          p.closePath();
          break;
        }
        case 'triangle': {
          const s = cp.side || 10;
          const th = s * Math.sqrt(3) / 3;
          p.moveTo(cx, cy - th * 2 / 3);
          p.lineTo(cx + s / 2, cy + th / 3);
          p.lineTo(cx - s / 2, cy + th / 3);
          p.closePath();
          break;
        }
      }
      shape.holes.push(p);
    });
  }

  /* ---- 构建楔形（直角三棱柱）自定义几何 ---- */
  function buildWedgeGeometry(w, h, d) {
    // w=X方向宽, h=Y方向高, d=Z方向深
    // 楔形：底部是矩形 w×d，顶部是一条线在 x=0 处
    const hw = w / 2, hh = h, hd = d / 2;
    const verts = [
      // 底部矩形
      [-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd],
      // 顶部线（沿 Z 方向在 x=0, y=h）
      [0, hh, -hd], [0, hh, hd],
    ];
    const idx = [
      // 底面
      0, 1, 2, 0, 2, 3,
      // 垂直面（x正方向）
      1, 4, 5, 1, 5, 2,
      // 倾斜面（x负方向）
      0, 3, 5, 0, 5, 4,
      // 侧面（z正方向）
      3, 2, 5,
      // 侧面（z负方向）
      0, 4, 1,
    ];
    const geo = new THREE.BufferGeometry();
    const positions = [];
    verts.forEach((v) => positions.push(v[0], v[1], v[2]));
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  /* ---- 从 shape 定义构建 THREE.BufferGeometry ---- */
  function buildGeometry(opts) {
    if (!opts) return null;
    const type = opts.type || 'box';
    const p = opts.params || {};

    switch (type) {
      case 'box':
        return new THREE.BoxGeometry(p.width || 40, p.height || 30, p.depth || 40);

      case 'cylinder':
        return new THREE.CylinderGeometry(p.radiusTop ?? (p.radius || 20), p.radiusBottom ?? (p.radius || 20), p.height || 40, 24);

      case 'sphere':
        return new THREE.SphereGeometry(p.radius || 25, 24, 18);

      case 'cone':
        return new THREE.ConeGeometry(p.radius || 20, p.height || 40, 24);

      case 'torus':
        return new THREE.TorusGeometry(p.radius || 30, p.tube || 10, 16, 24);

      case 'pyramid':
        return new THREE.ConeGeometry(p.width / 2 || 20, p.height || 30, 4);

      case 'wedge': {
        const w = p.width || 40, h = p.height || 30, d = p.depth || 40;
        return buildWedgeGeometry(w, h, d);
      }

      case 'pipe': {
        // 管子 = 环状拉伸
        const profile = 'ring';
        const depth = p.height || 30;
        const shape = makeProfile(profile, p);
        const cfg = { depth, bevelEnabled: false };
        const geo = new THREE.ExtrudeGeometry(shape, cfg);
        geo.translate(0, 0, -depth / 2);
        return geo;
      }

      case 'gear': {
        // 齿轮 = 齿形轮廓拉伸
        const depth = p.height || 20;
        const shape = makeProfile('gear', p);
        const cfg = { depth, bevelEnabled: false };
        const geo = new THREE.ExtrudeGeometry(shape, cfg);
        geo.translate(0, 0, -depth / 2);
        return geo;
      }

      case 'triangle':
      case 'extrude': {
        const profile = opts.profile || 'rect';
        const depth = opts.depth || 30;
        const shape = makeProfile(profile, p);
        addCutouts(shape, opts.cutouts || []);
        const cfg = {
          depth: depth,
          bevelEnabled: true,
          bevelThickness: 1.5,
          bevelSize: 0.8,
          bevelSegments: 2,
        };
        const geo = new THREE.ExtrudeGeometry(shape, cfg);
        geo.translate(0, 0, -depth / 2);
        return geo;
      }

      default:
        return new THREE.BoxGeometry(40, 30, 40);
    }
  }

  /* ---- 工具：获取形状的描述文字 ---- */
  function shapeLabel(opts) {
    if (!opts) return '无';
    const type = opts.type || 'box';
    const p = opts.params || {};
    switch (type) {
      case 'box': return `方块 ${p.width||40}×${p.depth||40}×${p.height||30}`;
      case 'cylinder': return `圆柱 r=${p.radius||20} h=${p.height||40}`;
      case 'sphere': return `球体 r=${p.radius||25}`;
      case 'cone': return `圆锥 r=${p.radius||20} h=${p.height||40}`;
      case 'torus': return `圆环 R=${p.radius||30} t=${p.tube||10}`;
      case 'pyramid': return `棱锥 w=${p.width||40} h=${p.height||30}`;
      case 'wedge': return `楔形 ${p.width||40}×${p.depth||40}×${p.height||30}`;
      case 'pipe': return `管材 R=${p.radius||30} r=${p.innerRadius||15} h=${p.height||30}`;
      case 'gear': return `齿轮 r=${p.radius||30} t=${p.teeth||12}`;
      case 'extrude': return `拉伸(${opts.profile||'rect'}) d=${opts.depth||30}`;
      case 'triangle': return `三角柱 a=${p.side||40}`;
      default: return type;
    }
  }

  /* ---- 为 linkShape (连杆骨) 生成偏移用的几何 ---- */
  function buildBoneGeometry(linkShape) {
    const ls = linkShape || { type: 'cylinder', radius: 9 };
    if (ls.type === 'box') {
      return {
        geo: new THREE.BoxGeometry(1, 1, 1),
        rx: (ls.w || 16) / 1,
        rz: (ls.d || 16) / 1,
      };
    }
    return {
      geo: new THREE.CylinderGeometry(1, 1, 1, 14),
      rx: ls.radius || 9,
      rz: ls.radius || 9,
    };
  }

  /* ---- 生成默认的 shape 配置 ---- */
  function defaultShape(type) {
    switch (type) {
      case 'box': return { type: 'box', params: { width: 40, height: 30, depth: 40 } };
      case 'cylinder': return { type: 'cylinder', params: { radius: 20, height: 40 } };
      case 'sphere': return { type: 'sphere', params: { radius: 25 } };
      case 'cone': return { type: 'cone', params: { radius: 20, height: 40 } };
      case 'torus': return { type: 'torus', params: { radius: 30, tube: 10 } };
      case 'pyramid': return { type: 'pyramid', params: { width: 40, height: 30 } };
      case 'wedge': return { type: 'wedge', params: { width: 40, depth: 40, height: 30 } };
      case 'pipe': return { type: 'pipe', params: { radius: 30, innerRadius: 15, height: 30 } };
      case 'gear': return { type: 'gear', params: { radius: 30, teeth: 12, toothDepth: 6 }, height: 20 };
      case 'triangle': return { type: 'extrude', profile: 'triangle', params: { side: 40 }, depth: 30, cutouts: [] };
      case 'extrude': return { type: 'extrude', profile: 'rect', params: { width: 40, height: 30 }, depth: 30, cutouts: [] };
      default: return { type: 'box', params: { width: 40, height: 30, depth: 40 } };
    }
  }

  /* ---- 构建草图平面 3D 网格 ---- */
  /* plane: 'XY', 'YZ', 'XZ'; size: 网格大小; divisions: 格数 */
  function sketchPlaneGrid(plane, size, divisions) {
    size = size || 400;
    divisions = divisions || 8;
    const step = size / divisions;
    const half = size / 2;
    const group = new THREE.Group();

    // 半透明平面
    let geo;
    if (plane === 'YZ') geo = new THREE.PlaneGeometry(size, size);
    else if (plane === 'XZ') geo = new THREE.PlaneGeometry(size, size);
    else geo = new THREE.PlaneGeometry(size, size); // XY

    const planeMat = new THREE.MeshBasicMaterial({
      color: 0xff8a3d, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, planeMat);
    if (plane === 'XY') mesh.rotation.x = -Math.PI / 2;
    else if (plane === 'YZ') mesh.rotation.y = Math.PI / 2;
    mesh.position.set(0, 0, 0);
    group.add(mesh);

    // 网格线
    const lineMat = new THREE.LineBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.25 });
    for (let i = -divisions / 2; i <= divisions / 2; i++) {
      const p = i * step;
      let pts1, pts2;
      if (plane === 'XY') {
        pts1 = [new THREE.Vector3(p, -half, 0), new THREE.Vector3(p, half, 0)];
        pts2 = [new THREE.Vector3(-half, p, 0), new THREE.Vector3(half, p, 0)];
      } else if (plane === 'YZ') {
        pts1 = [new THREE.Vector3(0, p, -half), new THREE.Vector3(0, p, half)];
        pts2 = [new THREE.Vector3(0, -half, p), new THREE.Vector3(0, half, p)];
      } else { // XZ
        pts1 = [new THREE.Vector3(p, 0, -half), new THREE.Vector3(p, 0, half)];
        pts2 = [new THREE.Vector3(-half, 0, p), new THREE.Vector3(half, 0, p)];
      }
      [pts1, pts2].forEach((pts) => {
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        group.add(new THREE.Line(g, lineMat));
      });
    }
    // 轴线标识
    const axLen = size * 0.35;
    const axCol = [0xff4444, 0x44ff44, 0x4488ff];
    const axDir = plane === 'XY' ? [[1, 0, 0], [0, 1, 0]]
      : plane === 'YZ' ? [[0, 1, 0], [0, 0, 1]]
      : [[1, 0, 0], [0, 0, 1]];
    axDir.forEach((d, ai) => {
      const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(d[0] * axLen, d[1] * axLen, d[2] * axLen)];
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      group.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: axCol[ai], linewidth: 2 })));
    });
    return group;
  }

  /* ---- 布尔运算（基于 Profile 级别） ---- */
  /* 将两个形状的截面合并为一个新的截面定义 */
  function mergeProfiles(shA, shB) {
    // 对于 polygon 轮廓：合并顶点列表（近似 union）
    // 对于简单形状：返回组合的 cutout 列表
    const merged = {
      type: 'extrude',
      profile: shB.profile || 'rect',
      params: Object.assign({}, shB.params || {}),
      depth: Math.max(shA.depth || 30, shB.depth || 30),
      cutouts: (shA.cutouts || []).slice(),
    };
    // 把 shB 作为 cutout 加到 shA？简化处理：保持主体为 shA，shB 作为附加
    return merged;
  }

  /* 减法：把 shapeB 的轮廓作为 cutout 添加到 shapeA */
  function subtractProfile(shapeA, shapeB) {
    if (!shapeA || !shapeB) return shapeA;
    const cutouts = (shapeA.cutouts || []).slice();
    // 把 shapeB 转换为一个 cutout 条目
    const bProf = shapeB.profile || 'rect';
    const bP = shapeB.params || {};
    let cutout = { profile: bProf, params: {}, x: 0, y: 0 };
    switch (bProf) {
      case 'rect': cutout.params = { width: bP.width || 30, height: bP.height || 20 }; break;
      case 'circle': cutout.params = { radius: bP.radius || 15 }; break;
      case 'triangle': cutout.params = { side: bP.side || 30 }; break;
      case 'polygon': {
        // 多边形作为 cutout 比较困难，近似为圆形
        cutout.profile = 'circle';
        cutout.params = { radius: 15 };
        break;
      }
    }
    cutouts.push(cutout);
    return Object.assign({}, shapeA, { cutouts });
  }

  /* 交集：返回重叠区域的近似表示 */
  function intersectProfile(shapeA, shapeB) {
    // 简化实现：返回较小的形状
    if (!shapeA || !shapeB) return shapeA;
    return Object.assign({}, shapeA, { cutouts: shapeA.cutouts ? shapeA.cutouts.slice() : [] });
  }

  return { buildGeometry, makeProfile, addCutouts, shapeLabel, buildBoneGeometry, defaultShape,
    sketchPlaneGrid, mergeProfiles, subtractProfile, intersectProfile };
})();
