export const metadata = {
  title: "GeoLogo",
  description: "Tools for creating Euclidean geometric constructions to export to SVG. Ideal for geometric logos.",
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
