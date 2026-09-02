"use client";

import { useState, useTransition } from "react";
import {
  importAgreements, extractAgreementTerms,
  type AgreementCounts, type ImportReport, type ExtractReport,
} from "@/actions/pandadoc";
import { Download, BookOpen } from "lucide-react";

/**
 * Bringing the signed agreements in, a batch at a time.
 *
 * Each document needs its own call for the detail, so the whole archive cannot
 * be fetched inside one request. The button asks for the next batch and can be
 * pressed until it reports there is nothing left.
 */
export function AgreementImport({ counts }: { counts: AgreementCounts }) {
  const [runs, setRuns] = useState<ImportReport[]>([]);
  const [reads, setReads] = useState<ExtractReport[]>([]);
  const [pending, startTransition] = useTransition();

  const total = runs.reduce(
    (a, r) => ({
      imported: a.imported + r.imported,
      matched: a.matched + r.matched,
      unmatched: a.unmatched + r.unmatched,
      terms: a.terms + r.terms_filled,
    }),
    { imported: 0, matched: 0, unmatched: 0, terms: 0 }
  );
  const last = runs[runs.length - 1];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Imported", counts.imported + total.imported],
          ["Matched to a client", counts.matched + total.matched],
          ["Unmatched", counts.unmatched + total.unmatched],
          ["Terms from contract", counts.with_terms + total.terms],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border bg-card px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {label}
            </div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() =>
            startTransition(async () => {
              const r = await importAgreements(40);
              setRuns((x) => [...x, r]);
            })
          }
          disabled={pending || Boolean(last?.finished)}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          {pending ? "Importing…" : last?.finished ? "Nothing left to import" : "Import next 40"}
        </button>
        {last?.problem && (
          <span className="text-sm text-red-600 dark:text-red-400">{last.problem}</span>
        )}
      </div>

      {/*
        * Reading the PDFs is a separate pass: the merge fields answer for about
        * a third of the documents, and nothing carries the KPIs or the opt-outs
        * at all. Five at a time -- each one is a whole contract through a large
        * model.
        */}
      <div className="flex items-center gap-3">
        <button
          onClick={() =>
            startTransition(async () => {
              const r = await extractAgreementTerms(5);
              setReads((x) => [...x, r]);
            })
          }
          disabled={pending || Boolean(reads[reads.length - 1]?.finished)}
          className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
        >
          <BookOpen className="h-4 w-4" />
          {pending
            ? "Reading…"
            : reads[reads.length - 1]?.finished
              ? "Every document read"
              : "Read next 5 documents"}
        </button>
        {reads[reads.length - 1]?.problem && (
          <span className="text-sm text-red-600 dark:text-red-400">
            {reads[reads.length - 1]?.problem}
          </span>
        )}
      </div>

      {reads.length > 0 && (
        <div className="rounded-lg border bg-card text-sm">
          {reads.map((r, i) => (
            <div key={i} className="border-b px-3 py-2 last:border-0">
              <span className="tabular-nums">
                {r.read} read · {r.filled} with terms · {r.kpis_found} KPIs ·{" "}
                {r.skipped} skipped
              </span>
              {r.problems.slice(0, 3).map((p) => (
                <div key={p} className="text-xs text-amber-600 dark:text-amber-400">{p}</div>
              ))}
            </div>
          ))}
        </div>
      )}

      {runs.length > 0 && (
        <div className="rounded-lg border bg-card text-sm">
          {runs.map((r, i) => (
            <div key={i} className="border-b px-3 py-2 last:border-0">
              <span className="tabular-nums">
                {r.imported} imported · {r.matched} matched · {r.unmatched} unmatched ·{" "}
                {r.terms_filled} with terms
              </span>
              {Object.keys(r.by_match).length > 0 && (
                <span className="ml-2 text-xs text-muted-foreground">
                  by {Object.entries(r.by_match).map(([k, v]) => `${k} ${v}`).join(", ")}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
