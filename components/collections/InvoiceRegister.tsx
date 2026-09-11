"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CircleDollarSign, Loader2, Undo2 } from "lucide-react";
import {
  markAchRun, setCollectMethod, unmarkAchRun,
  type CollectMethod, type InvoiceRow,
} from "@/actions/ar-register";
import { Surface } from "@/components/ui/surface";

const money = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});
const day = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" });

const on = (iso: string | null) =>
  iso ? day.format(new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso)) : "—";

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const STATE_TONE: Record<InvoiceRow["state"], string> = {
  paid: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  scheduled: "bg-muted text-muted-foreground",
  open: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  "due today": "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300",
  overdue: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

const METHOD_LABEL: Record<string, string> = {
  we_charge: "We charge",
  auto: "Autopay",
  they_pay: "They pay",
};

const FILTERS = ["ACH to run", "Open", "Overdue", "Paid", "All"] as const;
type Filter = (typeof FILTERS)[number];

export function InvoiceRegister({ rows }: { rows: InvoiceRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<Filter>("ACH to run");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  function run(fn: () => Promise<{ success: boolean; error?: string }>) {
    setError("");
    startTransition(async () => {
      const res = await fn();
      if (!res.success) setError(res.error ?? "Something went wrong.");
      else router.refresh();
    });
  }

  /*
   * The two halves of the ACH question. "To run" is work outstanding; "Running"
   * is work done that QuickBooks has not caught up with yet, and it is there so
   * nobody takes the same payment twice while waiting.
   */
  const achDue = useMemo(
    () => rows.filter(
      (r) => r.collect_method === "we_charge" && r.balance > 0
        && r.age_days >= 0 && !r.ach_marked_at
    ),
    [rows]
  );
  const achRunning = useMemo(
    () => rows.filter(
      (r) => r.collect_method === "we_charge" && r.balance > 0 && r.ach_marked_at
    ),
    [rows]
  );
  const unknown = useMemo(
    () => new Set(
      rows.filter((r) => r.balance > 0 && !r.collect_method).map((r) => r.client_id)
    ).size,
    [rows]
  );

  const listed = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = rows.filter((r) => {
      if (filter === "ACH to run") return r.collect_method === "we_charge" && r.balance > 0;
      if (filter === "Open") return r.balance > 0;
      if (filter === "Overdue") return r.state === "overdue";
      if (filter === "Paid") return r.state === "paid";
      return true;
    });
    if (!q) return base;
    return base.filter(
      (r) => r.client_name.toLowerCase().includes(q) || r.invoice_no.toLowerCase().includes(q)
    );
  }, [rows, filter, query]);

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="ACH to run" value={String(achDue.length)}
          sub={money.format(achDue.reduce((t, r) => t + r.balance, 0))}
          tone={achDue.length ? "text-yellow-700 dark:text-yellow-300" : undefined} />
        <Stat label="Awaiting confirmation" value={String(achRunning.length)}
          sub={money.format(achRunning.reduce((t, r) => t + r.balance, 0))} />
        <Stat label="Open invoices" value={String(rows.filter((r) => r.balance > 0).length)}
          sub={money.format(rows.filter((r) => r.balance > 0).reduce((t, r) => t + r.balance, 0))} />
        <Stat label="Clients unclassified" value={String(unknown)}
          tone={unknown ? "text-red-600 dark:text-red-400" : undefined} />
      </div>

      {achDue.length > 0 && (
        <AchPanel
          title={`Run these today (${achDue.length})`}
          rows={achDue}
          pending={pending}
          action={(r) => (
            <button type="button" disabled={pending}
              onClick={() => run(() => markAchRun(r.qb_invoice_id, r.balance))}
              className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs hover:bg-primary/20 disabled:opacity-50">
              {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CircleDollarSign className="h-3 w-3" />}
              Mark run
            </button>
          )}
        />
      )}

      {achRunning.length > 0 && (
        <AchPanel
          title={`Taken, waiting on QuickBooks (${achRunning.length})`}
          rows={achRunning}
          pending={pending}
          action={(r) => (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {r.ach_marked_at ? ago(r.ach_marked_at) : ""}
                {r.ach_marked_by ? ` · ${r.ach_marked_by.split("@")[0]}` : ""}
              </span>
              <button type="button" disabled={pending}
                onClick={() => run(() => unmarkAchRun(r.qb_invoice_id))}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">
                <Undo2 className="h-3 w-3" /> Undo
              </button>
            </div>
          )}
        />
      )}

      <Surface as="section" pad="none">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)}
                className={`rounded-md px-2 py-1 text-xs ${
                  filter === f ? "bg-primary/15 font-medium text-foreground" : "text-muted-foreground hover:bg-muted"
                }`}>
                {f}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Client or invoice"
            className="h-7 w-48 rounded-md border bg-field px-2 text-xs"
          />
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[62rem]">
            <div className="grid grid-cols-[minmax(9rem,1.3fr)_5rem_5rem_5rem_5rem_6rem_5.5rem_6rem_7.5rem] gap-3 border-b bg-muted/40 px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              <span>Client</span>
              <span>Invoice</span>
              <span>Created</span>
              <span>Sent</span>
              <span>Due</span>
              <span className="text-right">Amount</span>
              <span className="text-right">Balance</span>
              <span>Paid</span>
              <span>Collection</span>
            </div>
            <div className="divide-y">
              {listed.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing here.</p>
              ) : listed.map((r) => (
                <div key={r.qb_invoice_id}
                  className="grid min-h-10 grid-cols-[minmax(9rem,1.3fr)_5rem_5rem_5rem_5rem_6rem_5.5rem_6rem_7.5rem] items-center gap-3 px-3 py-1.5 text-sm">
                  <Link href={`/clients/${r.client_id}`} title={r.client_name}
                    className="min-w-0 truncate font-medium hover:underline">
                    {r.client_name}
                  </Link>
                  <span className="truncate font-mono text-xs text-muted-foreground">{r.invoice_no}</span>
                  <span className="text-xs text-muted-foreground">{on(r.created_at)}</span>
                  <span className={`text-xs ${r.sent_at ? "text-muted-foreground" : "text-muted-foreground/50"}`}
                    title={r.sent_at ? "" : `QuickBooks has no send record (${r.email_status ?? "not set"})`}>
                    {on(r.sent_at)}
                  </span>
                  <span className="text-xs text-muted-foreground">{on(r.due_date)}</span>
                  <span className="text-right tabular-nums text-muted-foreground">{money.format(r.amount)}</span>
                  <span className={`text-right tabular-nums ${r.balance > 0 ? "" : "text-muted-foreground"}`}>
                    {money.format(r.balance)}
                  </span>
                  <span className="text-xs">
                    {r.paid_on
                      ? <span className="text-emerald-700 dark:text-emerald-400">{on(r.paid_on)}</span>
                      : <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${STATE_TONE[r.state]}`}>{r.state}</span>}
                  </span>
                  <select
                    value={r.collect_method ?? ""}
                    disabled={pending}
                    onChange={(e) =>
                      run(() => setCollectMethod(r.client_id, (e.target.value || null) as CollectMethod))
                    }
                    className={`h-7 w-full rounded-md border bg-field px-1 text-xs ${
                      r.collect_method ? "" : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    <option value="">Unknown</option>
                    <option value="we_charge">We charge</option>
                    <option value="auto">Autopay</option>
                    <option value="they_pay">They pay</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Surface>
    </div>
  );
}

function Stat({ label, value, sub, tone }: {
  label: string; value: string; sub?: string; tone?: string;
}) {
  return (
    <Surface pad="tight">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
      {sub && <div className="text-xs tabular-nums text-muted-foreground">{sub}</div>}
    </Surface>
  );
}

function AchPanel({ title, rows, pending, action }: {
  title: string;
  rows: InvoiceRow[];
  pending: boolean;
  action: (r: InvoiceRow) => React.ReactNode;
}) {
  return (
    <Surface as="section" pad="none">
      <div className="border-b px-3 py-2">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="divide-y">
        {rows.map((r) => (
          <div key={r.qb_invoice_id}
            className="grid min-h-11 grid-cols-[minmax(9rem,1.4fr)_5rem_5rem_6rem_1fr] items-center gap-3 px-3 py-2 text-sm">
            <Link href={`/clients/${r.client_id}`} title={r.client_name}
              className="min-w-0 truncate font-medium hover:underline">
              {r.client_name}
            </Link>
            <span className="truncate font-mono text-xs text-muted-foreground">{r.invoice_no}</span>
            <span className={`text-xs ${r.age_days > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
              {r.age_days > 0 ? `${r.age_days}d late` : "due today"}
            </span>
            <span className="text-right font-medium tabular-nums">{money.format(r.balance)}</span>
            <div className="flex justify-end">{action(r)}</div>
          </div>
        ))}
      </div>
    </Surface>
  );
}
