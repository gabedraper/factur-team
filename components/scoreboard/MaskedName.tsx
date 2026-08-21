// Renders in place of a name that shouldn't be visible to this viewer. No real
// text is ever included -- this is a placeholder, not a CSS blur over real data.
export function MaskedName() {
  return <span aria-hidden className="inline-block h-4 w-28 rounded bg-slate-700/80" />;
}
