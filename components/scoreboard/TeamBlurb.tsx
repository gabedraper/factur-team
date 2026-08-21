export function TeamBlurb({
  repName,
  team,
}: {
  repName: string;
  team: { display_name: string; detail: string }[];
}) {
  return (
    <div className="pointer-events-none absolute right-full top-1/2 z-10 -translate-y-1/2 pr-3 group-hover:pointer-events-auto">
      <div className="relative max-h-96 w-72 overflow-y-auto rounded-md border border-border bg-popover p-3 text-xs opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
        <div className="absolute -right-1 top-8 h-2 w-2 -translate-y-1/2 rotate-45 border-r border-t border-border bg-popover" />
        <p className="sticky top-0 mb-2 bg-popover pb-1 font-medium text-popover-foreground">
          {repName} — {team.length} team member{team.length === 1 ? "" : "s"}
        </p>
        {team.map((t, idx) => (
          <div
            key={idx}
            className="flex items-center justify-between gap-2 border-t border-border py-1.5 first:border-t-0"
          >
            <span className="truncate text-slate-300">{t.display_name}</span>
            <span className="shrink-0 text-slate-500">{t.detail}</span>
          </div>
        ))}
        {team.length === 0 && (
          <p className="py-2 text-slate-500">No active team members.</p>
        )}
      </div>
    </div>
  );
}
