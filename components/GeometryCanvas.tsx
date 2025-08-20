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

type Tool = 'line' | 'circle' | 'fill' | 'delete' | 'pan';
type Pt = { x:number, y:number };
type Line = { id:string, p1:Pt, p2:Pt };
type Circle = { id:string, c:Pt, r:number };

function uuid(){ return Math.random().toString(36).slice(2,10); }

const SNAP_PX = 10;
const HIT_PX = 8;

type Snapshot = {
  lines: Line[];
  circles: Circle[];
  paths: RegionPath[];
  userPoints: Pt[];
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
  const [offset, setOffset] = useState<Pt>({ x: -400, y: -300 }); // world coords of top-left

  const [lines, setLines] = useState<Line[]>([]);
  const [circles, setCircles] = useState<Circle[]>([]);
  const [paths, setPaths] = useState<RegionPath[]>([]);      // analytic fills

  const [vertices, setVertices] = useState<Pt[]>([]);
  const [userPoints, setUserPoints] = useState<Pt[]>([]);    // retained arbitrary points
  const [pendingPt, setPendingPt] = useState<Pt|null>(null);
  const [pendingWasSnap, setPendingWasSnap] = useState<boolean>(false);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef<{x:number,y:number, o:Pt}|null>(null);

  const history = useRef<Snapshot[]>([]);

  const screenToWorld = (p:Pt):Pt => ({ x: p.x/scale + offset.x, y: p.y/scale + offset.y });
  const worldToScreen = (p:Pt):Pt => ({ x: (p.x - offset.x)*scale, y: (p.y - offset.y)*scale });

  const pushHistory = () => {
    history.current.push({
      lines: lines.map(l=>({ id:l.id, p1:{...l.p1}, p2:{...l.p2} })),
      circles: circles.map(c=>({ id:c.id, c:{...c.c}, r:c.r })),
      paths: paths.map(ph=>({ start:{...ph.start}, segs: ph.segs.map(s => s.kind==='L'
        ? { kind:'L', to:{...s.to} }
        : { kind:'A', to:{...s.to}, r:s.r, largeArc:s.largeArc, sweep:s.sweep, c:{...s.c} }
      )})),
      userPoints: userPoints.map(p=>({...p}))
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

  const addUserPoints = (pts: Pt[]) => {
    if(pts.length===0) return;
    setUserPoints(prev => {
      const out = [...prev];
      const eps2 = 1e-10;
      for(const p of pts){
        if(!out.some(q=>dist2(p,q) < eps2)) out.push(p);
      }
      return out;
    });
  };

  // Seed a visible 1-unit vertical with two retained vertices on mount
  useEffect(() => {
    const c = ref.current;
    if (!c) return;

    const DPR = window.devicePixelRatio || 1;
    const scrW = c.width / DPR;
    const scrH = c.height / DPR;

    // World coords of the current screen centre
    // const xCenterWorld = offset.x + (scrW / scale) * 0.5;
    const xCenterWorld = 500;
    const yCenterWorld = offset.y + (scrH / scale) * 0.5;

    // Two vertices exactly 1 unit apart vertically (±0.5 around centre)
    const pA = { x: xCenterWorld, y: yCenterWorld - 0.5 };
    const pB = { x: xCenterWorld, y: yCenterWorld + 0.5 };

    // Add the infinite vertical line (defined by pA–pB; math treats it as infinite)
    setLines(prev => [...prev, { id: 'seed-vertical', p1: pA, p2: pB }]);

    // Keep these two points as persistent vertices (for snapping & visibility)
    setUserPoints(prev => [...prev, pA, pB]);
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

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

  // recompute vertices (intersections + retained arbitrary points)
  useEffect(()=>{
    const vs: Pt[] = [];
    // line-line
    for(let i=0;i<lines.length;i++){
      for(let j=i+1;j<lines.length;j++){
        const p = lineLine(lines[i].p1, lines[i].p2, lines[j].p1, lines[j].p2);
        if(p) vs.push(p);
      }
    }
    // line-circle
    for(const L of lines){
      for(const C of circles){
        const ps = lineCircle(L.p1, L.p2, C.c, C.r);
        for(const p of ps) vs.push(p);
      }
    }
    // circle-circle
    for(let i=0;i<circles.length;i++){
      for(let j=i+1;j<circles.length;j++){
        const ps = circleCircle(circles[i].c, circles[i].r, circles[j].c, circles[j].r);
        for(const p of ps) vs.push(p);
      }
    }
    // include retained arbitrary points
    for(const p of userPoints) vs.push(p);

    // dedupe
    const eps2 = 1e-8;
    const uniq: Pt[] = [];
    for(const p of vs){
      if(!uniq.some(q=>dist2(p,q) < eps2)) uniq.push(p);
    }
    setVertices(uniq);
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

    // draw analytic paths (approx to polyline for canvas fill)
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
      ctx.fillStyle = (path as any).color || '#36a2ff';
      ctx.globalAlpha = 0.55;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // primitives
    for(const L of lines) drawLineInf(L);
    for(const Ci of circles) drawCircle(Ci);

    // vertices
    for(const v of vertices){
      const s = worldToScreen(v);
      ctx.beginPath();
      ctx.fillStyle = '#4fc3f7';
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
  }, [lines, circles, paths, vertices, offset, scale, pendingPt]);

  // snapping
  const pickVertex = (sp:Pt):Pt|null => {
    let best:Pt|null = null, bestd = SNAP_PX*SNAP_PX;
    for(const v of vertices){
      const sv = worldToScreen(v);
      const d2 = (sv.x-sp.x)**2 + (sv.y-sp.y)**2;
      if(d2 < bestd){ bestd = d2; best = v; }
    }
    return best;
  };

  const onPointerDown = (e:React.PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget;
    const rect = c.getBoundingClientRect();
    const sp = { x: e.clientX-rect.left, y: e.clientY-rect.top };
    const snap = pickVertex(sp);
    const wp = snap ?? screenToWorld(sp);

    if(tool==='pan'){
      setIsPanning(true);
      (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
      return;
    }

    if(tool==='line'){
      if(!pendingPt){
        setPendingPt(wp);
        setPendingWasSnap(!!snap);
        setMessage('Pick second point for line');
      } else {
        pushHistory();
        const p1 = pendingPt, p2 = wp;
        setLines(prev=>[...prev, { id: uuid(), p1, p2 }]);

        const newPts: Pt[] = [];
        if(!pendingWasSnap) newPts.push(p1);
        if(!snap) newPts.push(p2);
        if(bisections > 0){
          for(let k=1; k<=bisections; k++){
            const t = k / (bisections + 1);
            newPts.push({ x: p1.x + (p2.x - p1.x)*t, y: p1.y + (p2.y - p1.y)*t });
          }
        }
        addUserPoints(newPts);

        setPendingPt(null);
        setPendingWasSnap(false);
        setMessage(bisections>0 ? `Line added (+${bisections} bisect vertex${bisections>1?'es':''})` : 'Line added');
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
        setCircles(prev=>[...prev, { id: uuid(), c: c0, r }]);

        const newPts: Pt[] = [];
        if(!pendingWasSnap) newPts.push(c0);
        if(!snap) newPts.push(wp);
        const theta0 = Math.atan2(wp.y - c0.y, wp.x - c0.x);
        if(bisections > 0){
          for(let k=1; k<=bisections; k++){
            const th = theta0 + (2*Math.PI*k)/(bisections+1);
            newPts.push({ x: c0.x + r*Math.cos(th), y: c0.y + r*Math.sin(th) });
          }
        }
        addUserPoints(newPts);

        setPendingPt(null);
        setPendingWasSnap(false);
        setMessage(bisections>0 ? `Circle added (+${bisections} circumferential vertex${bisections>1?'es':''})` : 'Circle added');
      }
      return;
    }

    if(tool==='fill'){
      const A = buildArrangement(
        lines.map(l=>({ p1:l.p1, p2:l.p2 })),
        circles.map(c=>({ c:c.c, r:c.r })),
        vertices
      );
      const loops = traceFaces(A);
      if(!loops.length){ setMessage('No enclosed regions found'); return; }

      const worldPt = screenToWorld(sp);
      const candidates = loops.map(loop => {
        const path = loopToPath(A, loop);
        const poly = pathToPolyline(path); // world coords
        return { path, poly, area: Math.abs(polylineArea(poly)) };
      }).filter(obj => pointInPolyline(worldPt, obj.poly) && obj.area > 1e-10);

      if(!candidates.length){ setMessage('Region not enclosed'); return; }
      candidates.sort((a,b)=>a.area - b.area);
      pushHistory();
      const chosen = candidates[0].path as RegionPath;
      (chosen as any).color = fillColor;
      setPaths(prev=>[...prev, chosen]);
      setMessage('Region filled');
      return;
    }

    if(tool==='delete'){
      const wp = screenToWorld(sp);
      // filled paths (topmost last)
      for(let i=paths.length-1;i>=0;i--){
        const poly = pathToPolyline(paths[i]);
        if(pointInPolyline(wp, poly)){
          pushHistory();
          setPaths(prev => prev.filter((_,j)=>j!==i));
          setMessage('Fill deleted');
          return;
        }
      }
      // circles
      for(let i=circles.length-1;i>=0;i--){
        const cs = worldToScreen(circles[i].c);
        const d = pointToCircleRingPx(sp, cs, circles[i].r*scale);
        if(d <= HIT_PX){
          pushHistory();
          setCircles(prev=> prev.filter((_,j)=>j!==i));
          setMessage('Circle deleted');
          return;
        }
      }
      // lines
      for(let i=lines.length-1;i>=0;i--){
        const p1s = worldToScreen(lines[i].p1);
        const p2s = worldToScreen(lines[i].p2);
        const d = pointToLineDistPx(sp, p1s, p2s);
        if(d <= HIT_PX){
          pushHistory();
          setLines(prev=> prev.filter((_,j)=>j!==i));
          setMessage('Line deleted');
          return;
        }
      }
      setMessage('Nothing to delete here');
    }
  };

  const onPointerMove = (e:React.PointerEvent<HTMLCanvasElement>) => {
    if(!isPanning) return;
    const c = e.currentTarget;
    const rect = c.getBoundingClientRect();
    const sp = { x: e.clientX-rect.left, y: e.clientY-rect.top };
    if(panStart.current){
      const dx = (sp.x - panStart.current.x)/scale;
      const dy = (sp.y - panStart.current.y)/scale;
      setOffset({ x: panStart.current.o.x - dx, y: panStart.current.o.y - dy });
    }
  };

  const onPointerUp = () => {
    if(isPanning){ setIsPanning(false); panStart.current = null; }
  };

  const onWheel = (e:React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const c = e.currentTarget;
    const rect = c.getBoundingClientRect();
    const sp = { x: e.clientX-rect.left, y: e.clientY-rect.top };
    const before = screenToWorld(sp);
    const factor = e.ctrlKey || e.metaKey ? 1.05 : 1.1;
    const s = Math.max(0.1, Math.min(10, e.deltaY < 0 ? scale*factor : scale/factor ));
    setScale(s);
    const after = screenToWorld(sp);
    setOffset({ x: offset.x + (before.x - after.x), y: offset.y + (before.y - after.y) });
  };

  // export / clear / undo
  useEffect(()=>{
    const onExport = ()=>{
      if(paths.length===0){ setMessage('Nothing to export'); return; }

      // compute bbox from path polylines
      const allPts = paths.flatMap(ph => pathToPolyline(ph));
      const xs = allPts.map(p=>p.x), ys = allPts.map(p=>p.y);
      const minx = Math.min(...xs), miny = Math.min(...ys);
      const maxx = Math.max(...xs), maxy = Math.max(...ys);
      const width = Math.max(1, maxx-minx), height = Math.max(1, maxy-miny);

      const esc = (s:string)=>s.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
      let body = '';
      for(const ph of paths){
        const color = (ph as any).color || '#36a2ff';
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
      setLines([]); setCircles([]); setPaths([]); setVertices([]); setUserPoints([]);
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
        onPointerMove={(e)=>{
          if(isPanning){
            const rect = e.currentTarget.getBoundingClientRect();
            const sp = { x: e.clientX-rect.left, y: e.clientY-rect.top };
            if(!panStart.current){
              panStart.current = { x: sp.x, y: sp.y, o: { ...offset } };
            }
          }
          onPointerMove(e);
        }}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        style={{ display:'block', width:'100%', height:'70vh', touchAction:'none' }}
      />
    </div>
  );
}
