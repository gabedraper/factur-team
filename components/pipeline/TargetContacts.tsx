"use client";

import { Fragment, useCallback, useEffect, useState, useTransition } from "react";
import { Building2, ChevronLeft, ChevronRight, Columns3, Phone as PhoneIcon, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Chip, Empty, Panel } from "@/components/pipeline/bits";
import { useDialer } from "@/components/work-panel/dialer-context";
import { toE164 } from "@/lib/phone";
import { listTargetContacts } from "@/actions/pipeline-targets";
import {
  TARGET_STAGES, TARGET_STAGE_TONE as STAGE_TONE, BOTH_STAGE_FIELDS,
  type StageFields, type TargetContact,
} from "@/lib/pipeline/targets";
import { TableScroll, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

/*
 * A client's people, grouped by the company they work at.
 *
 * Target Companies answers "where do I spend the day". This answers the next
 * question -- who do I ring -- and so it puts the number, the last note and the
 * next action on the row rather than behind a panel. Nobody should have to open
 * something to find out whether a call is worth making.
 *
 * Grouping is drawn from the order the rows arrive in, not from nesting: the
 * query sorts by company, and a header appears wherever the name changes. That
 * is what lets this stay server-paged, which it has to be -- the largest client
 * is pursuing 41,260 companies and rather more people than that.
 *
 * A company's people can straddle a page boundary. That is true of every paged
 * list that groups, and the alternative -- paging by company and fetching all
 * their people -- makes one enormous page whenever a company has hundreds.
 */

const PAGE = 50;

function shortDate(v: string | null) {
  if (!v) return null;
  return new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" });
}

const COLUMNS_KEY = "factur-target-contact-columns";

type ColumnKey =
  | "contact" | "company" | "title" | "phone" | "email" | "progress"
  | "stage" | "lead_status" | "target_stage" | "next_action" | "updates";

type Column = {
  key: ColumnKey;
  /* A function because the progress column is named after whichever ladder
     the viewer's role reads, and that is a setting somebody can change. */
  label: (f: StageFields) => string;
  className?: string;
  cell: (r: TargetContact, f: StageFields) => React.ReactNode;
};

/*
 * Every column this screen can show, in the order they are offered.
 *
 * All of it comes from the row the query already returns, so choosing a column
 * costs nothing extra -- the same reason both progress fields ride along.
 */
const COLUMNS: Column[] = [
  {
    key: "contact",
    label: () => "Contact",
    cell: (r) => (
      <a href={`/opportunities/${r.opportunity_id}`} className="font-medium hover:underline">
        {[r.first_name, r.last_name].filter(Boolean).join(" ") || r.email || "—"}
      </a>
    ),
  },
  {
    key: "company",
    label: () => "Company",
    className: "max-w-[14rem] text-muted-foreground",
    cell: (r) => <div className="truncate" title={r.account_name ?? undefined}>{r.account_name}</div>,
  },
  {
    key: "title",
    label: () => "Title",
    className: "max-w-[14rem] text-muted-foreground",
    cell: (r) => <div className="truncate" title={r.title ?? undefined}>{r.title}</div>,
  },
  { key: "phone", label: () => "Phone", cell: (r) => <PhoneCell value={r.phone} /> },
  {
    key: "email",
    label: () => "Email",
    className: "max-w-[16rem] text-muted-foreground",
    cell: (r) => <div className="truncate" title={r.email ?? undefined}>{r.email}</div>,
  },
  {
    key: "progress",
    label: (f) =>
      f.show_stage && f.show_lead_status ? "Stage / lead status" : f.show_stage ? "Stage" : "Lead status",
    cell: (r, f) => (
      <>
        <Chip colour={STAGE_TONE[r.target_stage] ?? "slate"}>
          {f.show_stage ? r.stage : (r.lead_status ?? r.stage)}
        </Chip>
        {f.show_stage && f.show_lead_status && r.lead_status && (
          <div className="mt-0.5 text-xs text-muted-foreground">{r.lead_status}</div>
        )}
      </>
    ),
  },
  /* The raw fields on their own, for somebody whose role reads one ladder and
     who still wants the other on screen. */
  {
    key: "stage",
    label: () => "Deal stage",
    className: "text-muted-foreground",
    cell: (r) => <span className="whitespace-nowrap">{r.stage}</span>,
  },
  {
    key: "lead_status",
    label: () => "Prospecting lead status",
    className: "text-muted-foreground",
    cell: (r) => <span className="whitespace-nowrap">{r.lead_status}</span>,
  },
  {
    key: "target_stage",
    label: () => "Target stage",
    cell: (r) => <Chip colour={STAGE_TONE[r.target_stage] ?? "slate"}>{r.target_stage}</Chip>,
  },
  {
    key: "next_action",
    label: () => "Next action",
    className: "tabular-nums",
    cell: (r) => shortDate(r.next_action_date),
  },
  {
    key: "updates",
    label: () => "Updates",
    className: "max-w-[24rem] text-xs text-muted-foreground",
    cell: (r) => <div className="truncate" title={r.updates ?? undefined}>{r.updates}</div>,
  },
];

const COLUMN_BY_KEY = new Map(COLUMNS.map((c) => [c.key, c] as const));

/* What everybody had before they could choose, so nobody who never opens the
   picker sees the screen move. */
const DEFAULT_COLUMNS: ColumnKey[] = [
  "contact", "title", "phone", "email", "progress", "next_action", "updates",
];

export function TargetContacts({
  clientId, stageFields = BOTH_STAGE_FIELDS,
}: {
  clientId: string;
  stageFields?: StageFields;
}) {
  const [rows, setRows] = useState<TargetContact[]>([]);
  const [total, setTotal] = useState(0);
  const [stages, setStages] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [columnKeys, setColumnKeys] = useState<ColumnKey[]>(DEFAULT_COLUMNS);
  const [loading, start] = useTransition();

  const load = useCallback((next: { stages?: string[]; search?: string; page?: number }) => {
    const s = next.stages ?? stages;
    const q = next.search ?? search;
    const p = next.page ?? 0;
    start(async () => {
      const res = await listTargetContacts({
        clientId, stages: s, search: q, limit: PAGE, offset: p * PAGE,
      });
      setRows(res.rows);
      setTotal(res.total);
      setPage(p);
    });
  }, [clientId, stages, search]);

  useEffect(() => {
    load({ page: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  /*
   * The layout belongs to the reader, not to the client being read, so it is
   * one stored list rather than one per client group.
   *
   * Unknown keys are dropped on the way in: a column can be renamed or retired
   * without leaving somebody with a layout that no longer renders.
   */
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? "null");
      if (!Array.isArray(saved)) return;
      const keys = saved.filter((k: unknown): k is ColumnKey => COLUMN_BY_KEY.has(k as ColumnKey));
      if (keys.length) setColumnKeys(keys);
    } catch {
      // Corrupt value from an older build -- the default layout is fine.
    }
  }, []);

  function setLayout(next: ColumnKey[]) {
    localStorage.setItem(COLUMNS_KEY, JSON.stringify(next));
    setColumnKeys(next);
  }

  function toggleStage(s: string) {
    const next = stages.includes(s) ? stages.filter((x) => x !== s) : [...stages, s];
    setStages(next);
    load({ stages: next, page: 0 });
  }

  const pages = Math.ceil(total / PAGE);
  const columns = columnKeys.flatMap((k) => COLUMN_BY_KEY.get(k) ?? []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative w-56 shrink-0">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); load({ search: e.target.value, page: 0 }); }}
            placeholder="Name, title, email or company"
            className="h-8 pl-8"
          />
        </div>
        {TARGET_STAGES.map((s) => {
          const on = stages.includes(s);
          return (
            <button
              key={s}
              onClick={() => toggleStage(s)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                on ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {s}
            </button>
          );
        })}
        <ColumnPicker keys={columnKeys} stageFields={stageFields} onChange={setLayout} />
      </div>

      <Panel>
        {rows.length === 0 ? (
          <Empty>{loading ? "Loading…" : "No contacts match."}</Empty>
        ) : (
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  {columns.map((c) => (
                    <TH key={c.key}>{c.label(stageFields)}</TH>
                  ))}
                </TR>
              </THead>
              <TBody>
                {rows.map((r, i) => {
                  /* The header is drawn wherever the company changes, which is
                     what makes the sort order do the grouping. */
                  const newCompany = i === 0 || rows[i - 1].account_name !== r.account_name;
                  return (
                    <Fragment key={r.opportunity_id}>
                      {newCompany && (
                        <TR className="bg-muted/20">
                          <TD colSpan={columns.length} >
                            <span className="flex items-center gap-2 text-xs font-semibold">
                              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                              {r.account_name ?? "No company"}
                            </span>
                          </TD>
                        </TR>
                      )}
                      <TR>
                        {columns.map((c) => (
                          <TD key={c.key} className={c.className}>{c.cell(r, stageFields)}</TD>
                        ))}
                      </TR>
                    </Fragment>
                  );
                })}
              </TBody>
            </Table>
          </TableScroll>
        )}
      </Panel>

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span className="tabular-nums">
            {(page * PAGE + 1).toLocaleString()}–{Math.min((page + 1) * PAGE, total).toLocaleString()} of {total.toLocaleString()}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0 || loading}
              onClick={() => load({ page: page - 1 })}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page + 1 >= pages || loading}
              onClick={() => load({ page: page + 1 })}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/*
 * Add, remove and reorder the columns.
 *
 * People work different parts of the pipeline, so one fixed layout leaves
 * everybody either scrolling past columns they never read or missing one they
 * need. The choice is kept in the browser, which is what makes it survive a
 * reload without a migration -- it does not follow somebody to another machine,
 * and there is no team default; both of those want a column on the member row.
 *
 * Reordering is two buttons rather than a drag: eleven columns is a short list,
 * and a drag would mean carrying a library for it.
 */
function ColumnPicker({
  keys, stageFields, onChange,
}: {
  keys: ColumnKey[];
  stageFields: StageFields;
  onChange: (next: ColumnKey[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const shown = keys.flatMap((k) => COLUMN_BY_KEY.get(k) ?? []);
  const hidden = COLUMNS.filter((c) => !keys.includes(c.key));

  function move(i: number, by: number) {
    const j = i + by;
    if (j < 0 || j >= keys.length) return;
    const next = [...keys];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <div className="relative ml-auto">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Columns3 className="mr-1.5 h-3.5 w-3.5" />
        Columns
      </Button>

      {open && (
        <>
          {/* Click-away. A transparent sheet rather than a document listener,
              so it cannot outlive the component. */}
          <button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full z-20 mt-1 w-80 rounded-md bg-popover p-2 shadow-overlay">
            <div className="flex items-center gap-2 px-2 pb-1">
              <span className="text-meta font-medium text-muted-foreground">Your columns</span>
              <button
                type="button"
                onClick={() => onChange(DEFAULT_COLUMNS)}
                className="ml-auto text-meta text-muted-foreground hover:text-foreground"
              >
                Reset
              </button>
            </div>

            {shown.map((c, i) => (
              <div key={c.key} className="flex items-center gap-1">
                <span className="flex-1 truncate px-2 py-1.5 text-body">{c.label(stageFields)}</span>
                <button
                  type="button"
                  title={`Move ${c.label(stageFields)} left`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  className="rounded-sm p-1 text-muted-foreground disabled:opacity-30 hover:text-foreground"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title={`Move ${c.label(stageFields)} right`}
                  disabled={i === shown.length - 1}
                  onClick={() => move(i, 1)}
                  className="rounded-sm p-1 text-muted-foreground disabled:opacity-30 hover:text-foreground"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  /* A table with no columns is a table nobody can get back
                     from, so the last one cannot be removed. */
                  disabled={shown.length === 1}
                  onClick={() => onChange(keys.filter((k) => k !== c.key))}
                  className="rounded-sm px-2 py-1 text-meta text-muted-foreground disabled:opacity-30 hover:text-foreground"
                >
                  Remove
                </button>
              </div>
            ))}

            {hidden.length > 0 && (
              <>
                <p className="mt-2 px-2 pb-1 text-meta font-medium text-muted-foreground">Add a column</p>
                {hidden.map((c) => (
                  <div key={c.key} className="flex items-center gap-1">
                    <span className="flex-1 truncate px-2 py-1.5 text-body text-muted-foreground">
                      {c.label(stageFields)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onChange([...keys, c.key])}
                      className="rounded-sm px-2 py-1 text-meta text-muted-foreground hover:text-foreground"
                    >
                      Add
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/*
 * Same rule as everywhere else: toE164 decides whether the number is dialable,
 * because Salesforce phone fields carry extensions, spreadsheet ".0" artifacts
 * and occasionally two numbers in one box.
 */
function PhoneCell({ value }: { value: string | null }) {
  const { requestCall } = useDialer();
  const dialable = toE164(value);
  if (!value) return null;

  return (
    <span className="flex items-center gap-2 whitespace-nowrap">
      <span className="tabular-nums">{value}</span>
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="h-6 w-6 shrink-0"
        title={dialable ? `Call ${dialable}` : "This number doesn't look valid"}
        disabled={!dialable}
        onClick={(e) => { e.stopPropagation(); if (dialable) requestCall(dialable); }}
      >
        <PhoneIcon className="h-3.5 w-3.5" />
      </Button>
    </span>
  );
}
