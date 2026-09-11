"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Surface } from "@/components/ui/surface";
import { Table, TableScroll, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { BulkBar, BulkAction, SelectAllBox } from "@/components/list/BulkBar";
import { Chip } from "@/components/pipeline/bits";
import { updateOpportunity } from "@/actions/pipeline";
import { STAGE_GROUPS } from "@/lib/pipeline/picklists";
import { progressTone } from "@/lib/pipeline/targets";
import { toE164 } from "@/lib/phone";
import { useDialer } from "@/components/work-panel/dialer-context";
import type { ListField } from "@/lib/pipeline/list-views";

/*
 * The rows of the Opportunities list, as a table or as a board.
 *
 * Everything that decides *which* rows -- the view, the search, the page --
 * lives in the URL and is resolved on the server. This only draws what it is
 * given, and holds the two things that genuinely are local: which rows are
 * ticked, and a card mid-drag.
 */

export type Row = Record<string, unknown>;

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

function contactName(row: Row) {
  const c = embed(row, "crm_contacts");
  return [c?.first_name, c?.last_name].filter(Boolean).join(" ");
}

function shortDate(v: unknown) {
  if (!v || typeof v !== "string") return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" });
}

/* Plain text for a field -- what the CSV holds, and what a cell shows when the
   field has no special look. */
function text(row: Row, field: ListField): string {
  if (field.key === "contact_name") return contactName(row);
  const v = raw(row, field.path);
  if (field.type === "boolean") return v ? "Yes" : "";
  return v == null ? "" : String(v);
}

/* One place that knows how each field looks, so a column added to the
   catalogue renders without touching the table. */
function Cell({ row, field }: { row: Row; field: ListField }) {
  if (field.key === "contact_name") {
    return <span className="font-medium">{contactName(row) || "—"}</span>;
  }
  const v = raw(row, field.path);
  if (field.type === "boolean") {
    return v ? <Check className="h-4 w-4 text-success" aria-label="Yes" /> : null;
  }
  if (field.type === "date") {
    return <span className="tabular-nums">{shortDate(v)}</span>;
  }
  if (field.key === "account_domain" && typeof v === "string" && v) {
    return (
      <a href={`https://${v}`} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
        {v}
      </a>
    );
  }
  if (field.type === "picklist" && typeof v === "string" && v) {
    return <Chip colour={progressTone(v)}>{v}</Chip>;
  }
  if (field.key === "contact_phone" && typeof v === "string" && v) {
    return <PhoneCell row={row} value={v} />;
  }
  return <span className="text-muted-foreground">{text(row, field)}</span>;
}

/*
 * The number itself is the button. It dials as this opportunity -- the panel
 * switches to this contact, and the call is tagged and logged against this
 * record -- rather than as a bare number, which would leave the panel showing
 * whoever was opened last and offer to log the call against them.
 *
 * toE164 decides what is dialable, the same as every other phone field:
 * Salesforce numbers carry extensions, ".0" import artifacts and two numbers
 * in one box, and those stay plain text rather than a button that fails.
 */
function PhoneCell({ row, value }: { row: Row; value: string }) {
  const { callOpportunity } = useDialer();
  const dialable = toE164(value);
  if (!dialable) {
    return <span className="text-muted-foreground" title="Not a dialable number">{value}</span>;
  }
  return (
    <button
      type="button"
      title={`Call ${contactName(row) || dialable}`}
      onClick={() =>
        callOpportunity({ opportunityId: String(row.id), phoneNumber: value, contactName: contactName(row) })
      }
      className="tabular-nums text-primary underline-offset-2 hover:underline"
    >
      {value}
    </button>
  );
}

export function OpportunityTable({ rows, columns }: { rows: Row[]; columns: ListField[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const ids = rows.map((r) => String(r.id));
  const all = rows.length > 0 && selected.length === rows.length;
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  /* Built from the rows on the page, in the columns on screen -- exactly what
     was selected, with no second query that could disagree with it. */
  const exportCsv = () => {
    const chosen = rows.filter((r) => selected.includes(String(r.id)));
    const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = [
      columns.map((f) => cell(f.label)).join(","),
      ...chosen.map((r) => columns.map((f) => cell(text(r, f))).join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `opportunities-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <BulkBar count={selected.length} noun="opportunity" onClear={() => setSelected([])}>
        <BulkAction onClick={exportCsv}>Export</BulkAction>
      </BulkBar>
      <Surface pad="none">
        <TableScroll>
          <Table>
            <THead>
              <TR>
                <TH className="w-8">
                  <SelectAllBox
                    checked={all}
                    indeterminate={selected.length > 0 && !all}
                    onChange={(on) => setSelected(on ? ids : [])}
                  />
                </TH>
                {columns.map((f) => (
                  <TH key={f.key} className="whitespace-nowrap">{f.label}</TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => {
                const id = String(r.id);
                return (
                  <TR key={id} interactive>
                    <TD>
                      <input
                        type="checkbox"
                        aria-label={`Select ${contactName(r) || "opportunity"}`}
                        checked={selected.includes(id)}
                        onChange={() => toggle(id)}
                        className="h-3.5 w-3.5 cursor-pointer accent-[hsl(var(--primary))]"
                      />
                    </TD>
                    {columns.map((f, i) => (
                      <TD key={f.key} className="max-w-[22rem]">
                        <div className="truncate">
                          {i === 0 ? (
                            <Link href={`/opportunities/${id}`} className="underline-offset-2 hover:underline">
                              <Cell row={r} field={f} />
                            </Link>
                          ) : (
                            <Cell row={r} field={f} />
                          )}
                        </div>
                      </TD>
                    ))}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableScroll>
      </Surface>
    </div>
  );
}

/*
 * The board: one column per stage, and dragging a card to another column
 * changes its stage -- through updateOpportunity, the same write the record
 * page's stage picker makes, so history is recorded and Salesforce hears
 * about it the same way.
 *
 * Every stage gets a column, including empty ones, because an empty column is
 * still somewhere a card can be moved to. Empty columns are drawn narrow so
 * twenty-two stages do not push the busy ones off the screen.
 */
export function OpportunityBoard({ rows }: { rows: Row[] }) {
  const [items, setItems] = useState(rows);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  const move = (id: string, stage: string) => {
    const before = items;
    const current = before.find((r) => String(r.id) === id);
    if (!current || current.stage === stage) return;
    setError(null);
    // Moved at once, and put back if the write is refused.
    setItems((xs) => xs.map((r) => (String(r.id) === id ? { ...r, stage } : r)));
    start(async () => {
      const res = await updateOpportunity(id, { stage });
      if (!res.ok) {
        setItems(before);
        setError(res.error);
      }
    });
  };

  const byStage = new Map<string, Row[]>();
  for (const r of items) {
    const s = String(r.stage ?? "");
    byStage.set(s, [...(byStage.get(s) ?? []), r]);
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-body text-destructive">{error}</p>}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {STAGE_GROUPS.flatMap((g) => g.values).map((stage) => {
          const cards = byStage.get(stage) ?? [];
          const target = over === stage && dragging !== null;
          return (
            <section
              key={stage}
              aria-label={stage}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                setOver(stage);
              }}
              onDragLeave={() => setOver((o) => (o === stage ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging) move(dragging, stage);
                setDragging(null);
                setOver(null);
              }}
              className={cn(
                "flex shrink-0 flex-col gap-2 rounded-md p-1.5 transition-colors duration-fast ease-out",
                cards.length ? "w-64" : "w-36",
                target ? "bg-accent" : "bg-lane",
              )}
            >
              <h2 className="flex items-baseline justify-between gap-2 px-1.5 pt-1 text-meta font-semibold">
                <span className="truncate" title={stage}>{stage}</span>
                <span className="tabular-nums text-muted-foreground">{cards.length}</span>
              </h2>
              {cards.map((r) => {
                const id = String(r.id);
                const account = embed(r, "crm_accounts")?.name;
                const client = embed(r, "org_clients")?.name;
                return (
                  <article
                    key={id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      setDragging(id);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    className={cn(
                      "cursor-grab rounded-md bg-card p-card-tight text-body transition-shadow duration-base ease-out hover:shadow-overlay active:cursor-grabbing",
                      dragging === id && "opacity-50",
                    )}
                  >
                    <Link href={`/opportunities/${id}`} className="block truncate font-medium underline-offset-2 hover:underline">
                      {contactName(r) || "Unnamed contact"}
                    </Link>
                    {typeof account === "string" && account && (
                      <p className="truncate text-meta text-muted-foreground">{account}</p>
                    )}
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-meta text-muted-foreground">
                      <span className="truncate">{typeof client === "string" ? client : ""}</span>
                      {shortDate(r.next_action_date) && (
                        <span className="shrink-0 tabular-nums">{shortDate(r.next_action_date)}</span>
                      )}
                    </div>
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
