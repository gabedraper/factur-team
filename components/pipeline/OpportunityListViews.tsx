"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Check, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Chip, Empty, Panel, PageHeader } from "@/components/pipeline/bits";
import { listOpportunities, saveView, deleteView } from "@/actions/opportunity-views";
import { ALL_STAGES, LEAD_STATUSES } from "@/lib/pipeline/picklists";
import {
  LIST_FIELDS, FIELD_BY_KEY, OPERATOR_LABELS, operatorsFor, opTakesNoValue,
  knownColumns, DEFAULT_COLUMNS,
  type Filter, type ListField, type ListView, type Operator,
} from "@/lib/pipeline/list-views";
import { progressTone } from "@/lib/pipeline/targets";

/*
 * Opportunities the way Salesforce shows them: pick a view, get its columns and
 * its filters, edit it or make your own.
 *
 * The shape is deliberately familiar rather than better. People moving off
 * Salesforce already know that the dropdown at the top left changes everything
 * below it, that the gear edits the view rather than the record, and that a
 * filter is a field, an operator and a value stacked in a panel on the right.
 * Inventing a nicer arrangement would mean teaching it, and the point of this
 * screen is that nobody should have to be taught it.
 *
 * A view is data -- column keys and filter rows -- and the catalogue in
 * lib/pipeline/list-views decides what those may be, on this side and on the
 * server. Nothing typed into the filter panel becomes part of a query.
 */

const PAGE = 50;

function shortDate(v: unknown) {
  if (!v || typeof v !== "string") return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" });
}

type Row = Record<string, unknown>;

function embed(row: Row, table: string): Record<string, unknown> | null {
  const v = row[table];
  if (!v) return null;
  return (Array.isArray(v) ? v[0] : v) as Record<string, unknown> | null;
}

function raw(row: Row, path: string): unknown {
  const [head, col] = path.split(".");
  if (!col) return row[head];
  return embed(row, head)?.[col] ?? null;
}

/* One place that knows how each field looks, so a column added to the
   catalogue renders without touching the table. */
function Cell({ row, field }: { row: Row; field: ListField }) {
  if (field.key === "contact_name") {
    const c = embed(row, "crm_contacts");
    const name = [c?.first_name, c?.last_name].filter(Boolean).join(" ");
    return <span className="font-medium">{name || "—"}</span>;
  }

  const v = raw(row, field.path);

  if (field.type === "boolean") {
    return v ? <Check className="h-4 w-4 text-emerald-600" /> : null;
  }
  if (field.type === "date") {
    return <span className="tabular-nums">{shortDate(v)}</span>;
  }
  if (field.key === "account_domain" && typeof v === "string" && v) {
    return (
      <a href={`https://${v}`} target="_blank" rel="noreferrer"
         onClick={(e) => e.stopPropagation()}
         className="underline-offset-2 hover:underline">{v}</a>
    );
  }
  if (field.type === "picklist" && typeof v === "string" && v) {
    return <Chip colour={progressTone(v)}>{v}</Chip>;
  }
  return <span className="text-muted-foreground">{typeof v === "string" ? v : v == null ? "" : String(v)}</span>;
}

