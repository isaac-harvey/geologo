export type Pt = { x:number, y:number };

/** Squared distance (stable for dedupe) */
export function dist2(a:Pt,b:Pt){ 
  const dx=a.x-b.x, dy=a.y-b.y; 
  return dx*dx + dy*dy; 
}

/** Intersection of two infinite lines through (p1,p2) and (p3,p4). Returns null if parallel or coincident. */
export function lineLine(p1:Pt,p2:Pt,p3:Pt,p4:Pt):Pt|null{
  const x1=p1.x,y1=p1.y,x2=p2.x,y2=p2.y;
  const x3=p3.x,y3=p3.y,x4=p4.x,y4=p4.y;
  const den = (x1-x2)*(y3-y4) - (y1-y2)*(x3-x4);
  if(Math.abs(den) < 1e-12) return null;
  const px = ((x1*y2 - y1*x2)*(x3-x4) - (x1-x2)*(x3*y4 - y3*x4))/den;
  const py = ((x1*y2 - y1*x2)*(y3-y4) - (y1-y2)*(x3*y4 - y3*x4))/den;
  return { x:px, y:py };
}

/** Intersections of infinite line (p1,p2) with circle (c,r). Returns 0,1, or 2 points. */
export function lineCircle(p1:Pt,p2:Pt,c:Pt,r:number):Pt[]{
  const d = { x: p2.x-p1.x, y: p2.y-p1.y };
  const f = { x: p1.x-c.x, y: p1.y-c.y };
  const A = d.x*d.x + d.y*d.y;
  const B = 2*(f.x*d.x + f.y*d.y);
  const C = f.x*f.x + f.y*f.y - r*r;
  const disc = B*B - 4*A*C;
  if(disc < -1e-12) return [];
  if(Math.abs(disc) < 1e-12){
    const t = -B/(2*A);
    return [{ x: p1.x + t*d.x, y: p1.y + t*d.y }];
  }
  const s = Math.sqrt(Math.max(0,disc));
  const t1 = (-B + s)/(2*A);
  const t2 = (-B - s)/(2*A);
  return [
    { x: p1.x + t1*d.x, y: p1.y + t1*d.y },
    { x: p1.x + t2*d.x, y: p1.y + t2*d.y },
  ];
}

/** Intersections of circles (c1,r1) and (c2,r2). Returns 0,1, or 2 points. */
export function circleCircle(c1:Pt, r1:number, c2:Pt, r2:number):Pt[]{
  const dx = c2.x - c1.x, dy = c2.y - c1.y;
  const d = Math.hypot(dx,dy);
  if(d < 1e-12) return []; // concentric
  if(d > r1 + r2 + 1e-12) return [];
  if(d < Math.abs(r1 - r2) - 1e-12) return [];
  const a = (r1*r1 - r2*r2 + d*d)/(2*d);
  const h2 = r1*r1 - a*a;
  if(h2 < 1e-12){
    const x = c1.x + a*dx/d, y = c1.y + a*dy/d;
    return [{x,y}];
  }
  const h = Math.sqrt(h2);
  const xm = c1.x + a*dx/d;
  const ym = c1.y + a*dy/d;
  const rx = -dy*(h/d), ry = dx*(h/d);
  return [{ x: xm+rx, y: ym+ry }, { x: xm-rx, y: ym-ry }];
}

/** Screen-space distance from a point to an infinite line passing through p1s->p2s (all in screen px). */
export function pointToLineDistPx(sp:{x:number,y:number}, p1s:{x:number,y:number}, p2s:{x:number,y:number}){
  const x=sp.x, y=sp.y, x1=p1s.x, y1=p1s.y, x2=p2s.x, y2=p2s.y;
  const A = x - x1, B = y - y1, C = x2 - x1, D = y2 - y1;
  const len = C*C + D*D || 1;
  const t = (A*C + B*D) / len;
  const projx = x1 + t*C, projy = y1 + t*D;
  return Math.hypot(x - projx, y - projy);
}

/** Screen-space distance from a point to a circle ring (all in screen px) */
export function pointToCircleRingPx(sp:{x:number,y:number}, cs:{x:number,y:number}, rpx:number){
  const d = Math.hypot(sp.x - cs.x, sp.y - cs.y);
  return Math.abs(d - rpx);
}

/** Ray-cast point-in-polygon (world coords). */
export function pointInPoly(pt:Pt, poly:Pt[]):boolean{
  let inside = false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const xi=poly[i].x, yi=poly[i].y;
    const xj=poly[j].x, yj=poly[j].y;
    const intersect = ((yi>pt.y)!==(yj>pt.y)) && (pt.x < (xj-xi)*(pt.y-yi)/(yj-yi+1e-12)+xi);
    if(intersect) inside = !inside;
  }
  return inside;
}

/** Ramer–Douglas–Peucker simplification (screen/world agnostic). */
export function simplifyRDP(points:Pt[], eps:number):Pt[]{
  if(points.length < 3) return points.slice();
  const perpendicularDistance = (p:Pt, a:Pt, b:Pt) => {
    const dx=b.x-a.x, dy=b.y-a.y;
    const denom = Math.hypot(dx,dy) || 1;
    const t = ((p.x-a.x)*dx + (p.y-a.y)*dy)/(denom*denom);
    const proj = { x: a.x + t*dx, y: a.y + t*dy };
    return Math.hypot(p.x-proj.x, p.y-proj.y);
  };
  const simplified:Pt[] = [];
  const recurse = (pts:Pt[], s:number, e:number) => {
    let maxd = -1, idx = -1;
    for(let i=s+1;i<e;i++){
      const d = perpendicularDistance(pts[i], pts[s], pts[e]);
      if(d > maxd){ maxd = d; idx = i; }
    }
    if(maxd > eps && idx !== -1){
      recurse(pts, s, idx);
      recurse(pts, idx, e);
    } else {
      simplified.push(pts[s]);
    }
  };
  recurse(points, 0, points.length-1);
  simplified.push(points[points.length-1]);
  return simplified;
}
