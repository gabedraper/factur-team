export function ReportSpec({
  title,
  reportType,
  filters,
  grouping,
  sorting,
}: {
  title?: string;
  reportType: string;
  filters: string[];
  grouping: string;
  sorting: string;
}) {
  return (
    <div className="mb-4 last:mb-0">
      {title && <p className="mb-1.5 font-medium text-neutral-400">{title}</p>}
      <p>
        <span className="text-neutral-500">Report Type: </span>
        {reportType}
      </p>
      <p className="text-neutral-500">Filters:</p>
      <ul className="ml-4 list-disc space-y-0.5">
        {filters.map((f, i) => (
          <li key={i}>{f}</li>
        ))}
      </ul>
      <p className="mt-1">
        <span className="text-neutral-500">Grouping: </span>
        {grouping}
      </p>
      <p>
        <span className="text-neutral-500">Sorting: </span>
        {sorting}
      </p>
    </div>
  );
}
