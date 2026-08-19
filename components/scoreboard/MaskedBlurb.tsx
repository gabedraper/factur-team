// Stand-in for a hover blurb when the underlying data isn't visible to this
// viewer. Renders placeholder bars only -- no real record data is ever passed
// in or rendered, so there's nothing to leak via dev tools or view-source.
export function MaskedBlurb({ side = "left" }: { side?: "left" | "right" }) {
  const isLeft = side === "left";
  return (
    <div
      className={`pointer-events-none absolute top-1/2 z-10 -translate-y-1/2 ${
        isLeft ? "right-full pr-3" : "left-full pl-3"
      }`}
    >
      <div className="relative w-80 rounded-md border border-neutral-800 bg-neutral-900 p-3 text-xs opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
        <div
          className={`absolute top-8 h-2 w-2 -translate-y-1/2 rotate-45 border-neutral-800 bg-neutral-900 ${
            isLeft ? "-right-1 border-r border-t" : "-left-1 border-b border-l"
          }`}
        />
        <p className="mb-2 h-3.5 w-32 rounded bg-neutral-700/80" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-2 border-t border-neutral-800 py-1.5 first:border-t-0"
          >
            <span className="h-3 w-12 shrink-0 rounded bg-neutral-800" />
            <span className="h-3 w-14 shrink-0 rounded-full bg-neutral-800" />
            <span className="h-3 flex-1 rounded bg-neutral-800" />
          </div>
        ))}
        <p className="mt-2 text-center text-[11px] text-neutral-600">
          Hidden during data verification
        </p>
      </div>
    </div>
  );
}
