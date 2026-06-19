/* ============================================================
 * sketch.js — 2D 草图绘制系统
 *   在 2D 俯视图上点击绘制封闭轮廓，生成拉伸体外形
 * ============================================================ */

class SketchManager {
  constructor() {
    this.points = [];       // [{x, z}] 2D points in world XZ
    this.active = false;
  }

  start() { this.points = []; this.active = true; }
  stop() { this.active = false; }
  addPoint(x, z) { this.points.push({ x, z }); }
  removeLast() { if (this.points.length) this.points.pop(); }
  clear() { this.points = []; }

  close() {
    if (this.points.length < 3) return false;
    this.active = false;
    return true;
  }

  /* 判断是否靠近第一个点（用于自动闭合检测） */
  nearFirst(x, z, threshold) {
    if (this.points.length < 3) return false;
    const f = this.points[0];
    return Math.hypot(x - f.x, z - f.z) < (threshold || 20);
  }

  /* 转换为形状定义 (用于 shapes.js) */
  toShape(depth) {
    if (this.points.length < 3) return null;
    const verts = this.points.map((p) => [Math.round(p.x), Math.round(p.z)]);
    return {
      type: 'extrude',
      profile: 'polygon',
      params: { vertices: verts },
      depth: depth || 30,
      cutouts: [],
    };
  }
}
