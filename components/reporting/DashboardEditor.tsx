"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { deleteDashboard, saveDashboard } from "@/actions/reports";
import type { Dashboard, SavedReport, Tile } from "@/lib/reporting/spec";
import { FIELD, Labelled, RemoveButton } from "./builder-bits";

/**
 * A dashboard is an ordered list of saved reports, each with a width. No
 * drag-and-drop: up and down arrows and three widths arrange a dozen tiles
 * in under a minute, and the result is the same on a phone as on a wall.
 */

const WIDTHS: { value: Tile["width"]; label: string }[] = [
  { value: "third", label: "Third" },
  { value: "half", label: "Half" },
  { value: "full", label: "Full width" },
];

export function DashboardEditor({
  reports,
  initial,
  canDelete,
}: {
  reports: SavedReport[];
  initial: Dashboard | null;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [shared, setShared] = useState(initial?.shared ?? false);
  const [tiles, setTiles] = useState<Tile[]>(initial?.tiles ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const byId = new Map(reports.map((r) => [r.id, r]));

  const update = (i: number, p: Partial<Tile>) =>
    setTiles((t) => t.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const move = (i: number, by: -1 | 1) =>
    setTiles((t) => {
      const j = i + by;
      if (j < 0 || j >= t.length) return t;
      const next = [...t];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  function add() {
    const first = reports.find((r) => !tiles.some((t) => t.report_id === r.id)) ?? reports[0];
    if (!first) return;
    setTiles((t) => [...t, { report_id: first.id, width: first.chart ? "half" : "full" }]);
  }

  function save() {
    setError(null);
    start(async () => {
      const out = await saveDashboard({ id: initial?.id ?? null, name, description, shared, tiles });
      if (!out.success || !out.id) { setError(out.error ?? "Couldn't save."); return; }
      router.push(`/reports/dashboards/${out.id}`);
      router.refresh();
    });
  }

  function remove() {
    if (!initial) return;
    if (!window.confirm(`Delete "${initial.name}"? The reports on it are kept.`)) return;
    start(async () => {
      const out = await deleteDashboard(initial.id);
      if (!out.success) { setError(out.error ?? "Couldn't delete."); return; }
      router.push("/reports");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4 p-section">
      <PageHeader
        eyebrow={<Link href="/reports" className="hover:text-foreground">Reports</Link>}
        title={initial ? initial.name : "New dashboard"}
        description="Saved reports, arranged. Each tile runs its report fresh when the dashboard opens."
        actions={
          <>
            {initial && canDelete ? (
              <Button variant="outline" size="sm" onClick={remove} disabled={busy}>Delete dashboard</Button>
            ) : null}
            <Button size="sm" onClick={save} disabled={busy || !name.trim() || tiles.length === 0}>
              {initial ? "Save changes" : "Save dashboard"}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[24rem_minmax(0,1fr)]">
        <Surface title="About" pad="tight">
          <div className="space-y-3">
            <Labelled label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sales this quarter" className="h-9" />
            </Labelled>
            <Labelled label="Description">
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </Labelled>
            <label className="inline-flex items-center gap-2 text-body">
              <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
              Share with everyone
            </label>
            <p className="text-meta text-muted-foreground">
              A shared dashboard shows each viewer only the reports they may see.
            </p>
            {error ? <p className="text-body text-destructive">{error}</p> : null}
          </div>
        </Surface>

        <Surface title="Tiles" pad="tight">
          {reports.length === 0 ? (
            <p className="text-body text-muted-foreground">
              Save a report first; a dashboard is made of them.{" "}
              <Link href="/reports/new" className="underline">New report</Link>
            </p>
          ) : (
            <div className="space-y-2">
              {tiles.map((t, i) => {
                const r = byId.get(t.report_id);
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 p-2">
                    <select value={t.report_id} onChange={(e) => update(i, { report_id: e.target.value })} className={`${FIELD} min-w-[14rem] flex-1`}>
                      {reports.map((o) => <option key={o.id} value={o.id}>{o.name}{o.chart ? "" : " · table"}</option>)}
                    </select>
                    <select value={t.width} onChange={(e) => update(i, { width: e.target.value as Tile["width"] })} className={`${FIELD} w-32`}>
                      {WIDTHS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                    </select>
                    <Input
                      value={t.title ?? ""}
                      onChange={(e) => update(i, { title: e.target.value || null })}
                      placeholder={r?.name ?? "Title"}
                      className="h-9 w-48"
                    />
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"
                            className="h-9 rounded-md px-2 text-muted-foreground hover:bg-card-hover hover:text-foreground disabled:opacity-40">
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === tiles.length - 1} aria-label="Move down"
                            className="h-9 rounded-md px-2 text-muted-foreground hover:bg-card-hover hover:text-foreground disabled:opacity-40">
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <RemoveButton label="Remove tile" onClick={() => setTiles((x) => x.filter((_, j) => j !== i))} />
                  </div>
                );
              })}
              {tiles.length < 24 ? (
                <button
                  type="button"
                  onClick={add}
                  className="inline-flex items-center gap-1 text-body text-muted-foreground transition-colors duration-fast ease-out hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden /> Add a tile
                </button>
              ) : null}
            </div>
          )}
        </Surface>
      </div>
    </div>
  );
}
