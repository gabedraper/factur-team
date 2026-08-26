"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSort, SortHeader } from "@/components/ui/sortable";
import { band, type ClientHealth } from "@/lib/clients/health-score";

const BAND_CLASS: Record<string, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  critical: "text-red-600 dark:text-red-400",
  unknown: "text-muted-foreground",
};

/**
 * How the A/R score is arrived at, said once where the number is.
 *
 * It is the one score on this page nobody can reconstruct by looking at it: the
 * others are a count against last month, a survey answer, a ratio. This is a
 * weighting, and without the weights a 40 looks arbitrary.
 */
const AR_BLURB =
  "How current this client's balance is, scored 0 to 100.\n\n" +
  "100 = nothing overdue. 0 = the whole balance is more than 90 days late.\n\n" +
  "In between, each slice of the balance pulls the score down according to " +
  "how old it is: money 1–30 days late pulls it down a little, 31–60 more, " +
  "61–90 more again, and anything past 90 days pulls with full force.\n\n" +
  "Example: a client with half their balance current and half more than 90 " +
  "days late scores 50.\n\n" +
  "A dash means QuickBooks has no receivables record for them — not that they " +
  "owe nothing.";

/** The manual traffic light in Salesforce, as a rough 0-100 to compare against. */
const MANUAL_AS_SCORE: Record<string, number> = {
  Green: 85, Blue: 85, Yellow: 55, Red: 20, Black: 10,
};

function Score({ value }: { value: number | null }) {
  return (
    <span className={`font-semibold tabular-nums ${BAND_CLASS[band(value)]}`}>
      {value === null ? "—" : value}
    </span>
  );
}

