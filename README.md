# Geometric Tools Canvas (Next.js)

Straightedge-and-compass style drawing with:

- Infinite line tool (two points)
- Circle tool (centre + radius point)
- Auto-intersection vertices (snap within ~10 px)
- Fill tool for enclosed regions (supports arcs; vectorised to polygon)
- Delete tool (fills, circles, lines)
- Zoom (wheel) & Pan (Pan tool)
- Export SVG of filled regions only

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Notes

- Fills are extracted by flood-filling an offscreen canvas then vectorising the mask to a polygon (arcs become short segments). 
- The offscreen boundary stroke is slightly thickened to "seal" tiny gaps so fills don't leak.
- Exported SVG contains only the filled polygons with their chosen colours.
