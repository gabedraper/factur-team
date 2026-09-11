"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Chip } from "@/components/pipeline/bits";
import { Surface } from "@/components/ui/surface";
import { Table, TableScroll, THead, TBody, TR, TH, TD, TDIdentity } from "@/components/ui/table";
import { CompanyLogo } from "@/components/ui/thumbnail";
import { ListEmpty } from "@/components/list/EmptyState";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { TargetAccounts } from "@/components/pipeline/TargetAccounts";
import { TargetContacts } from "@/components/pipeline/TargetContacts";
import {
  BOTH_STAGE_FIELDS,
  type ClientRow, type PipelineScope, type StageFields,
} from "@/lib/pipeline/targets";

/*
 * Everyone's target companies, filtered the way their job is stacked.
 *
 * A rep gets one flat list of their own clients. A lead gets a "held by"
 * filter over their reports' clients. A manager gets a team lead filter, and
 * an account manager filter scoped to whichever team lead is picked.
 *
 * This used to be a tree -- team leads containing account managers
 * containing clients, each with its own expand/collapse. Right for one
 * person drilling into one branch; a manager opening several branches at
 * once got a wall of nested, half-expanded accordions with no way to compare
 * two clients under different managers side by side. Filters at the top
 * replace that: pick who you're looking at, get one flat, sortable-by-eye
 * list, same as a rep already had.
 *
 * The stage counts are a table with a column per band rather than a row of
 * chips per client. Chips packed against the right edge put every client's
 * Cold Target in a different place, so comparing two clients meant reading
 * both labels instead of glancing down a column -- which is the only thing
 * anyone wants from a screen of fifteen clients side by side. A fixed column
 * per band costs the empty cells and is worth it.
 *
 * The unassigned bucket stays in the code but is usually empty now. It only
 * ever filled up because former clients were being counted as live: across
 * the 167 current clients with open pipeline, every one has a team lead. If
 * one shows up with none it is worth seeing, not worth hiding.
 */

type Grouping = {
  id: (r: ClientRow) => string | null;
  name: (r: ClientRow) => string | null;
  empty: string;
  /** What the "everyone" option reads as -- only the top filter says "Everyone". */
  allLabel: string;
};

const LEVELS: Record<PipelineScope["level"], Grouping[]> = {
  rep: [],
  lead: [
    { id: (r) => r.held_by_id, name: (r) => r.held_by_name, empty: "Held by you", allLabel: "Everyone" },
  ],
  admin: [
    { id: (r) => r.team_lead_id, name: (r) => r.team_lead_name, empty: "No team lead", allLabel: "Everyone" },
    { id: (r) => r.account_manager_id, name: (r) => r.account_manager_name, empty: "No account manager", allLabel: "All account managers" },
  ],
};

const UNASSIGNED = "__none";
const ALL = "__all";

/** One option per distinct value of a level, with a client count to filter by eye. */
function distinctOptions(rows: ClientRow[], level: Grouping) {
  const buckets = new Map<string, { label: string; count: number }>();
  for (const r of rows) {
    const rawId = level.id(r);
    const id = rawId ?? UNASSIGNED;
    const label = (rawId ? level.name(r) : null) ?? level.empty;
    const b = buckets.get(id);
    if (b) b.count += 1;
    else buckets.set(id, { label, count: 1 });
  }
  return [...buckets.entries()]
    .map(([id, b]) => ({ id, ...b }))
    /* The unassigned bucket sinks to the bottom however large it is, so it
       never sits above a real person. */
    .sort((a, b) => Number(a.id === UNASSIGNED) - Number(b.id === UNASSIGNED) || b.count - a.count);
}

/* Which list opens inside a client. The grouping, the counts and the role
   hierarchy are the same either way; only the thing you expand into differs. */
export type ClientView = "companies" | "contacts";

/*
 * One number per client, and which number depends on the screen.
 *
 * These rows carried a column per stage -- eight rolled-up bands on Target
 * Companies, and up to thirty-two raw Salesforce values on Target Contacts.
 * Accurate, and unreadable: a wall of small chips that has to be scanned across
 * before you can compare two clients on the thing you came to compare them on.
 * The breakdown belongs inside a client, where the target company and target
 * contact lists already show it, not on the row you use to choose which client
 * to open.
 *
 * Companies counts companies; Contacts counts pursuits. The per-stage maps
 * still come back from pipeline_my_clients and are simply not drawn -- they
 * cost nothing to carry and something to remove.
 */
function totalFor(view: ClientView): (r: ClientRow) => number {
  return view === "companies" ? (r) => r.companies : (r) => r.pursuits;
}

