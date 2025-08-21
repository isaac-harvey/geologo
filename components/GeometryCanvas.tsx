'use client';

import { useEffect, useRef, useState } from 'react';
import {
  dist2, lineLine, lineCircle, circleCircle,
  pointToLineDistPx, pointToCircleRingPx
} from '@/lib/geometry';

import {
  buildArrangement, traceFaces, loopToPath,
  pathToPolyline, pointInPolyline, polylineArea,
  type RegionPath
} from '@/lib/arrangement';

type Tool = 'point' | 'line' | 'circle' | 'fill' | 'delete';
type Pt = { x:number, y:number };
type Line = { id:string, p1:Pt, p2:Pt };
type Circle = { id:string, c:Pt, r:number };

// user point kinds:
// - 'derived': created by line/circle tools (auto-removed if no refs remain)
// - 'explicit': created by Point tool (never auto-removed; only by Delete click)
type UPoint = { id: string; p: Pt; kind: 'derived' | 'explicit'; refs: string[] };

function uuid(){ return Math.random().toString(36).slice(2,10); }

const SNAP_PX = 10;
const HIT_PX = 8;
const POINT_HIT_PX = 8;
const DRAG_THRESHOLD_PX2 = 9; // ~3px

type Snapshot = {
  lines: Line[];
  circles: Circle[];
  paths: RegionPath[];
  userPoints: UPoint[];
};

