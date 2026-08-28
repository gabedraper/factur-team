/**
 * The connected-dot supergraphic from the brand guidelines.
 *
 * The guide's own words: connected dots stand for the connections Factur makes
 * between clients and customers. So it is drawn as a network -- nodes with
 * lines between the ones near enough to be related -- rather than as a
 * decorative scatter.
 *
 * Two rules keep it from becoming noise in a tool people work in all day. It
 * belongs on chrome (a sign-in page, a page header, an empty state) and never
 * behind figures, where a texture under a column of numbers is just a harder
 * column of numbers. And it is drawn faintly enough to be felt rather than
 * read.
 */

type Point = { x: number; y: number };

/*
 * Fixed layout, deliberately not random.
 *
 * A mesh generated at render would differ between the server's HTML and the
 * browser's first paint, and React calls that a hydration mismatch and throws
 * the markup away. A seeded sequence gives the same organic-looking scatter
 * every time, on both sides.
 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WIDTH = 400;
const HEIGHT = 220;

/*
 * A jittered grid rather than free scatter. Pure randomness clumps -- it
 * leaves bald patches and knots, and the eye reads both as mistakes. Nudging
 * a grid keeps the spacing even while losing the obvious rows.
 */
function layout(seed: number, columns: number, rows: number): Point[] {
  const random = mulberry32(seed);
  const points: Point[] = [];
  const cellW = WIDTH / columns;
  const cellH = HEIGHT / rows;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      points.push({
        x: Math.round((col + 0.2 + random() * 0.6) * cellW),
        y: Math.round((row + 0.2 + random() * 0.6) * cellH),
      });
    }
  }
  return points;
}

/** Only near neighbours are joined, so the result reads as a web, not a mesh of everything. */
function edges(points: Point[], reach: number): [Point, Point][] {
  const out: [Point, Point][] = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      if (Math.hypot(dx, dy) <= reach) out.push([points[i], points[j]]);
    }
  }
  return out;
}

export function BrandMesh({
  className,
  seed = 7,
  columns = 9,
  rows = 5,
  tone = "primary",
}: {
  className?: string;
  seed?: number;
  columns?: number;
  rows?: number;
  /** Blue is the resting state; orange is for a moment worth marking. */
  tone?: "primary" | "brand";
}) {
  const points = layout(seed, columns, rows);
  const reach = Math.max(WIDTH / columns, HEIGHT / rows) * 1.35;
  const lines = edges(points, reach);
  const stroke = tone === "brand" ? "hsl(var(--brand))" : "hsl(var(--primary))";

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {/* Lines first, so a node always sits on top of what connects it. */}
      <g stroke={stroke} strokeWidth={0.5} opacity={0.35}>
        {lines.map(([a, b], i) => (
          <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        ))}
      </g>
      <g fill={stroke}>
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={i % 5 === 0 ? 2.4 : 1.4} />
        ))}
      </g>
    </svg>
  );
}
