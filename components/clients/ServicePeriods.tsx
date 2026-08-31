"use client";

import { useState, useTransition } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  addServicePeriod, updateServicePeriod, deleteServicePeriod, switchService,
} from "@/actions/org";
import type { ServicePeriod } from "@/lib/clients/result-metrics";

const money = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});

/** The services results are attributed to. Matches the loader's four buckets. */
const SERVICES = ["LG", "OP", "OSDR", "Other"];

type Draft = {
  service: string; started_on: string; ended_on: string;
  monthly_rate: string; tier: string; note: string;
};

const EMPTY: Draft = {
  service: "LG", started_on: "", ended_on: "", monthly_rate: "", tier: "", note: "",
};

const toDraft = (p: ServicePeriod): Draft => ({
  service: p.service,
  started_on: p.startedOn,
  ended_on: p.endedOn ?? "",
  monthly_rate: p.monthlyRate === null ? "" : String(p.monthlyRate),
  tier: p.tier ?? "",
  note: p.note ?? "",
});

/** Blank means "not recorded", which is different from zero. */
const num = (v: string) => (v.trim() === "" ? null : Number(v));

function Input({
  value, onChange, type = "text", placeholder, className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-md border bg-background px-2 py-1 text-sm ${className}`}
    />
  );
}

function ServicePicker({
  value, onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border bg-background px-2 py-1 text-sm"
    >
      {SERVICES.map((s) => (
        <option key={s} value={s}>{s}</option>
      ))}
    </select>
  );
}

export function ServicePeriods({
  clientId, periods,
}: {
  clientId: string;
  periods: ServicePeriod[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [adding, setAdding] = useState(false);
  const [fresh, setFresh] = useState<Draft>(EMPTY);
  const [switching, setSwitching] = useState(false);
  const [sw, setSw] = useState({ service: "OP", onDate: "", rate: "" });

  const run = (fn: () => Promise<{ success: boolean; error?: string }>, done?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.success) done?.();
      else setError(r.error ?? "That did not work.");
    });

  const fields = (d: Draft, set: (v: Draft) => void) => (
    <>
      <td className="px-3 py-1.5">
        <ServicePicker value={d.service} onChange={(v) => set({ ...d, service: v })} />
      </td>
      <td className="px-3 py-1.5">
        <Input type="date" value={d.started_on} onChange={(v) => set({ ...d, started_on: v })} />
      </td>
      <td className="px-3 py-1.5">
        <Input type="date" value={d.ended_on} onChange={(v) => set({ ...d, ended_on: v })} />
      </td>
      <td className="px-3 py-1.5">
        <Input
          type="number"
          value={d.monthly_rate}
          onChange={(v) => set({ ...d, monthly_rate: v })}
          className="w-24"
        />
      </td>
      <td className="px-3 py-1.5">
        <Input value={d.tier} onChange={(v) => set({ ...d, tier: v })} className="w-16" />
      </td>
      <td className="px-3 py-1.5">
        <Input value={d.note} onChange={(v) => set({ ...d, note: v })} className="w-full" />
      </td>
    </>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-semibold">Services</h2>
        {!adding && !switching && (
          <>
            <button
              onClick={() => { setSwitching(true); setError(null); }}
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              Change service
            </button>
            <button
              onClick={() => { setAdding(true); setFresh(EMPTY); setError(null); }}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              <Plus className="h-3.5 w-3.5" /> Add period
            </button>
          </>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {switching && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/20 p-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Switch to</span>
            <ServicePicker value={sw.service} onChange={(v) => setSw({ ...sw, service: v })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Effective</span>
            <Input type="date" value={sw.onDate} onChange={(v) => setSw({ ...sw, onDate: v })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Monthly rate</span>
            <Input
              type="number"
              value={sw.rate}
              onChange={(v) => setSw({ ...sw, rate: v })}
              className="w-28"
            />
          </label>
          <button
            disabled={pending}
            onClick={() =>
              run(
                () => switchService(clientId, sw.service, sw.onDate, num(sw.rate)),
                () => { setSwitching(false); setSw({ service: "OP", onDate: "", rate: "" }); },
              )
            }
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            Switch
          </button>
          <button
            onClick={() => { setSwitching(false); setError(null); }}
            className="rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Service</th>
              <th className="px-3 py-2 font-medium">From</th>
              <th className="px-3 py-2 font-medium">To</th>
              <th className="px-3 py-2 font-medium">Rate</th>
              <th className="px-3 py-2 font-medium">Tier</th>
              <th className="px-3 py-2 font-medium">Note</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {periods.map((p) =>
              editing === p.id ? (
                <tr key={p.id} className="border-t bg-muted/20">
                  {fields(draft, setDraft)}
                  <td className="px-3 py-1.5 text-muted-foreground">manual</td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        aria-label="Save"
                        disabled={pending}
                        onClick={() =>
                          run(
                            () =>
                              updateServicePeriod(p.id, clientId, {
                                service: draft.service,
                                started_on: draft.started_on,
                                ended_on: draft.ended_on || null,
                                monthly_rate: num(draft.monthly_rate),
                                tier: draft.tier,
                                note: draft.note,
                              }),
                            () => setEditing(null),
                          )
                        }
                        className="text-emerald-600 hover:text-emerald-500"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        aria-label="Cancel"
                        onClick={() => { setEditing(null); setError(null); }}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={p.id} className="border-t">
                  <td className="px-3 py-1.5">{p.service}</td>
                  <td className="px-3 py-1.5 tabular-nums">{p.startedOn}</td>
                  <td className="px-3 py-1.5 tabular-nums">
                    {p.endedOn ?? <span className="text-emerald-600 dark:text-emerald-400">open</span>}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">
                    {p.monthlyRate === null ? "—" : money.format(p.monthlyRate)}
                  </td>
                  <td className="px-3 py-1.5">{p.tier ?? "—"}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{p.note ?? "—"}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{p.source}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        aria-label="Edit"
                        onClick={() => { setEditing(p.id); setDraft(toDraft(p)); setError(null); }}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        aria-label="Delete"
                        disabled={pending}
                        onClick={() => run(() => deleteServicePeriod(p.id, clientId))}
                        className="text-muted-foreground hover:text-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ),
            )}

            {adding && (
              <tr className="border-t bg-muted/20">
                {fields(fresh, setFresh)}
                <td className="px-3 py-1.5 text-muted-foreground">manual</td>
                <td className="px-3 py-1.5">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      aria-label="Save"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () =>
                            addServicePeriod(clientId, {
                              service: fresh.service,
                              started_on: fresh.started_on,
                              ended_on: fresh.ended_on || null,
                              monthly_rate: num(fresh.monthly_rate),
                              tier: fresh.tier,
                              note: fresh.note,
                            }),
                          () => { setAdding(false); setFresh(EMPTY); },
                        )
                      }
                      className="text-emerald-600 hover:text-emerald-500"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      aria-label="Cancel"
                      onClick={() => { setAdding(false); setError(null); }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            )}

            {!periods.length && !adding && (
              <tr>
                <td colSpan={8} className="px-3 py-3 text-muted-foreground">
                  No service periods recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