export default function GeometryCanvas({
  tool,
  fillColor,
  bisections,
  setMessage
}:{
  tool: Tool;
  fillColor: string;
  bisections: number;
  setMessage: (m:string)=>void;
}){
  const ref = useRef<HTMLCanvasElement|null>(null);

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<Pt>({ x: -400, y: -300 });
  const scaleRef = useRef(scale);
  const offsetRef = useRef(offset);
  useEffect(()=>{ scaleRef.current = scale; }, [scale]);
  useEffect(()=>{ offsetRef.current = offset; }, [offset]);

  const [lines, setLines] = useState<Line[]>([]);
  const [circles, setCircles] = useState<Circle[]>([]);
  const [paths, setPaths] = useState<RegionPath[]>([]);

  const [intersections, setIntersections] = useState<Pt[]>([]);
  const [vertices, setVertices] = useState<Pt[]>([]);
  const [userPoints, setUserPoints] = useState<UPoint[]>([]);
  const [pendingPt, setPendingPt] = useState<Pt|null>(null);
  const [pendingWasSnap, setPendingWasSnap] = useState<boolean>(false);

  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef<{x:number,y:number, o:Pt}|null>(null);

  const history = useRef<Snapshot[]>([]);

  const screenToWorld = (p:Pt):Pt => ({ x: p.x/scale + offset.x, y: p.y/scale + offset.y });
  const worldToScreen = (p:Pt):Pt => ({ x: (p.x - offset.x)*scale, y: (p.y - offset.y)*scale });

  // ---------- User point helpers ----------
  const EPS2_POS = 1e-10;
  const findUserPointIndexNear = (pt: Pt, pxTol = 6): number => {
    // search in screen space for intuitive tolerance
    let bestIdx = -1, bestD2 = (pxTol*pxTol);
    for (let i=0;i<userPoints.length;i++){
      const s = worldToScreen(userPoints[i].p);
      const d2 = (s.x - (pt.x - offset.x)*scale)**2 + (s.y - (pt.y - offset.y)*scale)**2; // not used; keep consistent
    }
    // simpler: compute directly in world with scaled tolerance
    const tolWorld = pxTol/scale;
    for (let i=0;i<userPoints.length;i++){
      if (dist2(userPoints[i].p, pt) <= (tolWorld*tolWorld)) return i;
    }
    return -1;
  };

  const addRefsIfUserPoint = (pt: Pt, refId: string) => {
    setUserPoints(prev => {
      const idx = findUserPointIndexNear(pt);
      if (idx < 0) return prev;
      const up = prev[idx];
      if (!up.refs.includes(refId)) {
        const next = prev.slice();
        next[idx] = { ...up, refs: [...up.refs, refId] };
        return next;
      }
      return prev;
    });
  };

  const addDerivedPoints = (pts: Pt[], refId: string) => {
    if(!pts.length) return;
    setUserPoints(prev => {
      const next = [...prev];
      for(const p of pts){
        const idx = findUserPointIndexNear(p);
        if (idx >= 0) {
          // point already exists → just add ref
          if (!next[idx].refs.includes(refId)) next[idx] = { ...next[idx], refs: [...next[idx].refs, refId] };
        } else {
          next.push({ id: uuid(), p: { ...p }, kind: 'derived', refs: [refId] });
        }
      }
      return next;
    });
  };

  const pruneRefsFor = (refId: string) => {
    setUserPoints(prev => {
      const out: UPoint[] = [];
      for (const up of prev) {
        const refs = up.refs.filter(r => r !== refId);
        if (up.kind === 'derived') {
          if (refs.length > 0) out.push({ ...up, refs });
          // else drop it
        } else {
          // explicit points never auto-delete
          out.push({ ...up, refs });
        }
      }
      return out;
    });
  };

  // ---------- History ----------
  const pushHistory = () => {
    history.current.push({
      lines: lines.map(l=>({ id:l.id, p1:{...l.p1}, p2:{...l.p2} })),
      circles: circles.map(c=>({ id:c.id, c:{...c.c}, r:c.r })),
      paths: paths.map(ph=>({
        start:{...ph.start},
        segs: ph.segs.map(s => s.kind==='L'
          ? { kind:'L', to:{...s.to} }
          : { kind:'A', to:{...s.to}, r:s.r, largeArc:s.largeArc, sweep:s.sweep, c:{...s.c} }
        ),
        color: ph.color
      })),
      userPoints: userPoints.map(up=>({ id:up.id, p:{...up.p}, kind:up.kind, refs:[...up.refs] }))
    });
  };

  const undo = () => {
    const snap = history.current.pop();
    if(!snap){ setMessage('Nothing to undo'); return; }
    setLines(snap.lines);
    setCircles(snap.circles);
    setPaths(snap.paths);
    setUserPoints(snap.userPoints);
    setMessage('Undone');
  };

  // ---- Seed vertical, explicit points (persist even if line is deleted) ----
  useEffect(() => {
    const c = ref.current; if (!c) return;
    let done = false;
    queueMicrotask(() => {
      if (done) return; done = true;

      const xCenterWorld = 500;
      const yUpper = -100;
      const yLower = 100;

      const pA = { x: xCenterWorld, y: yUpper };
      const pB = { x: xCenterWorld, y: yLower };

      setLines(prev => prev.some(l => l.id === 'seed-vertical') ? prev : [...prev, { id: 'seed-vertical', p1: pA, p2: pB }]);

      setUserPoints(prev => {
        const out = [...prev];
        const pushExplicit = (pt: Pt) => {
          const exists = out.some(u => dist2(u.p, pt) < EPS2_POS);
          if (!exists) out.push({ id: uuid(), p: { ...pt }, kind: 'explicit', refs: [] });
        };
        pushExplicit(pA);
        pushExplicit(pB);
        return out;
      });
    });
  }, []);

  // resize
  useEffect(()=>{
    const handle = ()=>{
      const c = ref.current;
      if(!c) return;
      const rect = c.parentElement?.getBoundingClientRect();
      const w = Math.max(300, Math.floor((rect?.width ?? 800)));
      const h = Math.floor(window.innerHeight*0.7);
      const DPR = window.devicePixelRatio || 1;
      c.width = w*DPR;
      c.height = h*DPR;
      c.style.width = w+'px';
      c.style.height = h+'px';
    };
    handle();
    window.addEventListener('resize', handle);
    return ()=>window.removeEventListener('resize', handle);
  }, []);

  // recompute intersections + combined vertices (user + intersections)
  useEffect(()=>{
    const ints: Pt[] = [];
    // line-line
    for(let i=0;i<lines.length;i++){
      for(let j=i+1;j<lines.length;j++){
        const p = lineLine(lines[i].p1, lines[i].p2, lines[j].p1, lines[j].p2);
        if(p) ints.push(p);
      }
    }
    // line-circle
    for(const L of lines){
      for(const C of circles){
        const ps = lineCircle(L.p1, L.p2, C.c, C.r);
        for(const p of ps) ints.push(p);
      }
    }
    // circle-circle
    for(let i=0;i<circles.length;i++){
      for(let j=i+1;j<circles.length;j++){
        const ps = circleCircle(circles[i].c, circles[i].r, circles[j].c, circles[j].r);
        for(const p of ps) ints.push(p);
      }
    }

    // dedupe intersections
    const uniqInts: Pt[] = [];
    const eps2 = 1e-8;
    for(const p of ints){
      if(!uniqInts.some(q=>dist2(p,q) < eps2)) uniqInts.push(p);
    }

    // combined vertices: userPoints first (so snap prefers them), then add unique intersections
    const combined: Pt[] = userPoints.map(u=>u.p).slice();
    for(const p of uniqInts){
      if(!combined.some(q=>dist2(p,q) < eps2)) combined.push(p);
    }

    setIntersections(uniqInts);
    setVertices(combined);
  }, [lines, circles, userPoints]);

  // draw
  useEffect(()=>{
    const c = ref.current;
    if(!c) return;
    const ctx = c.getContext('2d')!;
    const DPR = window.devicePixelRatio || 1;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,c.width,c.height);
    ctx.scale(DPR, DPR);

    const scrW = c.width / DPR, scrH = c.height / DPR;
    const viewTL = { x: offset.x, y: offset.y };
    const viewBR = { x: offset.x + scrW/scale, y: offset.y + scrH/scale };

    const drawLineInf = (L:Line, stroke='#718096') => {
      const dir = { x: L.p2.x - L.p1.x, y: L.p2.y - L.p1.y };
      let t0=-1e9, t1=1e9;
      const p = [ -dir.x, dir.x, -dir.y, dir.y ];
      const q = [ L.p1.x - viewTL.x, viewBR.x - L.p1.x, L.p1.y - viewTL.y, viewBR.y - L.p1.y ];
      for(let i=0;i<4;i++){
        if(p[i] === 0){ if(q[i] < 0) return; }
        else {
          const r = q[i]/p[i];
          if(p[i] < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
        }
      }
      if(t0 > t1) return;
      const A = { x: L.p1.x + t0*dir.x, y: L.p1.y + t0*dir.y };
      const B = { x: L.p1.x + t1*dir.x, y: L.p1.y + t1*dir.y };
      const a = worldToScreen(A), b = worldToScreen(B);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    };
    const drawCircle = (Ci:Circle, stroke='#718096') => {
      const s = worldToScreen(Ci.c);
      ctx.beginPath();
      ctx.arc(s.x, s.y, Ci.r*scale, 0, Math.PI*2);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    };

    // analytic fills
    for(const path of paths){
      const poly = pathToPolyline(path, Math.PI/36);
      if(poly.length < 3) continue;
      ctx.beginPath();
      const s0 = worldToScreen(poly[0]); ctx.moveTo(s0.x, s0.y);
      for(let i=1;i<poly.length;i++){
        const si = worldToScreen(poly[i]);
        ctx.lineTo(si.x, si.y);
      }
      ctx.closePath();
      ctx.fillStyle = path.color || '#36a2ff';
      ctx.globalAlpha = 0.55;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    for(const L of lines) drawLineInf(L);
    for(const Ci of circles) drawCircle(Ci);

    // Draw user points (distinct)
    for(const up of userPoints){
      const s = worldToScreen(up.p);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3, 0, Math.PI*2);
      ctx.fillStyle = up.kind === 'explicit' ? '#d946ef' : '#f59e0b'; // explicit=purple, derived=amber
      ctx.fill();
      ctx.strokeStyle = '#0a2e44';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Draw pure intersection points (exclude locations that coincide with any user point)
    const eps2 = 1e-8;
    for(const v of intersections){
      if (userPoints.some(u => dist2(u.p, v) < eps2)) continue;
      const s = worldToScreen(v);
      ctx.beginPath();
      ctx.fillStyle = '#4fc3f7'; // cyan
      ctx.arc(s.x, s.y, 2.5, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = '#0a2e44';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if(pendingPt){
      const s = worldToScreen(pendingPt);
      ctx.beginPath();
      ctx.fillStyle = '#60d394';
      ctx.arc(s.x, s.y, 3, 0, Math.PI*2);
      ctx.fill();
    }
  }, [lines, circles, paths, vertices, intersections, userPoints, offset, scale, pendingPt]);

  // snapping among combined vertices (user points & intersections)
  const pickVertex = (sp:Pt):Pt|null => {
    let best:Pt|null = null, bestd = SNAP_PX*SNAP_PX;
    for(const v of vertices){
      const sv = worldToScreen(v);
      const d2 = (sv.x-sp.x)**2 + (sv.y-sp.y)**2;
      if(d2 < bestd){ bestd = d2; best = v; }
    }
    return best;
  };

  // helpers to dedupe/replace lines on the same infinite line
  const approx = (a:number,b:number,eps=1e-9)=>Math.abs(a-b)<=eps;
  const normalizedLine = (p1:Pt, p2:Pt) => {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx,dy) || 1;
    let nx = -dy/len, ny = dx/len;
    if (nx < 0 || (approx(nx,0) && ny < 0)) { nx = -nx; ny = -ny; }
    const c = -(nx*p1.x + ny*p1.y);
    return { nx, ny, c };
  };
  const sameInfiniteLine = (A:Line, B:Line):boolean => {
    const a = normalizedLine(A.p1, A.p2);
    const b = normalizedLine(B.p1, B.p2);
    return Math.abs(a.nx-b.nx) < 1e-6 && Math.abs(a.ny-b.ny) < 1e-6 && Math.abs(a.c-b.c) < 1e-4;
  };

  // ---- Pointer handlers: pan on drag; do tool action ONLY on left mouse up (no drag) ----

  const onPointerDown = (e:React.PointerEvent<HTMLCanvasElement>) => {
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const sp = { x: e.clientX-rect.left, y: e.clientY-rect.top };

    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
    panStart.current = { x: sp.x, y: sp.y, o: { ...offset } };
    setIsPanning(false);
  };

  const onPointerMove = (e:React.PointerEvent<HTMLCanvasElement>) => {
    if (!panStart.current) return;
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const sp = { x: e.clientX-rect.left, y: e.clientY-rect.top };

    if (!isPanning) {
      const dx0 = sp.x - panStart.current.x;
      const dy0 = sp.y - panStart.current.y;
      if ((dx0*dx0 + dy0*dy0) > DRAG_THRESHOLD_PX2) setIsPanning(true);
      else return;
    }

    const dx = (sp.x - panStart.current.x)/scale;
    const dy = (sp.y - panStart.current.y)/scale;
    setOffset({ x: panStart.current.o.x - dx, y: panStart.current.o.y - dy });
  };

  const onPointerUp = (e:React.PointerEvent<HTMLCanvasElement>) => {
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const sp = { x: e.clientX-rect.left, y: e.clientY-rect.top };

    const isLeftClick = e.pointerType === 'mouse' ? e.button === 0 : true;
    const wasDrag = isPanning;

    setIsPanning(false);
    panStart.current = null;

    if (!isLeftClick) return;
    if (wasDrag) return;

    // ----- Handle tools on LEFT CLICK RELEASE -----
    const snap = pickVertex(sp);
    const wp = snap ?? screenToWorld(sp);

    if(tool==='point'){
      pushHistory();
      // If a user point exists here, upgrade to explicit; else create explicit
      setUserPoints(prev => {
        const idx = findUserPointIndexNear(wp);
        if (idx >= 0) {
          const up = prev[idx];
          if (up.kind === 'explicit') return prev; // nothing to do
          const next = prev.slice();
          next[idx] = { ...up, kind: 'explicit' }; // promote
          return next;
        }
        return [...prev, { id: uuid(), p: { ...wp }, kind: 'explicit', refs: [] }];
      });
      setMessage('Point added');
      return;
    }

    if(tool==='line'){
      if(!pendingPt){
        setPendingPt(wp);
        setPendingWasSnap(!!snap);
        setMessage('Pick second point for line');
      } else {
        const p1 = pendingPt, p2 = wp;
        pushHistory();
        let newId = uuid();
        let replaced = false;
        setLines(prev=>{
          const candidate: Line = { id: newId, p1, p2 };
          const idx = prev.findIndex(L => sameInfiniteLine(L, candidate));
          if(idx !== -1){
            newId = prev[idx].id; // keep id if replacing
            const next = prev.slice();
            next[idx] = { id: newId, p1, p2 };
            for(let j=next.length-1;j>=0;j--){
              if(j!==idx && sameInfiniteLine(next[j], next[idx])) next.splice(j,1);
            }
            replaced = true;
            return next;
          }
          return [...prev, candidate];
        });

        // Attach/insert derived points
        // First endpoint
        if (pendingWasSnap) addRefsIfUserPoint(p1, newId);
        else addDerivedPoints([p1], newId);

        // Second endpoint
        const snappedUserIdx = findUserPointIndexNear(p2);
        if (snappedUserIdx >= 0) addRefsIfUserPoint(p2, newId);
        else addDerivedPoints([p2], newId);

        // Bisections along the line
        if(bisections > 0){
          const mids: Pt[] = [];
          for(let k=1; k<=bisections; k++){
            const t = k / (bisections + 1);
            mids.push({ x: p1.x + (p2.x - p1.x)*t, y: p1.y + (p2.y - p1.y)*t });
          }
          addDerivedPoints(mids, newId);
        }

        setPendingPt(null);
        setPendingWasSnap(false);
        setMessage(replaced ? 'Line replaced' : (bisections>0 ? `Line added (+${bisections} bisect vertex${bisections>1?'es':''})` : 'Line added'));
      }
      return;
    }

    if(tool==='circle'){
      if(!pendingPt){
        setPendingPt(wp);
        setPendingWasSnap(!!snap);
        setMessage('Pick radius point');
      } else {
        const c0 = pendingPt;
        const r = Math.hypot(wp.x - c0.x, wp.y - c0.y);
        if(r < 1e-6){ setMessage('Radius too small'); setPendingPt(null); return; }
        pushHistory();
        const newId = uuid();
        setCircles(prev=>[...prev, { id: newId, c: c0, r }]);

        // Centre
        if (pendingWasSnap) addRefsIfUserPoint(c0, newId);
        else addDerivedPoints([c0], newId);

        // Radius point
        const secondSnapIdx = findUserPointIndexNear(wp);
        if (secondSnapIdx >= 0) addRefsIfUserPoint(wp, newId);
        else addDerivedPoints([wp], newId);

        // Circumferential bisections
        if(bisections > 0){
          const theta0 = Math.atan2(wp.y - c0.y, wp.x - c0.x);
          const pts: Pt[] = [];
          for(let k=1; k<=bisections; k++){
            const th = theta0 + (2*Math.PI*k)/(bisections+1);
            pts.push({ x: c0.x + r*Math.cos(th), y: c0.y + r*Math.sin(th) });
          }
          addDerivedPoints(pts, newId);
        }

        setPendingPt(null);
        setPendingWasSnap(false);
        setMessage(bisections>0 ? `Circle added (+${bisections} circumferential vertex${bisections>1?'es':''})` : 'Circle added');
      }
      return;
    }

    if(tool==='fill'){
      const worldPt = screenToWorld(sp);

      // recolour existing fill if clicked inside
      for(let i=paths.length-1;i>=0;i--){
        const poly = pathToPolyline(paths[i]);
        if(pointInPolyline(worldPt, poly)){
          pushHistory();
          setPaths(prev=>{
            const next = prev.slice();
            next[i] = { ...next[i], color: fillColor };
            return next;
          });
          setMessage('Fill recoloured');
          return;
        }
      }

      // otherwise create a new fill
      const A = buildArrangement(
        lines.map(l=>({ p1:l.p1, p2:l.p2 })),
        circles.map(c=>({ c:c.c, r:c.r })),
        vertices
      );
      const loops = traceFaces(A);
      if(!loops.length){ setMessage('No enclosed regions found'); return; }

      const candidates = loops.map(loop => {
        const path = loopToPath(A, loop);
        const poly = pathToPolyline(path);
        return { path, poly, area: Math.abs(polylineArea(poly)) };
      }).filter(obj => pointInPolyline(worldPt, obj.poly) && obj.area > 1e-10);

      if(!candidates.length){ setMessage('Region not enclosed'); return; }
      candidates.sort((a,b)=>a.area - b.area);

      pushHistory();
      const chosen: RegionPath = { ...candidates[0].path, color: fillColor };
      setPaths(prev=>[...prev, chosen]);
      setMessage('Region filled');
      return;
    }

    if(tool==='delete'){
      const wp = screenToWorld(sp);

      // 1) Delete a user point if clicked close to it
      const tolWorld = POINT_HIT_PX/scale;
      const ptIdx = userPoints.findIndex(u => dist2(u.p, wp) <= tolWorld*tolWorld);
      if (ptIdx >= 0) {
        pushHistory();
        setUserPoints(prev => prev.filter((_,i)=>i!==ptIdx));
        setMessage('Point deleted');
        return;
      }

      // 2) Delete fills
      for(let i=paths.length-1;i>=0;i--){
        const poly = pathToPolyline(paths[i]);
        if(pointInPolyline(wp, poly)){
          pushHistory();
          setPaths(prev => prev.filter((_,j)=>j!==i));
          setMessage('Fill deleted');
          return;
        }
      }

      // 3) Delete circles (and prune derived points that referenced them)
      for(let i=circles.length-1;i>=0;i--){
        const cs = worldToScreen(circles[i].c);
        const d = pointToCircleRingPx({ x:e.clientX-rect.left, y:e.clientY-rect.top }, cs, circles[i].r*scale);
        if(d <= HIT_PX){
          const removedId = circles[i].id;
          pushHistory();
          setCircles(prev=> prev.filter((_,j)=>j!==i));
          pruneRefsFor(removedId);
          setMessage('Circle deleted');
          return;
        }
      }

      // 4) Delete lines (and prune derived points that referenced them)
      for(let i=lines.length-1;i>=0;i--){
        const p1s = worldToScreen(lines[i].p1);
        const p2s = worldToScreen(lines[i].p2);
        const d = pointToLineDistPx({ x:e.clientX-rect.left, y:e.clientY-rect.top }, p1s, p2s);
        if(d <= HIT_PX){
          const removedId = lines[i].id;
          pushHistory();
          setLines(prev=> prev.filter((_,j)=>j!==i));
          pruneRefsFor(removedId);
          setMessage('Line deleted');
          return;
        }
      }

      setMessage('Nothing to delete here');
    }
  };

  // Wheel zoom at cursor, with passive:false so preventDefault works
  useEffect(()=>{
    const el = ref.current;
    if(!el) return;

    const handle = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const sp = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      const oldScale = scaleRef.current;
      const oldOffset = offsetRef.current;
      const worldUnderCursor = {
        x: sp.x / oldScale + oldOffset.x,
        y: sp.y / oldScale + oldOffset.y
      };

      const factor = e.ctrlKey || e.metaKey ? 1.05 : 1.1;
      const newScale = Math.max(0.1, Math.min(10, e.deltaY < 0 ? oldScale*factor : oldScale/factor ));

      const newOffset = {
        x: worldUnderCursor.x - sp.x / newScale,
        y: worldUnderCursor.y - sp.y / newScale
      };

      setScale(newScale);
      setOffset(newOffset);
    };

    el.addEventListener('wheel', handle, { passive: false });
    return ()=> el.removeEventListener('wheel', handle);
  }, []);

  // export / clear / undo
  useEffect(()=>{
    const onExport = ()=>{
      if(paths.length===0){ setMessage('Nothing to export'); return; }

      const allPts = paths.flatMap(ph => pathToPolyline(ph));
      const xs = allPts.map(p=>p.x), ys = allPts.map(p=>p.y);
      const minx = Math.min(...xs), miny = Math.min(...ys);
      const maxx = Math.max(...xs), maxy = Math.max(...ys);
      const width = Math.max(1, maxx-minx), height = Math.max(1, maxy-miny);

      const esc = (s:string)=>s.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
      let body = '';
      for(const ph of paths){
        const color = ph.color || '#36a2ff';
        let d = `M ${ph.start.x.toFixed(2)} ${ph.start.y.toFixed(2)} `;
        for(const s of ph.segs){
          if(s.kind==='L'){
            d += `L ${s.to.x.toFixed(2)} ${s.to.y.toFixed(2)} `;
          } else {
            d += `A ${s.r.toFixed(4)} ${s.r.toFixed(4)} 0 ${s.largeArc} ${s.sweep} ${s.to.x.toFixed(2)} ${s.to.y.toFixed(2)} `;
          }
        }
        d += 'Z';
        body += `<path d="${esc(d)}" fill="${esc(color)}" />\n`;
      }

      const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(2)}" height="${height.toFixed(2)}" viewBox="${minx.toFixed(2)} ${miny.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)}">
${body}</svg>`;
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'filled-regions.svg';
      a.click();
      URL.revokeObjectURL(url);
    };

    const onClear = ()=>{
      if(lines.length||circles.length||paths.length||userPoints.length) pushHistory();
      setLines([]); setCircles([]); setPaths([]); setIntersections([]); setVertices([]); setUserPoints([]);
      setPendingPt(null); setPendingWasSnap(false);
      setMessage('Cleared');
    };

    const onUndo = ()=> undo();

    document.addEventListener('EXPORT_SVG', onExport as any);
    document.addEventListener('CLEAR_ALL', onClear as any);
    document.addEventListener('UNDO', onUndo as any);
    return ()=>{
      document.removeEventListener('EXPORT_SVG', onExport as any);
      document.removeEventListener('CLEAR_ALL', onClear as any);
      document.removeEventListener('UNDO', onUndo as any);
    };
  }, [paths, lines, circles, userPoints]);

  return (
    <div className="canvas-wrap">
      <canvas
        ref={ref}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={(e)=> e.preventDefault()}
        style={{ display:'block', width:'100%', height:'70vh', touchAction:'none', overscrollBehavior:'contain' }}
      />
    </div>
  );
}
