/* ============================================================
 * shapes.js — 增强的 3D 形状系统
 *   支持 box / cylinder / sphere / extrude 及其挖孔
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
          // fallback to rect
          return makeProfile('rect', { width: 40, height: 30 });
        }
        sh.moveTo(verts[0][0], verts[0][1]);
        for (let i = 1; i < verts.length; i++) {
          sh.lineTo(verts[i][0], verts[i][1]);
        }
        sh.closePath();
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
        return new THREE.SphereGeometry(p.radius || 25, 18, 14);

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
        // 将几何居中（ExtrudeGeometry 的 Z 范围是 0~depth）
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
      case 'box':
        return `方块 ${p.width||40}×${p.depth||40}×${p.height||30}`;
      case 'cylinder':
        return `圆柱 r=${p.radius||20} h=${p.height||40}`;
      case 'sphere':
        return `球体 r=${p.radius||25}`;
      case 'extrude':
        return `拉伸(${opts.profile||'rect'}) d=${opts.depth||30}`;
      case 'triangle':
        return `三角柱 a=${p.side||40}`;
      default:
        return type;
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
    // cylinder default
    return {
      geo: new THREE.CylinderGeometry(1, 1, 1, 14),
      rx: ls.radius || 9,
      rz: ls.radius || 9,
    };
  }

  /* ---- 生成默认的 shape 配置 ---- */
  function defaultShape(type) {
    switch (type) {
      case 'box':
        return { type: 'box', params: { width: 40, height: 30, depth: 40 } };
      case 'cylinder':
        return { type: 'cylinder', params: { radius: 20, height: 40 } };
      case 'sphere':
        return { type: 'sphere', params: { radius: 25 } };
      case 'triangle':
        return { type: 'extrude', profile: 'triangle', params: { side: 40 }, depth: 30, cutouts: [] };
      case 'extrude':
        return { type: 'extrude', profile: 'rect', params: { width: 40, height: 30 }, depth: 30, cutouts: [] };
      default:
        return { type: 'box', params: { width: 40, height: 30, depth: 40 } };
    }
  }

  return { buildGeometry, makeProfile, addCutouts, shapeLabel, buildBoneGeometry, defaultShape };
})();
