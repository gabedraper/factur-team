"use client";

import { Fragment, useMemo, useState } from "react";
import { Building2, ChevronRight } from "lucide-react";
import { Chip, Empty, Panel } from "@/components/pipeline/bits";
import { TargetAccounts } from "@/components/pipeline/TargetAccounts";
import {
  TARGET_STAGES, TARGET_STAGE_TONE as STAGE_TONE,
  BOTH_STAGE_FIELDS,
  type ClientRow, type PipelineScope, type StageFields,
} from "@/lib/pipeline/targets";

/*
 * Everyone's target companies, stacked the way their job is stacked.
 *
 * A rep gets one list of their clients. A lead gets their reports, and each
 * report's clients under them. A manager gets team leads, then account
 * managers, then clients. Same rows, nested one level deeper each time you are
 * responsible for more people.
 *
 * One client open at a time, by design -- the point of this screen is to choose
 * where to spend the day, and three clients expanded at once is not a choice,
 * it is a wall. Groups are free to be open together, because those are how you
 * get to the client rather than the thing you are reading.
 *
 * The stage counts are a table with a column per band rather than a row of
 * chips per client. Chips packed against the right edge put every client's
 * Cold Target in a different place, so comparing two clients meant reading both
 * labels instead of glancing down a column -- which is the only thing anyone
 * wants from a screen of fifteen clients side by side. A fixed column per band
 * costs the empty cells and is worth it.
 *
 * The unassigned buckets stay in the code but are usually empty now. They only
 * ever filled up because former clients were being counted as live: across the
 * 167 current clients with open pipeline, every one has a team lead. If one
 * shows up with none it is worth seeing, not worth hiding.
 */

type Grouping = {
  id: (r: ClientRow) => string | null;
  name: (r: ClientRow) => string | null;
  empty: string;
};

const LEVELS: Record<PipelineScope["level"], Grouping[]> = {
  rep: [],
  lead: [
    { id: (r) => r.held_by_id, name: (r) => r.held_by_name, empty: "Held by you" },
  ],
  admin: [
    { id: (r) => r.team_lead_id, name: (r) => r.team_lead_name, empty: "No team lead" },
    { id: (r) => r.account_manager_id, name: (r) => r.account_manager_name, empty: "No account manager" },
  ],
};

const UNASSIGNED = " none";

type Node = {
  key: string;
  label: string;
  clients: ClientRow[];
  children: Node[];
  /* Clients in this branch, at every depth. The header used to show
     children.length, which at the top of a manager's view is a count of
     account managers reading as though it were a count of clients. */
  clientCount: number;
  total: number;
};

function build(rows: ClientRow[], levels: Grouping[], path = ""): Node[] {
  if (levels.length === 0) return [];
  const [level, ...rest] = levels;

  const buckets = new Map<string, { label: string; rows: ClientRow[] }>();
  for (const r of rows) {
    const id = level.id(r);
    const key = id ?? UNASSIGNED;
    const label = (id ? level.name(r) : null) ?? level.empty;
    const bucket = buckets.get(key);
    if (bucket) bucket.rows.push(r);
    else buckets.set(key, { label, rows: [r] });
  }

  return [...buckets.entries()]
    .map(([key, b]) => ({
      key: path + "/" + key,
      label: b.label,
      clients: rest.length === 0 ? b.rows : [],
      children: build(b.rows, rest, path + "/" + key),
      clientCount: b.rows.length,
      total: b.rows.reduce((n, r) => n + r.companies, 0),
    }))
    /* Biggest book of business first, and the unassigned pile sinks to the
       bottom however large it is, so it never sits above a real person. */
    .sort(
      (a, b) =>
        Number(a.key.endsWith(UNASSIGNED)) - Number(b.key.endsWith(UNASSIGNED)) ||
        b.total - a.total
    );
}

