"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Clock, FileText, Loader2, Mail, Pause, Play, Send } from "lucide-react";
import {
  draftArToMe, holdInvoice, placeArStep, releaseInvoice, setArStepActive,
  type ArChase, type ArSettings, type ArStep,
} from "@/actions/ar";

const money = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});
const day = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" });

const when = (iso: string | null) =>
  iso ? day.format(new Date(`${iso}T00:00:00`)) : "—";

/** Calm before due, hotter the further past it. */
function tone(offset: number) {
  if (offset < 0) return "text-emerald-600 dark:text-emerald-400";
  if (offset === 0) return "text-yellow-600 dark:text-yellow-300";
  if (offset <= 15) return "text-orange-600 dark:text-orange-400";
  if (offset <= 31) return "text-red-500 dark:text-red-300";
  return "font-semibold text-red-700 dark:text-red-500";
}

const rung = (offset: number) =>
  offset < 0 ? `Day ${offset}` : offset === 0 ? "Due" : `Day +${offset}`;

export function ArLadder({
  rows, steps, settings, mode,
}: {
  rows: ArChase[];
  steps: ArStep[];
  settings: ArSettings;
  mode: "semi" | "full";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const ready = rows.filter((r) => !r.blocked);
  const held = rows.filter((r) => r.blocked);
  const activeSteps = steps.filter((s) => s.active).length;

  const stale =
    settings.data_age_minutes === null ||
    settings.data_age_minutes > settings.stale_hours * 60;

  function run(fn: () => Promise<{ success: boolean; error?: string }>, ok?: string) {
    setError("");
    setNote("");
    startTransition(async () => {
      const res = await fn();
      if (!res.success) setError(res.error ?? "Something went wrong.");
      else {
        if (ok) setNote(ok);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}
      {note && (
        <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          {note}
        </p>
      )}

      {/* State of the machine */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Ready to send" value={String(ready.length)} />
        <Stat label="Blocked" value={String(held.length)} />
        <Stat label="Rungs active" value={`${activeSteps} of ${steps.length}`} />
        <Stat
          label="QuickBooks data"
          value={
            settings.data_age_minutes === null
              ? "never seen"
              : settings.data_age_minutes < 90
                ? `${settings.data_age_minutes} min old`
                : `${Math.round(settings.data_age_minutes / 60)} h old`
          }
          tone={stale ? "text-red-600 dark:text-red-400" : undefined}
        />
      </div>

      {/* The rungs, and which are live */}
      <section className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="text-sm font-semibold">Ladder</h2>
          <span className="text-xs text-muted-foreground">
            Starts at invoices due on or after {when(settings.start_from)} · {mode === "full" ? "sends automatically" : "creates drafts"}
          </span>
        </div>
        <div className="divide-y">
          {steps.map((s) => {
            const waiting = rows.filter((r) => r.step_id === s.id).length;
            return (
              <div key={s.id} className="grid grid-cols-[5rem_1fr_5rem_7.5rem] items-center gap-3 px-3 py-2 text-sm">
                <span className={`font-mono text-xs ${tone(s.offset_days)}`}>
                  {rung(s.offset_days)}
                </span>
                <span className="min-w-0 truncate">
                  {s.name}
                  {s.internal_subject && (
                    <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      + task
                    </span>
                  )}
                  {s.skip_when_autopay && (
                    <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      not on autopay
                    </span>
                  )}
                </span>
                <span className="text-right tabular-nums text-muted-foreground">
                  {waiting || ""}
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => setArStepActive(s.id, !s.active))}
                  className={`inline-flex items-center justify-center gap-1 rounded-md border px-2 py-1 text-xs disabled:opacity-50 ${
                    s.active
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                      : "hover:bg-muted"
                  }`}
                >
                  {s.active ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                  {s.active ? "Live" : "Off"}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Ready */}
      <Queue
        title={`Ready to send (${ready.length})`}
        rows={ready}
        open={open}
        setOpen={setOpen}
        pending={pending}
        mode={mode}
        onDraft={(r) =>
          run(() => draftArToMe(r.qb_invoice_id, r.step_id), "Test draft is in your mailbox.")
        }
        onSend={(r) =>
          run(
            () => placeArStep(r.qb_invoice_id, r.step_id, r.rendered_subject, r.rendered_body),
            mode === "full" ? "Sent." : "Draft created for review."
          )
        }
        onHold={(r) => run(() => holdInvoice(r.qb_invoice_id, null, "Held from the ladder"))}
      />

      {/* Blocked */}
      {held.length > 0 && (
        <Queue
          title={`Blocked (${held.length})`}
          rows={held}
          open={open}
          setOpen={setOpen}
          pending={pending}
          mode={mode}
          blocked
          onRelease={(r) => run(() => releaseInvoice(r.qb_invoice_id))}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

function Queue({
  title, rows, open, setOpen, pending, mode, blocked,
  onDraft, onSend, onHold, onRelease,
}: {
  title: string;
  rows: ArChase[];
  open: number | null;
  setOpen: (v: number | null) => void;
  pending: boolean;
  mode: "semi" | "full";
  blocked?: boolean;
  onDraft?: (r: ArChase) => void;
  onSend?: (r: ArChase) => void;
  onHold?: (r: ArChase) => void;
  onRelease?: (r: ArChase) => void;
}) {
  return (
    <section className="rounded-lg border bg-card">
      <div className="border-b px-3 py-2">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing here.</p>
      ) : (
        <div className="divide-y">
          {rows.map((r) => (
            <div key={`${r.qb_invoice_id}-${r.step_id}`}>
              <div className="grid grid-cols-[minmax(9rem,1.4fr)_5.5rem_5rem_6rem_1fr_auto] items-center gap-3 px-3 py-2 text-sm">
                <Link
                  href={`/clients/${r.client_id}`}
                  className="min-w-0 truncate font-medium hover:underline"
                  title={r.client_name}
                >
                  {r.client_name}
                </Link>
                <span className="truncate font-mono text-xs text-muted-foreground" title={`Invoice ${r.invoice_no}`}>
                  #{r.invoice_no}
                </span>
                <span className={`font-mono text-xs ${tone(r.age_days)}`}>
                  {rung(r.age_days)}
                </span>
                <span className="text-right tabular-nums">
                  {money.format(r.invoice_balance)}
                </span>
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {blocked ? r.blocked : r.step_name}
                </span>
                <div className="flex items-center gap-1">
                  {!blocked && (
                    <>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => setOpen(open === r.qb_invoice_id ? null : r.qb_invoice_id)}
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                      >
                        <Mail className="h-3 w-3" /> Read
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => onDraft?.(r)}
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                      >
                        Test
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => onSend?.(r)}
                        className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs hover:bg-primary/20 disabled:opacity-50"
                      >
                        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                        {mode === "full" ? "Send" : "Draft"}
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => onHold?.(r)}
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                      >
                        <Clock className="h-3 w-3" /> Hold
                      </button>
                    </>
                  )}
                  {blocked && r.blocked?.startsWith("On hold") && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => onRelease?.(r)}
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                    >
                      <Check className="h-3 w-3" /> Release
                    </button>
                  )}
                </div>
              </div>

              {open === r.qb_invoice_id && !blocked && (
                <div className="space-y-2 border-t bg-muted/30 px-3 py-3">
                  <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                    <span>To: {r.to_email ?? "—"}</span>
                    <span>Cc: {r.cc_emails ?? "—"}</span>
                    <span>Due: {when(r.due_date)}</span>
                    <span>Account total: {money.format(r.account_total ?? 0)}</span>
                  </div>
                  <a
                    href={`/api/ar/statement/${r.client_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <FileText className="h-3 w-3" /> Statement
                  </a>
                  <div className="rounded-md border bg-card px-3 py-2 text-sm font-medium">
                    {r.rendered_subject}
                  </div>
                  <div
                    className="prose prose-sm max-w-none rounded-md border bg-card px-3 py-2 dark:prose-invert"
                    dangerouslySetInnerHTML={{ __html: r.rendered_body }}
                  />
                  {r.internal_subject && (
                    <div className="rounded-md border border-dashed bg-card px-3 py-2 text-xs text-muted-foreground">
                      Task to {r.internal_to?.join(", ")}: {r.internal_subject}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
