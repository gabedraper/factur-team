"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { Chip } from "@/components/pipeline/bits";
import { control } from "@/components/ui/control";
import { Table, TableScroll, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import {
  setSyncObject, setSyncFields, describeObjectFields, type SyncObjectConfig,
} from "@/actions/salesforce-sync";
import type { SalesforceField } from "@/lib/salesforce/client";

/*
 * The sync's settings, on the page that shows whether it is working.
 *
 * Per object: on or off, how often, how many rows a run may take, and which
 * fields. Adding an object is not offered here -- it needs a mirror table and
 * a transform, which is code -- so the list is what the app knows how to use.
 */

const nf = new Intl.NumberFormat("en-US");

function when(iso: string | null) {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function SalesforceSyncObjects({
  objects, lastRun,
}: {
  objects: SyncObjectConfig[];
  lastRun: Record<string, string | null>;
}) {
  const [busy, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const say = (r: { ok: true } | { ok: false; error: string }, done: string) =>
    setNote(r.ok ? done : r.error);

  return (
    <div className="space-y-3">
      <Surface pad="none">
        <TableScroll>
          <Table>
            <THead>
              <TR>
                <TH>Object</TH>
                <TH>Synced</TH>
                <TH numeric>Every</TH>
                <TH numeric>Rows per run</TH>
                <TH>Fields</TH>
                <TH>Last run</TH>
              </TR>
            </THead>
            <TBody>
              {objects.map((o) => (
                <TR key={o.object}>
                  <TD>
                    <span className="block font-medium">{o.label}</span>
                    <span className="block text-meta text-muted-foreground">{o.object} → {o.mirror_table}</span>
                  </TD>
                  <TD>
                    <button
                      type="button"
                      disabled={busy}
                      aria-pressed={o.enabled}
                      title={o.enabled ? "Switch off" : "Switch on"}
                      onClick={() => start(async () =>
                        say(await setSyncObject({ object: o.object, enabled: !o.enabled }), `${o.label}: ${o.enabled ? "off" : "on"}.`))}
                    >
                      <Chip colour={o.enabled ? "emerald" : "slate"}>{o.enabled ? "On" : "Off"}</Chip>
                    </button>
                  </TD>
                  <TD numeric>
                    <span className="inline-flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        max={1440}
                        defaultValue={o.every_minutes}
                        aria-label={`${o.label}: every N minutes`}
                        className={control({ size: "sm", className: "w-20 text-right" })}
                        onBlur={(e) => {
                          const n = Number(e.currentTarget.value);
                          if (n !== o.every_minutes) start(async () => say(await setSyncObject({ object: o.object, every_minutes: n }), `${o.label}: every ${n} min.`));
                        }}
                      />
                      <span className="text-meta text-muted-foreground">min</span>
                    </span>
                  </TD>
                  <TD numeric>
                    <input
                      type="number"
                      min={100}
                      max={50000}
                      step={100}
                      defaultValue={o.max_per_run}
                      aria-label={`${o.label}: rows per run`}
                      className={control({ size: "sm", className: "w-24 text-right" })}
                      onBlur={(e) => {
                        const n = Number(e.currentTarget.value);
                        if (n !== o.max_per_run) start(async () => say(await setSyncObject({ object: o.object, max_per_run: n }), `${o.label}: ${nf.format(n)} rows per run.`));
                      }}
                    />
                  </TD>
                  <TD>
                    <span className="inline-flex items-center gap-2">
                      <span className="tabular-nums">
                        {o.fields ? `${nf.format(o.fields.length)} of ${nf.format(o.mirror_columns.length)}` : `all ${nf.format(o.mirror_columns.length)}`}
                      </span>
                      <Button size="sm" variant="outline" onClick={() => setEditing(editing === o.object ? null : o.object)}>
                        {editing === o.object ? "Close" : "Choose"}
                      </Button>
                    </span>
                  </TD>
                  <TD className="whitespace-nowrap tabular-nums text-muted-foreground">{when(lastRun[o.object] ?? null)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableScroll>
      </Surface>

      {editing && (
        <FieldPicker
          key={editing}
          config={objects.find((o) => o.object === editing)!}
          onDone={(msg) => { setNote(msg); setEditing(null); }}
        />
      )}

      {note && <p className="text-meta text-muted-foreground">{note}</p>}
    </div>
  );
}

/*
 * Every field Salesforce has on the object, with the ones synced ticked. The
 * ones a transform reads are ticked and locked. "All fields" clears the
 * choice and goes back to every mirror column.
 */
function FieldPicker({ config, onDone }: { config: SyncObjectConfig; onDone: (msg: string) => void }) {
  const [fields, setFields] = useState<SalesforceField[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(config.fields ?? config.mirror_columns),
  );
  const [busy, start] = useTransition();
  const required = useMemo(() => new Set(config.required), [config.required]);
  const inMirror = useMemo(() => new Set(config.mirror_columns), [config.mirror_columns]);

  if (fields === null && !error && !busy) {
    start(async () => {
      try { setFields(await describeObjectFields(config.object)); }
      catch (e) { setError(e instanceof Error ? e.message : "Could not read the fields."); }
    });
  }

  const shown = (fields ?? []).filter((f) => {
    const t = q.trim().toLowerCase();
    return !t || f.name.toLowerCase().includes(t) || f.label.toLowerCase().includes(t);
  });
  const toggle = (name: string) =>
    setChosen((c) => { const n = new Set(c); if (n.has(name)) n.delete(name); else n.add(name); return n; });

  return (
    <Surface>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-section-title">{config.label} fields</h3>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a field"
            aria-label="Find a field"
            className={control({ size: "sm", className: "min-w-56" })}
          />
          <span className="ml-auto text-meta tabular-nums text-muted-foreground">
            {nf.format(chosen.size)} chosen · {nf.format(required.size)} locked
          </span>
        </div>

        {error && <p className="text-body text-destructive">{error}</p>}
        {!fields && !error && <p className="text-body text-muted-foreground">Reading fields from Salesforce…</p>}

        {fields && (
          <div className="grid max-h-96 gap-x-4 gap-y-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((f) => {
              const locked = required.has(f.name);
              return (
                <label key={f.name} className="flex items-center gap-2 text-body">
                  <input
                    type="checkbox"
                    checked={locked || chosen.has(f.name)}
                    disabled={locked}
                    onChange={() => toggle(f.name)}
                  />
                  <span className="min-w-0 truncate">
                    {f.label}
                    <span className="text-meta text-muted-foreground"> {f.name}</span>
                    {!inMirror.has(f.name) && chosen.has(f.name) && (
                      <span className="text-meta text-muted-foreground"> · new column</span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={busy || !fields}
            onClick={() => start(async () => {
              const r = await setSyncFields(config.object, [...chosen].filter((n) => !required.has(n)));
              onDone(r.ok
                ? `${config.label}: ${nf.format(chosen.size)} fields${r.added.length ? `, ${r.added.length} new column${r.added.length === 1 ? "" : "s"} added` : ""}.`
                : r.error);
            })}
          >
            Sync these fields
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => start(async () => {
              const r = await setSyncFields(config.object, null);
              onDone(r.ok ? `${config.label}: every mirror column.` : r.error);
            })}
          >
            All fields
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onDone("")}>Cancel</Button>
        </div>
      </div>
    </Surface>
  );
}