export function HealthTable({ clients }: { clients: ClientHealth[] }) {
  const [filter, setFilter] = useState("");
  const [letter, setLetter] = useState("All");
  const [onlyDisagreements, setOnlyDisagreements] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  /*
   * Where the computed score and the hand-set traffic light disagree sharply.
   *
   * The most useful thing on this page: a client somebody marked Green whose
   * lead flow has quietly collapsed is exactly the one nobody is looking at.
   */
  const disagrees = (c: ClientHealth) => {
    const manual = c.manualHealth ? MANUAL_AS_SCORE[c.manualHealth] : undefined;
    if (manual === undefined || c.overall === null) return false;
    return Math.abs(manual - c.overall) >= 30;
  };

  /** First letter of a client's name; anything not A-Z lands under "#". */
  const initial = (name: string) => {
    const ch = name.trim().charAt(0).toUpperCase();
    return ch >= "A" && ch <= "Z" ? ch : "#";
  };

  // Only the letters that actually have clients behind them, so no dead keys.
  const letters = useMemo(() => {
    const present = new Set(clients.map((c) => initial(c.name)));
    const az = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").filter((l) => present.has(l));
    return present.has("#") ? [...az, "#"] : az;
  }, [clients]);

  const shown = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return clients.filter(
      (c) =>
        (!onlyDisagreements || disagrees(c)) &&
        (letter === "All" || initial(c.name) === letter) &&
        (!term ||
          c.name.toLowerCase().includes(term) ||
          (c.accountManager ?? "").toLowerCase().includes(term))
    )
      // Alphabetical to start with, so the list reads as a directory. Clicking
      // a column header re-sorts on top of this, and clicking it off comes back
      // here.
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, filter, letter, onlyDisagreements]);

  const at = (c: ClientHealth, key: string) =>
    c.inputs.find((i) => i.key === key)?.score ?? null;

  const { sorted, sortProps } = useSort(shown, {
    client: (c) => c.name,
    am: (c) => c.accountManager,
    lead: (c) => c.teamLead,
    overall: (c) => c.overall,
    lead_flow: (c) => at(c, "lead_flow"),
    activity: (c) => at(c, "activity"),
    nps: (c) => at(c, "nps"),
    engagement: (c) => at(c, "engagement"),
    receivables: (c) => at(c, "receivables"),
    measured: (c) => c.inputsMeasured,
    manual: (c) => c.manualHealth,
  });

  const disagreeCount = clients.filter(disagrees).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1">
        {["All", ...letters].map((l) => (
          <button
            key={l}
            onClick={() => setLetter(l)}
            aria-pressed={letter === l}
            className={`h-7 min-w-7 rounded-md border px-2 text-xs ${
              letter === l
                ? "border-transparent bg-primary text-primary-foreground"
                : "bg-card hover:bg-muted"
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="h-8 min-w-56 rounded-md border bg-field px-2 text-sm"
          placeholder="Search client or account manager…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={onlyDisagreements}
            onChange={(e) => setOnlyDisagreements(e.target.checked)}
          />
          Disagrees with Salesforce ({disagreeCount})
        </label>
        <span className="ml-auto text-xs text-muted-foreground">
          {shown.length} of {clients.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <SortHeader className="px-3 py-2" {...sortProps("client")}>Client</SortHeader>
              <SortHeader className="px-3 py-2" {...sortProps("am")}>Account manager</SortHeader>
              <SortHeader className="px-3 py-2" {...sortProps("lead")}>Team lead</SortHeader>
              <SortHeader className="px-3 py-2" align="right" {...sortProps("overall")}>Health</SortHeader>
              <SortHeader className="px-3 py-2" align="right" {...sortProps("lead_flow")}>Leads</SortHeader>
              <SortHeader className="px-3 py-2" align="right" {...sortProps("activity")}>Activity</SortHeader>
              <SortHeader className="px-3 py-2" align="right" {...sortProps("nps")}>NPS</SortHeader>
              <SortHeader className="px-3 py-2" align="right" {...sortProps("engagement")}>Engagement</SortHeader>
              <SortHeader className="px-3 py-2" align="right" {...sortProps("receivables")}>
                <span title={AR_BLURB}>AR</span>
              </SortHeader>
              <SortHeader className="px-3 py-2" align="center" {...sortProps("measured")}>Inputs</SortHeader>
              <SortHeader className="px-3 py-2" {...sortProps("manual")}>In Salesforce</SortHeader>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <>
                <tr
                  key={c.clientId}
                  className={`cursor-pointer border-b last:border-0 hover:bg-muted/40 ${
                    disagrees(c) ? "bg-amber-50/60 dark:bg-amber-950/20" : ""
                  }`}
                  onClick={() => setOpen(open === c.clientId ? null : c.clientId)}
                >
                  <td className="px-3 py-2 font-medium">{c.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.accountManager ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.teamLead ?? "—"}</td>
                  <td className="px-3 py-2 text-right"><Score value={c.overall} /></td>
                  <td className="px-3 py-2 text-right"><Score value={at(c, "lead_flow")} /></td>
                  <td className="px-3 py-2 text-right"><Score value={at(c, "activity")} /></td>
                  <td className="px-3 py-2 text-right"><Score value={at(c, "nps")} /></td>
                  <td className="px-3 py-2 text-right"><Score value={at(c, "engagement")} /></td>
                  <td className="px-3 py-2 text-right" title={AR_BLURB}>
                    <Score value={at(c, "receivables")} />
                  </td>
                  <td className="px-3 py-2 text-center text-muted-foreground tabular-nums">
                    {c.inputsMeasured} of 5
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{c.manualHealth ?? "—"}</td>
                </tr>

                {open === c.clientId && (
                  <tr key={`${c.clientId}-detail`} className="border-b bg-muted/30 last:border-0">
                    <td colSpan={11} className="px-3 py-3">
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                        {c.inputs.map((i) => (
                          <div key={i.key} className="rounded-md border bg-card p-3">
                            <div className="text-xs uppercase tracking-wide text-muted-foreground">
                              {i.label}
                            </div>
                            <div
                              className="mt-1 text-lg"
                              title={i.key === "receivables" ? AR_BLURB : undefined}
                            >
                              <Score value={i.score} />
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">{i.detail}</div>
                            {i.key === "receivables" && (
                              <Link
                                href={`/clients/${c.clientId}`}
                                className="mt-2 inline-block text-xs underline"
                              >
                                Payment History
                              </Link>
                            )}
                          </div>
                        ))}
                      </div>
                      <Link
                        href={`/settings/clients/${c.clientId}`}
                        className="mt-3 inline-block text-sm underline"
                      >
                        Client record
                      </Link>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
