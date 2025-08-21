'use client';

import { useEffect, useRef, useState } from 'react';
import '@/styles/globals.css';
import GeometryCanvas from '@/components/GeometryCanvas';

type Tool = 'point' | 'line' | 'circle' | 'fill' | 'delete';

export default function Page() {
  const [tool, setTool] = useState<Tool>('line');
  const [color, setColor] = useState<string>('#36a2ff');
  const [hex, setHex] = useState<string>('#36a2ff');
  const [message, setMessage] = useState<string>('Ready');
  const [bisections, setBisections] = useState<number>(0);

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (/^#([0-9a-fA-F]{6})$/.test(hex)) setColor(hex);
  }, [hex]);

  const handleSave = () => {
    document.dispatchEvent(new CustomEvent('SAVE_JSON'));
  };

  const handleLoad = () => {
    fileRef.current?.click();
  };

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        document.dispatchEvent(new CustomEvent('LOAD_JSON', { detail: { data } }));
        setMessage(`Loaded ${f.name}`);
      } catch {
        setMessage('Invalid JSON file');
      }
    };
    reader.readAsText(f);
    // allow re-selecting the same file later
    e.target.value = '';
  };

  return (
    <div style={{ padding: 16, display: 'grid', gap: 12 }}>
      <h1 style={{ margin: 0, fontWeight: 600, letterSpacing: 0.3 }}>GeoLogo - Euclidean Construction Design Tools</h1>

      <div className="toolbar">
        <div className="group">
          <button className={tool === 'point' ? 'active' : ''} onClick={() => setTool('point')}>Point</button>
          <button className={tool === 'line' ? 'active' : ''} onClick={() => setTool('line')}>Line</button>
          <button className={tool === 'circle' ? 'active' : ''} onClick={() => setTool('circle')}>Circle</button>
          <button className={tool === 'fill' ? 'active' : ''} onClick={() => setTool('fill')}>Fill</button>
          <button className={tool === 'delete' ? 'active' : ''} onClick={() => setTool('delete')}>Delete</button>
        </div>

        <div className="group">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="status">Bisections</span>
            <input
              aria-label="bisections"
              type="number"
              min={0}
              max={12}
              step={1}
              value={bisections}
              onChange={(e) => setBisections(Math.max(0, Math.min(12, Number(e.target.value) || 0)))}
              className="hex"
              style={{ width: 80 }}
            />
          </label>
        </div>

        <div className="group">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="status">Fill colour</span>
            <input
              aria-label="color"
              type="color"
              value={color}
              onChange={e => { setColor(e.target.value); setHex(e.target.value); }}
              style={{ width: 36, height: 36, padding: 0, border: '1px solid #1b2230', background: '#0b0f15', borderRadius: 8 }}
            />
            <input
              aria-label="hex"
              className="hex"
              value={hex}
              onChange={e => setHex(e.target.value)}
              placeholder="#RRGGBB"
            />
          </label>
        </div>

        <div className="group">
          <button onClick={() => document.dispatchEvent(new CustomEvent('EXPORT_SVG'))}>Export SVG</button>
          <button onClick={handleSave}>Save</button>
          <button onClick={handleLoad}>Load</button>
          <button onClick={() => document.dispatchEvent(new CustomEvent('UNDO'))}>Undo</button>
          <button onClick={() => document.dispatchEvent(new CustomEvent('CLEAR_ALL'))}>Clear All</button>
        </div>

        <div className="status">{message}</div>
      </div>

      <GeometryCanvas
        tool={tool}
        setMessage={setMessage}
        fillColor={color}
        bisections={bisections}
      />

      {/* Hidden file input for JSON load */}
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <p className="status" style={{ margin: '4px 0' }}>
        Tip: Drag to pan. Scroll to zoom (hold Ctrl/⌘ for finer steps). 
      </p>
      <p className="status" style={{ margin: '4px 0' }}>
        <span style={{ color: 'magenta' }}>●</span> Fixed Point - Created with the Point tool, only removed if explicitly deleted.
      </p>
      <p className="status" style={{ margin: '4px 0' }}>
        <span style={{ color: 'orange' }}>●</span> Construction Point - Created with the Line/Circle tool, deleted if the corresponding line is deleted.
      </p>
      <p className="status" style={{ margin: '4px 0' }}>
        <span style={{ color: 'cyan' }}>●</span> Intersection Point - Created by intersection, deleted if the intersection is removed.
      </p>
    </div>
  );
}