export function ClientGroups({
  scope, rows, stageFields = BOTH_STAGE_FIELDS,
}: {
  scope: PipelineScope;
  rows: ClientRow[];
  stageFields?: StageFields;
}) {
  const levels = LEVELS[scope.level];
  const tree = useMemo(() => build(rows, levels), [rows, levels]);
  const [openClient, setOpenClient] = useState<string | null>(null);

  if (rows.length === 0) {
    return <Panel><Empty>No target companies.</Empty></Panel>;
  }

  if (levels.length === 0) {
    return (
      <Panel>
        <ClientList rows={rows} openClient={openClient} setOpenClient={setOpenClient} stageFields={stageFields} />
      </Panel>
    );
  }

  return (
    <div className="space-y-2">
      {tree.map((n) => (
        <Group key={n.key} node={n} depth={0} openClient={openClient} setOpenClient={setOpenClient} stageFields={stageFields} />
      ))}
    </div>
  );
}

function Group({
  node, depth, openClient, setOpenClient, stageFields,
}: {
  node: Node;
  depth: number;
  openClient: string | null;
  setOpenClient: (id: string | null) => void;
  stageFields: StageFields;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Panel className={depth > 0 ? "border-0 bg-transparent" : undefined}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/30"
      >
        <ChevronRight
          className={"h-4 w-4 shrink-0 text-muted-foreground transition-transform " + (open ? "rotate-90" : "")}
        />
        <span className="text-sm font-semibold">{node.label}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
          {node.clientCount.toLocaleString()}
        </span>
        <span className="ml-auto text-xs font-semibold tabular-nums">
          {node.total.toLocaleString()}
        </span>
      </button>

      {open && (
        <div className="border-t">
          {node.children.length > 0 ? (
            <div className="space-y-1 py-1 pl-4">
              {node.children.map((c) => (
                <Group
                  key={c.key}
                  node={c}
                  depth={depth + 1}
                  openClient={openClient}
                  setOpenClient={setOpenClient}
                  stageFields={stageFields}
                />
              ))}
            </div>
          ) : (
            <ClientList rows={node.clients} openClient={openClient} setOpenClient={setOpenClient} stageFields={stageFields} />
          )}
        </div>
      )}
    </Panel>
  );
}

function ClientList({
  rows, openClient, setOpenClient, stageFields,
}: {
  rows: ClientRow[];
  openClient: string | null;
  setOpenClient: (id: string | null) => void;
  stageFields: StageFields;
}) {
  const span = TARGET_STAGES.length + 2;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Client</th>
            {TARGET_STAGES.map((s) => (
              <th key={s} className="whitespace-nowrap px-2 py-2 text-center font-medium">{s}</th>
            ))}
            <th className="px-4 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const open = openClient === c.client_id;
            return (
              <Fragment key={c.client_id}>
              <tr
                onClick={() => setOpenClient(open ? null : c.client_id)}
                className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
              >
                <td className="px-4 py-2">
                  <span className="flex items-center gap-2">
                    <ChevronRight
                      className={"h-4 w-4 shrink-0 text-muted-foreground transition-transform " + (open ? "rotate-90" : "")}
                    />
                    <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="font-medium">{c.client_name}</span>
                    {!c.client_active && c.client_status && (
                      <Chip colour="slate">{c.client_status}</Chip>
                    )}
                  </span>
                </td>

                {/* A cell per band whether or not it has anything in it, so the
                    numbers line up down the page. */}
                {TARGET_STAGES.map((s) => {
                  const n = c.stage_counts[s] ?? 0;
                  return (
                    <td key={s} className="px-2 py-2 text-center">
                      {n > 0 ? (
                        <Chip colour={STAGE_TONE[s]} className="tabular-nums">
                          {n.toLocaleString()}
                        </Chip>
                      ) : null}
                    </td>
                  );
                })}

                <td className="px-4 py-2 text-right font-semibold tabular-nums">
                  {c.companies.toLocaleString()}
                </td>
              </tr>

              {open && (
                <tr>
                  <td colSpan={span} className="border-b bg-muted/20 px-4 py-3">
                    <TargetAccounts
                      clientId={c.client_id}
                      clientName={c.client_name}
                      stageFields={stageFields}
                    />
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
