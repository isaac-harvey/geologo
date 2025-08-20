export const metadata = {
  title: "Geometric Tools Canvas",
  description: "Straightedge & compass drawing with fill and SVG export",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0b0d10", color: "#e5e7eb", fontFamily: "ui-sans-serif, system-ui, -apple-system" }}>
        {children}
      </body>
    </html>
  );
}
