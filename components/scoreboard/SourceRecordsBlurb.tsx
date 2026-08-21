type SourceRecord = {
  date: string;
  label: string;
  description: string;
  link: string;
  clientName?: string | null;
  accountName?: string | null;
};

export function SourceRecordsBlurb({
  repName,
  records,
}: {
  repName: string;
  records: SourceRecord[];
}) {
  return (
    <div className="pointer-events-none absolute right-full top-1/2 z-10 -translate-y-1/2 pr-3 group-hover:pointer-events-auto">
      <div className="relative max-h-96 w-[28rem] overflow-y-auto rounded-md border border-slate-800 bg-slate-900 p-3 text-xs opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
        <div className="absolute -right-1 top-8 h-2 w-2 -translate-y-1/2 rotate-45 border-r border-t border-slate-800 bg-slate-900" />
        <p className="sticky top-0 mb-2 bg-slate-900 pb-1 font-medium text-slate-100">
          {repName} — {records.length} record{records.length === 1 ? "" : "s"}
        </p>
        {records.map((r, idx) => (
          <a
            key={idx}
            href={r.link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 border-t border-slate-800 py-1.5 first:border-t-0 hover:bg-slate-800"
          >
            <span className="shrink-0 text-slate-500">{r.date}</span>
            <span className="shrink-0 rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
              {r.label}
            </span>
            {r.clientName || r.accountName ? (
              <span className="truncate text-slate-300">
                {r.clientName ?? "(no client)"}
                <span className="text-slate-500"> — {r.accountName ?? "(no account)"}</span>
              </span>
            ) : (
              <span className="truncate text-slate-300">{r.description}</span>
            )}
          </a>
        ))}
        {records.length === 0 && (
          <p className="py-2 text-slate-500">No records in this period.</p>
        )}
      </div>
    </div>
  );
}
