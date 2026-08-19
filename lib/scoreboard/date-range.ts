function formatIsoDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateRangeLabel(start: string, end: string) {
  return start === end
    ? formatIsoDate(start)
    : `${formatIsoDate(start)} – ${formatIsoDate(end)}`;
}
