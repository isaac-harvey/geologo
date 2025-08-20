'use client';

import { useEffect, useState } from 'react';
import '@/styles/globals.css';
import GeometryCanvas from '@/components/GeometryCanvas';

type Tool = 'line' | 'circle' | 'fill' | 'delete' | 'pan';

export default function Page() {
  const [tool, setTool] = useState<Tool>('line');
  const [color, setColor] = useState<string>('#36a2ff');
  const [hex, setHex] = useState<string>('#36a2ff');
  const [message, setMessage] = useState<string>('Ready');
  const [bisections, setBisections] = useState<number>(0); // NEW

  useEffect(() => {
    if(/^#([0-9a-fA-F]{6})$/.test(hex)) setColor(hex);
  }, [hex]);

  return (
    <div style={{ padding: 16, display: 'grid', gap: 12 }}>
      <h1 style={{ margin: 0, fontWeight: 600, letterSpacing: 0.3 }}>Geometric Tools Canvas</h1>
      <div className="toolbar">
        <div className="group">
          <button className={tool==='line'?'active':''} onClick={()=>setTool('line')}>Line</button>
          <button className={tool==='circle'?'active':''} onClick={()=>setTool('circle')}>Circle</button>
          <button className={tool==='fill'?'active':''} onClick={()=>setTool('fill')}>Fill</button>
          <button className={tool==='delete'?'active':''} onClick={()=>setTool('delete')}>Delete</button>
          <button className={tool==='pan'?'active':''} onClick={()=>setTool('pan')}>Pan/Zoom</button>
        </div>

        {/* NEW: Bisections control */}
        <div className="group">
          <label style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span className="status">Bisections</span>
            <input
              aria-label="bisections"
              type="number"
              min={0}
              max={12}
              step={1}
              value={bisections}
              onChange={(e)=>setBisections(Math.max(0, Math.min(12, Number(e.target.value)||0)))}
              className="hex"
              style={{ width: 80 }}
            />
          </label>
        </div>

        <div className="group">
          <label style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span className="status">Fill colour</span>
            <input
              aria-label="color"
              type="color"
              value={color}
              onChange={e=>{ setColor(e.target.value); setHex(e.target.value); }}
              style={{ width: 36, height: 36, padding:0, border:'1px solid #1b2230', background:'#0b0f15', borderRadius: 8 }}
            />
            <input
              aria-label="hex"
              className="hex"
              value={hex}
              onChange={e=>setHex(e.target.value)}
              placeholder="#RRGGBB"
            />
          </label>
        </div>

        <div className="group">
          <button onClick={()=>document.dispatchEvent(new CustomEvent('EXPORT_SVG'))}>Export SVG</button>
          <button onClick={()=>document.dispatchEvent(new CustomEvent('UNDO'))}>Undo</button>
          <button onClick={()=>document.dispatchEvent(new CustomEvent('CLEAR_ALL'))}>Clear All</button>
        </div>

        <div className="status">{message}</div>
      </div>

      <GeometryCanvas
        tool={tool}
        setMessage={setMessage}
        fillColor={color}
        bisections={bisections}   // NEW
      />

      <p className="status">
        Tip: Zoom with wheel (hold Ctrl/⌘ for finer steps). With Pan tool selected, drag to move.
        Click near a cyan dot to snap to an existing vertex; otherwise a free point is used.
      </p>
    </div>
  );
}
