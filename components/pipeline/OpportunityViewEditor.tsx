"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { saveView, deleteView } from "@/actions/opportunity-views";
import { ALL_STAGES, LEAD_STATUSES } from "@/lib/pipeline/picklists";
import {
  LIST_FIELDS, FIELD_BY_KEY, OPERATOR_LABELS, operatorsFor, opTakesNoValue, DEFAULT_COLUMNS,
  type Filter, type ListView, type Operator,
} from "@/lib/pipeline/list-views";

/*
 * Making and changing a saved view: its name, its columns, its filters, its
 * sort. A panel on the right, which is where Salesforce puts it and where the
 * people moving off Salesforce will look.
 *
 * Saving navigates to the view. A view is an address (?view=<id>), so the new
 * one opens the same way any other chip does, and the chip row -- read on the
 * server -- picks it up on the refresh.
 */

const SELECT =
  "h-9 rounded-md border border-input bg-field px-2 text-body ring-offset-background " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const BLANK: ListView = {
  id: "", name: "", owner_member_id: null, shared: false,
  columns: [...DEFAULT_COLUMNS], filters: [], sort_field: null, sort_dir: "asc",
};

export function OpportunityViewTools({
  current,
  canShare,
}: {
  /** The saved view on screen, when it is one this person may edit. */
  current: ListView | null;
  canShare: boolean;
}) {
  const [editing, setEditing] = useState<ListView | null>(null);
  return (
    <>
      {current && (
        <Button variant="ghost" size="sm" onClick={() => setEditing({ ...current })}>
          <Pencil className="mr-1 h-3.5 w-3.5" /> Edit view
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={() => setEditing({ ...BLANK })}>
        <Plus className="mr-1 h-3.5 w-3.5" /> New view
      </Button>
      {editing && <ViewEditor view={editing} canShare={canShare} onClose={() => setEditing(null)} />}
    </>
  );
}

/* The same editor, opened from the "no view selected" prompt. */
export function NewViewButton({ canShare }: { canShare: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1 h-3.5 w-3.5" /> New view
      </Button>
      {open && <ViewEditor view={{ ...BLANK }} canShare={canShare} onClose={() => setOpen(false)} />}
    </>
  );
}

function ViewEditor({
  view, canShare, onClose,
}: {
  view: ListView;
  canShare: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [name, setName] = useState(view.name);
  const [shared, setShared] = useState(view.shared);
  const [columns, setColumns] = useState<string[]>(view.columns);
  const [filters, setFilters] = useState<Filter[]>(view.filters ?? []);
  const [sortField, setSortField] = useState<string | null>(view.sort_field);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(view.sort_dir);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const toggleColumn = (key: string) =>
    setColumns((cs) => (cs.includes(key) ? cs.filter((c) => c !== key) : [...cs, key]));
  const setFilter = (i: number, f: Filter) =>
    setFilters((fs) => fs.map((x, j) => (j === i ? f : x)));

  const save = () => {
    setError(null);
    start(async () => {
      const res = await saveView({ id: view.id || undefined, name, shared, columns, filters, sortField, sortDir });
      if (!res.success) { setError(res.error ?? "Could not save the view."); return; }
      onClose();
      router.push(`${pathname}?view=${res.id ?? view.id}`);
      router.refresh();
    });
  };

  const remove = () => {
    setError(null);
    start(async () => {
      const res = await deleteView(view.id);
      if (!res.success) { setError(res.error ?? "Could not delete the view."); return; }
      onClose();
      router.push(`${pathname}?scope=mine`);
      router.refresh();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        role="dialog"
        aria-label={view.id ? "Edit view" : "New view"}
        className="flex h-full w-full max-w-lg flex-col bg-card shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b px-card py-3">
          <h2 className="text-section-title">{view.id ? "Edit view" : "New view"}</h2>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-card py-4">
          <Field label="Name" error={error ?? undefined}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My open pipeline" />
          </Field>

          {canShare && (
            <label className="flex items-center gap-2 text-body">
              <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
              Shared with everyone
            </label>
          )}

          <section className="space-y-2">
            <h3 className="text-section-title">Columns <span className="font-normal text-muted-foreground">{columns.length}</span></h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {LIST_FIELDS.map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-body">
                  <input type="checkbox" checked={columns.includes(f.key)} onChange={() => toggleColumn(f.key)} />
                  <span className="truncate">{f.label}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-section-title">Filters</h3>
              <Button
                variant="outline" size="sm" className="ml-auto"
                onClick={() => setFilters((fs) => [...fs, { field: "stage", op: "equals", value: "" }])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Add filter
              </Button>
            </div>
            {filters.length === 0 ? (
              <p className="text-body text-muted-foreground">Every opportunity you can see.</p>
            ) : (
              <div className="space-y-2">
                {filters.map((f, i) => {
                  const field = FIELD_BY_KEY.get(f.field);
                  const ops = operatorsFor(field?.type ?? "text");
                  const picklist = field?.picklist === "stage" ? ALL_STAGES
                    : field?.picklist === "lead_status" ? LEAD_STATUSES : null;
                  return (
                    <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-md bg-muted/50 p-2">
                      <select
                        aria-label="Field"
                        className={SELECT}
                        value={f.field}
                        onChange={(e) => {
                          const nf = FIELD_BY_KEY.get(e.target.value)!;
                          setFilter(i, { field: nf.key, op: operatorsFor(nf.type)[0], value: "" });
                        }}
                      >
                        {LIST_FIELDS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                      </select>
                      <select
                        aria-label="Operator"
                        className={SELECT}
                        value={f.op}
                        onChange={(e) => setFilter(i, { ...f, op: e.target.value as Operator })}
                      >
                        {ops.map((o) => <option key={o} value={o}>{OPERATOR_LABELS[o]}</option>)}
                      </select>
                      {!opTakesNoValue(f.op) && (
                        picklist ? (
                          <select
                            aria-label="Value"
                            className={`${SELECT} min-w-40`}
                            value={f.value ?? ""}
                            onChange={(e) => setFilter(i, { ...f, value: e.target.value })}
                          >
                            <option value="">—</option>
                            {picklist.map((v) => <option key={v} value={v}>{v}</option>)}
                          </select>
                        ) : (
                          <Input
                            aria-label="Value"
                            className="h-9 w-40"
                            value={f.value ?? ""}
                            placeholder={field?.type === "date" ? "today or 2026-09-30" : "value"}
                            onChange={(e) => setFilter(i, { ...f, value: e.target.value })}
                          />
                        )
                      )}
                      <Button
                        variant="ghost" size="icon" className="ml-auto h-8 w-8"
                        aria-label="Remove filter"
                        onClick={() => setFilters((fs) => fs.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-section-title">Sort by</h3>
            <div className="flex gap-1.5">
              <select aria-label="Sort field" className={SELECT} value={sortField ?? ""}
                onChange={(e) => setSortField(e.target.value || null)}>
                <option value="">Last modified</option>
                {LIST_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              <select aria-label="Sort direction" className={SELECT} value={sortDir}
                onChange={(e) => setSortDir(e.target.value as "asc" | "desc")}>
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </div>
          </section>
        </div>

        <footer className="flex items-center gap-2 border-t px-card py-3">
          {view.id && (
            <Button variant="outline" size="sm" disabled={busy} onClick={remove}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete view
            </Button>
          )}
          <Button className="ml-auto" size="sm" disabled={busy} onClick={save}>Save view</Button>
        </footer>
      </aside>
    </div>
  );
}
