"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveClientTerms, saveKpiTarget, type Agreement, type Terms, type Kpi,
} from "@/actions/client-agreement";
import { FIELD } from "@/lib/field-class";
import { FileText, Pencil } from "lucide-react";

const money = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});

function onDay(date: string | null) {
  if (!date) return "—";
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    day: "numeric", month: "short", year: "numeric",
  });
}

/** Empty means "the contract does not say", which is not the same as nought. */
function show(v: string | number | boolean | null | undefined, as?: "money" | "date") {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (as === "money") return money.format(Number(v));
  if (as === "date") return onDay(String(v));
  return String(v);
}

const FIELDS: { key: keyof Terms; label: string; as?: "money" | "date"; type?: string }[] = [
  { key: "service", label: "Service" },
  { key: "billing_amount", label: "Billing amount", as: "money", type: "number" },
  { key: "billing_frequency", label: "Billing frequency" },
  { key: "setup_fee", label: "Setup fee", as: "money", type: "number" },
  { key: "payment_terms", label: "Payment terms" },
  { key: "term_months", label: "Term (months)", type: "number" },
  { key: "term_start", label: "Term start", as: "date", type: "date" },
  { key: "term_end", label: "Term end", as: "date", type: "date" },
  { key: "notice_days", label: "Notice (days)", type: "number" },
  { key: "billing_contact_name", label: "Billing contact" },
  { key: "billing_contact_email", label: "Billing email" },
];

/**
 * What we agreed, and whether we are doing it.
 *
 * The terms are a reading of the contract and the KPI targets are what we
 * promised; both can be wrong and both are editable. The results beside them
 * are not -- they are counted from Salesforce and there is nothing here to
 * correct.
 */
export function AgreementPanel({
  clientId, agreement,
}: {
  clientId: string;
  agreement: Agreement | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Terms>>(agreement?.terms ?? {});
  const [targets, setTargets] = useState<Record<string, string>>(
    Object.fromEntries(
      (agreement?.kpis ?? []).map((k) => [k.metric, k.target === null ? "" : String(k.target)])
    )
  );
  const [problem, setProblem] = useState("");
  const [pending, startTransition] = useTransition();

  const terms = agreement?.terms ?? null;
  const kpis = agreement?.kpis ?? [];

  function saveTerms() {
    setProblem("");
    startTransition(async () => {
      const res = await saveClientTerms(clientId, draft);
      if (!res.success) {
        setProblem(res.error ?? "Couldn't save that.");
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function saveTarget(metric: string, raw: string) {
    const value = raw.trim() === "" ? null : Number(raw);
    if (value !== null && Number.isNaN(value)) return;
    setProblem("");
    startTransition(async () => {
      const res = await saveKpiTarget(clientId, metric, value);
      if (!res.success) {
        setProblem(res.error ?? "Couldn't save that.");
        return;
      }
      router.refresh();
    });
  }

  /** Green when they are at or above what was promised; red when short. */
  function tone(k: Kpi) {
    if (k.target === null || k.actual === null) return "";
    return k.actual >= k.target
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-red-600 dark:text-red-400";
  }

  return (
    <div className="space-y-2">
      {problem && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {problem}
        </p>
      )}

      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Agreement
          </span>
          <span className="flex items-center gap-3 text-xs">
            {agreement?.agreement_file_url && (
              <a
                href={agreement.agreement_file_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 underline"
              >
                <FileText className="h-3.5 w-3.5" />
                {agreement.agreement_name ?? "Signed agreement"}
                {agreement.agreement_signed_on && (
                  <> · {onDay(agreement.agreement_signed_on)}</>
                )}
              </a>
            )}
            {!editing && (
              <button
                onClick={() => { setDraft(terms ?? {}); setEditing(true); }}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
            )}
          </span>
        </div>

        {editing ? (
          <div className="space-y-2 px-3 py-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <label key={String(f.key)} className="text-xs">
                  <span className="text-muted-foreground">{f.label}</span>
                  <input
                    type={f.type ?? "text"}
                    value={(draft[f.key] as string | number | null) ?? ""}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        [f.key]:
                          e.target.value === ""
                            ? null
                            : f.type === "number"
                              ? Number(e.target.value)
                              : e.target.value,
                      }))
                    }
                    className={`${FIELD} mt-0.5 w-full px-2 py-1 text-sm`}
                  />
                </label>
              ))}
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={Boolean(draft.auto_renew)}
                  onChange={(e) => setDraft((d) => ({ ...d, auto_renew: e.target.checked }))}
                />
                Auto renew
              </label>
            </div>

            {(["opt_outs", "other_terms"] as const).map((k) => (
              <label key={k} className="block text-xs">
                <span className="text-muted-foreground">
                  {k === "opt_outs" ? "Opt outs" : "Other terms"}
                </span>
                <textarea
                  rows={2}
                  value={(draft[k] as string | null) ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [k]: e.target.value === "" ? null : e.target.value }))
                  }
                  className={`${FIELD} mt-0.5 w-full px-2 py-1 text-sm`}
                />
              </label>
            ))}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditing(false)}
                className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={saveTerms}
                disabled={pending}
                className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-x-6 gap-y-1 px-3 py-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {FIELDS.map((f) => (
              <div key={String(f.key)} className="flex justify-between gap-2">
                <span className="text-xs text-muted-foreground">{f.label}</span>
                <span className="text-right">{show(terms?.[f.key] as never, f.as)}</span>
              </div>
            ))}
            <div className="flex justify-between gap-2">
              <span className="text-xs text-muted-foreground">Auto renew</span>
              <span className="text-right">{show(terms?.auto_renew)}</span>
            </div>
            {terms?.opt_outs && (
              <div className="sm:col-span-2 lg:col-span-3">
                <span className="text-xs text-muted-foreground">Opt outs</span>
                <div className="whitespace-pre-wrap">{terms.opt_outs}</div>
              </div>
            )}
            {terms?.other_terms && (
              <div className="sm:col-span-2 lg:col-span-3">
                <span className="text-xs text-muted-foreground">Other terms</span>
                <div className="whitespace-pre-wrap">{terms.other_terms}</div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-card">
        <div className="border-b px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
          KPIs per month
        </div>
        <div className="grid gap-x-6 gap-y-2 px-3 py-3 sm:grid-cols-2 lg:grid-cols-3">
          {kpis.map((k) => (
            <div key={k.metric} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-xs text-muted-foreground">{k.label}</span>
              <span className="flex items-center gap-2">
                <input
                  type="number"
                  defaultValue={targets[k.metric] ?? ""}
                  onBlur={(e) => {
                    if (e.target.value !== (targets[k.metric] ?? "")) {
                      setTargets((t) => ({ ...t, [k.metric]: e.target.value }));
                      saveTarget(k.metric, e.target.value);
                    }
                  }}
                  className={`${FIELD} w-16 px-1 py-0.5 text-right text-sm tabular-nums`}
                />
                <span className={`w-14 text-right tabular-nums ${tone(k)}`}>
                  {k.actual === null ? "—" : k.actual}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