export function ClientGroups({
  scope, rows, stageFields = BOTH_STAGE_FIELDS, view = "companies", domains, initialOpen = null, error = null,
}: {
  scope: PipelineScope;
  rows: ClientRow[];
  stageFields?: StageFields;
  view?: ClientView;
  /** Client id to email domain, for the logo. */
  domains: Record<string, string>;
  /** Opened on arrival -- how a per-client view lands on that client's list. */
  initialOpen?: string | null;
  error?: string | null;
}) {
  const levels = LEVELS[scope.level];
  const totalOf = useMemo(() => totalFor(view), [view]);
  const [openClient, setOpenClient] = useState<string | null>(initialOpen);
  // One selection per grouping level; null means that level's filter is at
  // "All". Picking a value at level i clears anything picked at levels after
  // it -- the account manager filter's own options are scoped to whichever
  // team lead is picked, so a stale pick there could point at nobody.
  const [selected, setSelected] = useState<(string | null)[]>(() => levels.map(() => null));

  // Rows remaining after each level's filter, in order -- scopedRows[0] is
  // everything, scopedRows[n] is what's left after all n filters. Each
  // level's own dropdown options come from the stage *before* it, so
  // picking a team lead narrows the account manager list without the
  // account manager filter narrowing itself out of existence.
  const scopedRows = useMemo(() => {
    const stages: ClientRow[][] = [rows];
    levels.forEach((level, i) => {
      const prior = stages[i];
      const pick = selected[i];
      stages.push(pick ? prior.filter((r) => (level.id(r) ?? UNASSIGNED) === pick) : prior);
    });
    return stages;
  }, [rows, levels, selected]);

  const filteredRows = scopedRows[scopedRows.length - 1];

  function setLevel(i: number, id: string | null) {
    setSelected((s) => {
      const next = [...s];
      next[i] = id;
      for (let j = i + 1; j < next.length; j++) next[j] = null;
      return next;
    });
  }

  const noun = view === "contacts" ? "target contacts" : "target companies";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {levels.map((level, i) => {
          const options = distinctOptions(scopedRows[i], level);
          // Nothing to filter by (a rep's own single bucket, or a manager
          // whose team all reports to one lead) -- no point in a dropdown
          // with one answer.
          if (options.length <= 1) return null;
          return (
            <Select
              key={i}
              value={selected[i] ?? ALL}
              onValueChange={(v) => setLevel(i, v === ALL ? null : v)}
            >
              <SelectTrigger className="h-8 w-auto min-w-[10rem] gap-2 text-meta">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>
                  {level.allLabel} ({scopedRows[i].length})
                </SelectItem>
                {options.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label} ({o.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        })}
      </div>

      {error || filteredRows.length === 0 ? (
        <ListEmpty noun={noun} error={error} />
      ) : (
        <Surface pad="none">
          <ClientList
            rows={filteredRows}
            openClient={openClient}
            setOpenClient={setOpenClient}
            stageFields={stageFields}
            view={view}
            totalOf={totalOf}
            domains={domains}
          />
        </Surface>
      )}
    </div>
  );
}

function ClientList({
  rows, openClient, setOpenClient, stageFields, view, totalOf, domains,
}: {
  rows: ClientRow[];
  openClient: string | null;
  setOpenClient: (id: string | null) => void;
  stageFields: StageFields;
  view: ClientView;
  totalOf: (r: ClientRow) => number;
  domains: Record<string, string>;
}) {
  return (
    <TableScroll>
      <Table>
        <THead>
          <TR>
            <TH>Client</TH>
            <TH numeric>Total</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((c) => {
            const open = openClient === c.client_id;
            return (
              <Fragment key={c.client_id}>
                <TR interactive onClick={() => setOpenClient(open ? null : c.client_id)} className="cursor-pointer">
                  <TDIdentity
                    thumb={<CompanyLogo name={c.client_name} domain={domains[c.client_id]} size={24} />}
                    name={
                      /* A button inside the row, so the row opens from the
                         keyboard too -- a clickable <tr> is mouse-only. */
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={(e) => { e.stopPropagation(); setOpenClient(open ? null : c.client_id); }}
                        className="flex max-w-full items-center gap-1.5 font-medium"
                      >
                        <span className="truncate">{c.client_name}</span>
                        <ChevronRight
                          className={"h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-fast ease-out " + (open ? "rotate-90" : "")}
                        />
                      </button>
                    }
                    sub={!c.client_active && c.client_status ? <Chip colour="slate">{c.client_status}</Chip> : undefined}
                  />
                  <TD numeric className="font-semibold">{totalOf(c).toLocaleString()}</TD>
                </TR>

                {open && (
                  <TR>
                    <TD colSpan={2} className="bg-muted/30 py-3">
                      {view === "contacts" ? (
                        <TargetContacts clientId={c.client_id} stageFields={stageFields} />
                      ) : (
                        <TargetAccounts
                          clientId={c.client_id}
                          clientName={c.client_name}
                          stageFields={stageFields}
                        />
                      )}
                    </TD>
                  </TR>
                )}
              </Fragment>
            );
          })}
        </TBody>
      </Table>
    </TableScroll>
  );
}
