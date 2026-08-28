/**
 * The connected-dot supergraphic from the brand guidelines.
 *
 * Reconstructed from the artwork on the supergraphics slide, and the shape of
 * it is the point. It is not an even field of dots -- it is a band that climbs
 * from the bottom left to the top right, dense along its crest and fanning out
 * loosely underneath, running off the edges rather than sitting inside them.
 * That rise is the same idea as the chevron in the logo, so a flat scatter
 * reads as texture where this reads as the brand.
 *
 * Points are joined to their nearest neighbours rather than to everything
 * within a radius, which is what gives the artwork its triangulated web
 * instead of a lattice.
 */

type Point = { x: number; y: number; r: number };

/*
 * Fixed layout, deliberately not random.
 *
 * A mesh generated at render would differ between the server's HTML and the
 * browser's first paint, and React calls that a hydration mismatch and throws
 * the markup away. A seeded sequence gives the same scatter every time, on
 * both sides.
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

const WIDTH = 1000;
const HEIGHT = 560;

/** Normal-ish spread, so density falls away from the crest rather than stopping. */
function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/*
 * The crest.
 *
 * Climbs steeply out of the bottom-left corner and eases as it goes, which is
 * the curve in the artwork -- most of the height is gained in the first third.
 */
function crestY(t: number): number {
  return HEIGHT * (0.97 - 0.74 * Math.pow(t, 0.55));
}

function scatter(seed: number, count: number): Point[] {
  const random = mulberry32(seed);
  const points: Point[] = [];

  for (let i = 0; i < count; i += 1) {
    // Biased right: the artwork thins out towards the bottom-left corner.
    const t = Math.pow(random(), 0.75);

    // The band opens as it travels, narrow at the corner and wide at the end.
    const spread = HEIGHT * (0.02 + 0.26 * t);

    /*
     * Mostly below the crest. In the artwork the mesh hangs underneath the
     * ridge line and only a few points sit above it, which is what stops it
     * reading as a symmetrical tube.
     */
    const below = random() < 0.72;
    /*
     * Raised to a power to bunch points against the crest. A plain normal
     * spread gives an even haze; the artwork has a hard bright ridge with the
     * mesh thinning away from it, and that concentration is most of what makes
     * it read as a path rather than a cloud.
     */
    const fall = Math.pow(Math.abs(gaussian(random)), 1.5);
    const offset = fall * spread * (below ? 1 : -0.42);

    /*
     * Rounded, and not for tidiness.
     *
     * These coordinates are computed twice -- once into the server's HTML and
     * once in the browser -- and a float renders as "248.8701493780475" on one
     * side and 248.87014937804753 on the other. React reads that as a
     * hydration mismatch and discards the markup. Whole numbers cannot
     * disagree, and at this scale nothing is lost by it.
     */
    const x = Math.round(t * WIDTH * 1.04 - WIDTH * 0.02);
    const y = Math.round(crestY(t) + offset);

    if (y < -HEIGHT * 0.1 || y > HEIGHT * 1.1) continue;

    // A handful of heavier dots, as in the original.
    const roll = random();
    points.push({ x, y, r: roll > 0.95 ? 2.8 : roll > 0.78 ? 1.7 : 1.0 });
  }

  return points;
}

/**
 * Each point to its nearest few.
 *
 * A radius test joins everything in a crowd and nothing in a sparse patch,
 * which leaves solid blocks next to bare ground. Nearest-neighbour keeps the
 * web even in feel while the density changes underneath it.
 */
function edges(points: Point[], neighbours: number): [Point, Point][] {
  const seen = new Set<string>();
  const out: [Point, Point][] = [];

  points.forEach((p, i) => {
    const near = points
      .map((q, j) => ({ j, d: Math.hypot(p.x - q.x, p.y - q.y) }))
      .filter((n) => n.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, neighbours);

    for (const n of near) {
      const key = i < n.j ? `${i}-${n.j}` : `${n.j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([p, points[n.j]]);
    }
  });

  return out;
}

export function BrandMesh({
  className,
  seed = 11,
  count = 520,
  neighbours = 3,
  tone = "brand",
  flip = false,
}: {
  className?: string;
  seed?: number;
  count?: number;
  neighbours?: number;
  /** Orange is the artwork; muted is the pale version used behind content. */
  tone?: "brand" | "primary" | "muted";
  /** Mirror it, for when the rise should run the other way. */
  flip?: boolean;
}) {
  const points = scatter(seed, count);
  const lines = edges(points, neighbours);

  const colour =
    tone === "brand"
      ? "hsl(var(--brand))"
      : tone === "primary"
        ? "hsl(var(--primary))"
        : "hsl(var(--muted-foreground))";

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      // Anchored to the bottom-left, where the band starts. Centring it
      // crops away the dense corner that gives the graphic its shape.
      preserveAspectRatio="xMinYMax slice"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={flip ? { transform: "scaleX(-1)" } : undefined}
    >
      {/* Lines first, so a dot always sits on top of what connects it. */}
      <g stroke={colour} strokeWidth={0.5} opacity={0.5}>
        {lines.map(([a, b], i) => (
          <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        ))}
      </g>
      <g fill={colour}>
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={p.r} />
        ))}
      </g>
    </svg>
  );
}