export function OpportunityListViews({
  views: initialViews, canShare,
}: {
  views: ListView[];
  canShare: boolean;
}) {
  const [views, setViews] = useState(initialViews);
  const [activeId, setActiveId] = useState<string | null>(initialViews[0]?.id ?? null);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ListView | null>(null);
  const [loading, start] = useTransition();

  const active = views.find((v) => v.id === activeId) ?? null;
  const columns = knownColumns(active?.columns ?? DEFAULT_COLUMNS);

  const load = useCallback((view: ListView | null, nextPage: number, q: string) => {
    start(async () => {
      const res = await listOpportunities({
        columns: view?.columns ?? DEFAULT_COLUMNS,
        filters: view?.filters ?? [],
        sortField: view?.sort_field ?? null,
        sortDir: view?.sort_dir ?? "asc",
        search: q,
        page: nextPage,
      });
      setRows(res.rows);
      setTotal(res.total);
      setPage(nextPage);
    });
  }, []);

  useEffect(() => {
    load(active, 0, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const pages = Math.ceil(total / PAGE);

  return (
    <div className="space-y-4">
      <PageHeader title="Salesforce Opportunities" count={total.toLocaleString()}>
        <select
          className="h-8 rounded-md border bg-field px-2 text-sm"
          value={activeId ?? ""}
          onChange={(e) => setActiveId(e.target.value || null)}
        >
          {views.map((v) => (
            <option key={v.id} value={v.id}>{v.shared ? v.name : `${v.name} (private)`}</option>
          ))}
        </select>
        <Button variant="outline" size="sm" disabled={!active}
          onClick={() => active && setEditing({ ...active })}>
          <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
        </Button>
        <Button variant="outline" size="sm"
          onClick={() => setEditing({
            id: "", name: "", owner_member_id: null, shared: false,
            columns: [...DEFAULT_COLUMNS], filters: [], sort_field: null, sort_dir: "asc",
          })}>
          <Plus className="mr-1 h-3.5 w-3.5" /> New view
        </Button>
      </PageHeader>

      <div className="relative max-w-xs">
        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => { setSearch(e.target.value); load(active, 0, e.target.value); }}
          placeholder="Contact name or email"
          className="h-8 pl-8"
        />
      </div>

      <Panel>
        {rows.length === 0 ? (
          <Empty>{loading ? "Loading…" : "Nothing matches this view."}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  {columns.map((f) => (
                    <th key={f.key} className="whitespace-nowrap px-4 py-2 font-medium">{f.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={String(r.id)} className="border-b last:border-0 hover:bg-muted/30">
                    {columns.map((f, i) => (
                      <td key={f.key} className="max-w-[22rem] px-4 py-2">
                        <div className="truncate">
                          {i === 0 ? (
                            <a href={`/opportunities/${String(r.id)}`} className="hover:underline">
                              <Cell row={r} field={f} />
                            </a>
                          ) : (
                            <Cell row={r} field={f} />
                          )}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span className="tabular-nums">
            {(page * PAGE + 1).toLocaleString()}–{Math.min((page + 1) * PAGE, total).toLocaleString()} of {total.toLocaleString()}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0 || loading}
              onClick={() => load(active, page - 1, search)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page + 1 >= pages || loading}
              onClick={() => load(active, page + 1, search)}>Next</Button>
          </div>
        </div>
      )}

      {editing && (
        <ViewEditor
          view={editing}
          canShare={canShare}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setViews((vs) => {
              const rest = vs.filter((v) => v.id !== saved.id);
              return [...rest, saved].sort(
                (a, b) => Number(b.shared) - Number(a.shared) || a.name.localeCompare(b.name),
              );
            });
            setEditing(null);
            setActiveId(saved.id);
          }}
          onDeleted={(id) => {
            setViews((vs) => vs.filter((v) => v.id !== id));
            setEditing(null);
            setActiveId((cur) => (cur === id ? null : cur));
          }}
        />
      )}
    </div>
  );
}

/*
 * The editor is a panel on the right, which is where Salesforce puts it. Three
 * things in one place, because they are one decision: what the view is called,
 * which columns it shows and which rows it keeps.
 */
function ViewEditor({
  view, canShare, onClose, onSaved, onDeleted,
}: {
  view: ListView;
  canShare: boolean;
  onClose: () => void;
  onSaved: (v: ListView) => void;
  onDeleted: (id: string) => void;
}) {
  const [name, setName] = useState(view.name);
  const [shared, setShared] = useState(view.shared);
  const [columns, setColumns] = useState<string[]>(view.columns);
  const [filters, setFilters] = useState<Filter[]>(view.filters ?? []);
  const [sortField, setSortField] = useState<string | null>(view.sort_field);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(view.sort_dir);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function toggleColumn(key: string) {
    setColumns((cs) => (cs.includes(key) ? cs.filter((c) => c !== key) : [...cs, key]));
  }

  function save() {
    setError(null);
    start(async () => {
      const res = await saveView({
        id: view.id || undefined,
        name, shared, columns, filters, sortField, sortDir,
      });
      if (!res.success) { setError(res.error ?? "Could not save."); return; }
      onSaved({
        id: res.id ?? view.id, name, shared, columns, filters,
        owner_member_id: view.owner_member_id, sort_field: sortField, sort_dir: sortDir,
      });
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-lg flex-col border-l bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b px-5 py-3">
          <h2 className="text-lg font-semibold">{view.id ? "Edit view" : "New view"}</h2>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My open pipeline" />
          </div>

          {canShare && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
              Shared with everyone
            </label>
          )}

          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Columns ({columns.length})
            </h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {LIST_FIELDS.map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={columns.includes(f.key)}
                    onChange={() => toggleColumn(f.key)}
                  />
                  <span className="truncate">{f.label}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Filters</h3>
              <Button
                variant="outline" size="sm" className="ml-auto"
                onClick={() => setFilters((fs) => [...fs, { field: "stage", op: "equals", value: "" }])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Add filter
              </Button>
            </div>

            {filters.length === 0 ? (
              <p className="text-sm text-muted-foreground">Every opportunity you can see.</p>
            ) : (
              <div className="space-y-2">
                {filters.map((f, i) => {
                  const field = FIELD_BY_KEY.get(f.field);
                  const ops = operatorsFor(field?.type ?? "text");
                  const picklist = field?.picklist === "stage" ? ALL_STAGES
                    : field?.picklist === "lead_status" ? LEAD_STATUSES : null;
                  return (
                    <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-md border p-2">
                      <select
                        className="h-8 rounded-md border bg-field px-2 text-sm"
                        value={f.field}
                        onChange={(e) => {
                          const nf = FIELD_BY_KEY.get(e.target.value)!;
                          setFilters((fs) => fs.map((x, j) => j === i
                            ? { field: nf.key, op: operatorsFor(nf.type)[0], value: "" } : x));
                        }}
                      >
                        {LIST_FIELDS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                      </select>

                      <select
                        className="h-8 rounded-md border bg-field px-2 text-sm"
                        value={f.op}
                        onChange={(e) => setFilters((fs) => fs.map((x, j) => j === i
                          ? { ...x, op: e.target.value as Operator } : x))}
                      >
                        {ops.map((o) => <option key={o} value={o}>{OPERATOR_LABELS[o]}</option>)}
                      </select>

                      {!opTakesNoValue(f.op) && (
                        picklist ? (
                          <select
                            className="h-8 min-w-40 rounded-md border bg-field px-2 text-sm"
                            value={f.value ?? ""}
                            onChange={(e) => setFilters((fs) => fs.map((x, j) => j === i
                              ? { ...x, value: e.target.value } : x))}
                          >
                            <option value="">—</option>
                            {picklist.map((v) => <option key={v} value={v}>{v}</option>)}
                          </select>
                        ) : (
                          <Input
                            className="h-8 w-40"
                            value={f.value ?? ""}
                            placeholder={field?.type === "date" ? "today or 2026-09-30" : "value"}
                            onChange={(e) => setFilters((fs) => fs.map((x, j) => j === i
                              ? { ...x, value: e.target.value } : x))}
                          />
                        )
                      )}

                      <Button
                        variant="ghost" size="icon" className="ml-auto h-8 w-8"
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
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sort by</h3>
            <div className="flex gap-1.5">
              <select
                className="h-8 rounded-md border bg-field px-2 text-sm"
                value={sortField ?? ""}
                onChange={(e) => setSortField(e.target.value || null)}
              >
                <option value="">Last modified</option>
                {LIST_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              <select
                className="h-8 rounded-md border bg-field px-2 text-sm"
                value={sortDir}
                onChange={(e) => setSortDir(e.target.value as "asc" | "desc")}
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </div>
          </section>

          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>

        <footer className="flex items-center gap-2 border-t px-5 py-3">
          {view.id && (
            <Button
              variant="outline" size="sm" disabled={busy}
              onClick={() => start(async () => {
                const res = await deleteView(view.id);
                if (res.success) onDeleted(view.id);
                else setError(res.error ?? "Could not delete.");
              })}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
            </Button>
          )}
          <Button className="ml-auto" size="sm" disabled={busy} onClick={save}>Save</Button>
        </footer>
      </aside>
    </div>
  );
}
