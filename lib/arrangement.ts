// lib/arrangement.ts
export type Pt = { x: number; y: number };

export type LineIn = { p1: Pt; p2: Pt };
export type CircleIn = { c: Pt; r: number };

export type EdgeKind = 'segment' | 'arc';

export type HalfEdge =
  | {
      kind: 'segment';
      from: number; // vertex index
      to: number;   // vertex index
      tangentAngleAtFrom: number; // [0, 2π)
    }
  | {
      kind: 'arc';
      from: number; to: number;
      c: Pt; r: number;
      sweep: 0 | 1;      // SVG sweep-flag (1=CCW)
      largeArc: 0 | 1;   // SVG large-arc-flag
      tangentAngleAtFrom: number; // [0, 2π)
    };

export type Node = { pt: Pt; out: number[] }; // outgoing half-edge indices
export type Arrangement = { nodes: Node[]; edges: HalfEdge[] };

// Path for export/draw
export type PathSeg =
  | { kind: 'L'; to: Pt }
  | { kind: 'A'; to: Pt; r: number; largeArc: 0 | 1; sweep: 0 | 1; c: Pt };

// NOTE: added optional 'color' so history/undo can preserve it.
export type RegionPath = { start: Pt; segs: PathSeg[]; color?: string };

const TAU = Math.PI * 2;

function normAngle(a: number): number {
  let t = a % TAU;
  if (t < 0) t += TAU;
  return t;
}

function angleDeltaCCW(a: number, b: number): number {
  let d = normAngle(b) - normAngle(a);
  if (d < 0) d += TAU;
  return d;
}

function approxEq(a: number, b: number, eps = 1e-9) { return Math.abs(a - b) <= eps; }

function onLine(v: Pt, L: LineIn, eps = 1e-6): boolean {
  const dx = L.p2.x - L.p1.x, dy = L.p2.y - L.p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const dvx = v.x - L.p1.x, dvy = v.y - L.p1.y;
  const dist = Math.abs(dvx * nx + dvy * ny);
  return dist <= eps;
}

function lineParamT(v: Pt, L: LineIn): number {
  const dx = L.p2.x - L.p1.x, dy = L.p2.y - L.p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  return (v.x - L.p1.x) * ux + (v.y - L.p1.y) * uy;
}

function onCircle(v: Pt, C: CircleIn, eps = 1e-6): boolean {
  const d = Math.hypot(v.x - C.c.x, v.y - C.c.y);
  return Math.abs(d - C.r) <= eps * (1 + C.r);
}

function angleAt(p: Pt, c: Pt) { return normAngle(Math.atan2(p.y - c.y, p.x - c.x)); }

export function buildArrangement(
  lines: LineIn[],
  circles: CircleIn[],
  vertices: Pt[],
  eps = 1e-6
): Arrangement {
  const nodes: Node[] = vertices.map((pt) => ({ pt, out: [] }));
  const edges: HalfEdge[] = [];

  const addEdge = (e: HalfEdge) => {
    const idx = edges.length;
    edges.push(e);
    nodes[e.from].out.push(idx);
  };

  // Lines → segments between consecutive intersection vertices
  for (const L of lines) {
    const idxs: { i: number; t: number }[] = [];
    for (let i = 0; i < vertices.length; i++) {
      const v = vertices[i];
      if (onLine(v, L, eps)) idxs.push({ i, t: lineParamT(v, L) });
    }
    if (idxs.length < 2) continue;
    idxs.sort((a, b) => a.t - b.t);
    for (let k = 0; k < idxs.length - 1; k++) {
      const i = idxs[k].i, j = idxs[k + 1].i;
      if (i === j) continue;
      const p = vertices[i], q = vertices[j];
      const ang = normAngle(Math.atan2(q.y - p.y, q.x - p.x));
      addEdge({ kind: 'segment', from: i, to: j, tangentAngleAtFrom: ang });
      addEdge({ kind: 'segment', from: j, to: i, tangentAngleAtFrom: normAngle(ang + Math.PI) });
    }
  }

  // Circles → arcs between consecutive vertices (wrap)
  for (const C of circles) {
    const idxs: { i: number; th: number }[] = [];
    for (let i = 0; i < vertices.length; i++) {
      const v = vertices[i];
      if (onCircle(v, C, eps)) idxs.push({ i, th: angleAt(v, C.c) });
    }
    if (idxs.length < 2) continue;
    idxs.sort((a, b) => a.th - b.th);
    for (let k = 0; k < idxs.length; k++) {
      const a = idxs[k];
      const b = idxs[(k + 1) % idxs.length];
      if (a.i === b.i) continue;

      const dccw = angleDeltaCCW(a.th, b.th);
      const largeArcCCW: 0 | 1 = dccw > Math.PI ? 1 : 0;

      // CCW a→b
      addEdge({
        kind: 'arc',
        from: a.i, to: b.i, c: { ...C.c }, r: C.r,
        sweep: 1, largeArc: largeArcCCW,
        tangentAngleAtFrom: normAngle(a.th + Math.PI / 2),
      });

      // CW b→a
      const largeArcCW: 0 | 1 = (TAU - dccw) > Math.PI ? 1 : 0;
      addEdge({
        kind: 'arc',
        from: b.i, to: a.i, c: { ...C.c }, r: C.r,
        sweep: 0, largeArc: largeArcCW,
        tangentAngleAtFrom: normAngle(b.th - Math.PI / 2),
      });
    }
  }

  for (const n of nodes) {
    n.out.sort((i, j) => edges[i].tangentAngleAtFrom - edges[j].tangentAngleAtFrom);
  }

  return { nodes, edges };
}

function arrivalAngle(e: HalfEdge, A: Arrangement): number {
  if (e.kind === 'segment') {
    const p = A.nodes[e.from].pt, q = A.nodes[e.to].pt;
    return normAngle(Math.atan2(q.y - p.y, q.x - p.x));
  } else {
    const v = A.nodes[e.to].pt;
    const th = angleAt(v, e.c);
    return e.sweep ? normAngle(th + Math.PI / 2) : normAngle(th - Math.PI / 2);
  }
}

// FIXED: choose next edge from the TWIN's direction (incoming + π) → smallest positive CCW turn
export function traceFaces(A: Arrangement): number[][] {
  const visited = new Array(A.edges.length).fill(false);
  const loops: number[][] = [];

  const norm = (a:number) => {
    let t = a % TAU;
    if (t < 0) t += TAU;
    return t;
  };

  for (let start = 0; start < A.edges.length; start++) {
    if (visited[start]) continue;

    let curr = start;
    const loop: number[] = [];
    let guard = 0;

    while (guard++ < 10000) {
      if (visited[curr]) { loop.length = 0; break; }
      visited[curr] = true;
      loop.push(curr);

      const e = A.edges[curr];
      const v = e.to;

      const inAng = arrivalAngle(e, A);
      const base  = norm(inAng + Math.PI); // twin direction out of v

      const outs = A.nodes[v].out;
      if (!outs.length) { loop.length = 0; break; }

      let best = -1, bestDelta = Infinity;
      for (const oe of outs) {
        const ang = A.edges[oe].tangentAngleAtFrom;
        const d = norm(ang - base);
        if (d > 1e-9 && d < bestDelta) { bestDelta = d; best = oe; }
      }
      if (best < 0) { loop.length = 0; break; }

      curr = best;
      if (curr === start) { loops.push(loop.slice()); break; }
    }
  }
  return loops;
}

export function loopToPath(A: Arrangement, loop: number[]): RegionPath {
  if (!loop.length) return { start: { x: 0, y: 0 }, segs: [] };
  const first = A.edges[loop[0]].from;
  const start = { ...A.nodes[first].pt };
  const segs: PathSeg[] = [];
  for (const idx of loop) {
    const e = A.edges[idx];
    const to = { ...A.nodes[e.to].pt };
    if (e.kind === 'segment') segs.push({ kind: 'L', to });
    else segs.push({ kind: 'A', to, r: e.r, largeArc: e.largeArc, sweep: e.sweep, c: { ...e.c } });
  }
  return { start, segs };
}

// ---------- Canvas draw / hit-test helpers ----------

export function pathToPolyline(path: RegionPath, maxAngleStep = Math.PI / 24): Pt[] {
  const pts: Pt[] = [];
  let cursor = { ...path.start };
  pts.push({ ...cursor });
  const angAt = (p: Pt, c: Pt) => Math.atan2(p.y - c.y, p.x - c.x);
  for (const s of path.segs) {
    if (s.kind === 'L') {
      cursor = { ...s.to };
      pts.push({ ...cursor });
    } else {
      const c = s.c, r = s.r, sweep = s.sweep;
      const a0 = angAt(cursor, c);
      const a1 = angAt(s.to, c);
      const dccw = ((a: number, b: number) => {
        let d = (b - a) % TAU; if (d < 0) d += TAU; return d;
      })(a0, a1);
      let d = sweep ? dccw : (TAU - dccw);
      if (d < 1e-9) d = 0;
      const steps = Math.max(2, Math.ceil(d / maxAngleStep));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const ang = sweep ? a0 + d * t : a0 - d * t;
        const px = c.x + r * Math.cos(ang);
        const py = c.y + r * Math.sin(ang);
        pts.push({ x: px, y: py });
      }
      cursor = { ...s.to };
    }
  }
  const first = pts[0], last = pts[pts.length - 1];
  if (!approxEq(first.x, last.x) || !approxEq(first.y, last.y)) pts.push({ ...first });
  return pts;
}

export function polylineArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j].x * poly[i].y - poly[i].x * poly[j].y);
  }
  return 0.5 * a;
}

function pointNearSegment(p: Pt, a: Pt, b: Pt, eps = 1e-6): boolean {
  const vx = b.x - a.x, vy = b.y - a.y;
  const wx = p.x - a.x, wy = p.y - a.y;
  const len2 = vx*vx + vy*vy || 1;
  const t = Math.max(0, Math.min(1, (wx*vx + wy*vy)/len2));
  const cx = a.x + t*vx, cy = a.y + t*vy;
  return Math.hypot(p.x - cx, p.y - cy) <= eps;
}

// Boundary counts as inside (nicer UX)
export function pointInPolyline(pt: Pt, poly: Pt[]): boolean {
  for (let i=0, j=poly.length-1; i<poly.length; j=i++) {
    if (pointNearSegment(pt, poly[j], poly[i])) return true;
  }
  let inside = false;
  for (let i=0, j=poly.length-1; i<poly.length; j=i++) {
    const xi=poly[i].x, yi=poly[i].y, xj=poly[j].x, yj=poly[j].y;
    const inter = ((yi>pt.y)!==(yj>pt.y)) &&
      (pt.x < (xj-xi)*(pt.y-yi)/((yj-yi)||1e-12) + xi);
    if (inter) inside = !inside;
  }
  return inside;
}
