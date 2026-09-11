"use client";

import { Fragment, useCallback, useEffect, useState, useTransition } from "react";
import { Building2, Phone as PhoneIcon, Search } from "lucide-react";
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

  function toggleStage(s: string) {
    const next = stages.includes(s) ? stages.filter((x) => x !== s) : [...stages, s];
    setStages(next);
    load({ stages: next, page: 0 });
  }

  const pages = Math.ceil(total / PAGE);
  const showBoth = stageFields.show_stage && stageFields.show_lead_status;

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
      </div>

      <Panel>
        {rows.length === 0 ? (
          <Empty>{loading ? "Loading…" : "No contacts match."}</Empty>
        ) : (
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH>Contact</TH>
                  <TH>Title</TH>
                  <TH>Phone</TH>
                  <TH>Email</TH>
                  <TH>
                    {showBoth ? "Stage / lead status" : stageFields.show_stage ? "Stage" : "Lead status"}
                  </TH>
                  <TH>Next action</TH>
                  <TH>Updates</TH>
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
                          <TD colSpan={7} >
                            <span className="flex items-center gap-2 text-xs font-semibold">
                              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                              {r.account_name ?? "No company"}
                            </span>
                          </TD>
                        </TR>
                      )}
                      <TR>
                        <TD>
                          <a href={`/opportunities/${r.opportunity_id}`} className="font-medium hover:underline">
                            {[r.first_name, r.last_name].filter(Boolean).join(" ") || r.email || "—"}
                          </a>
                        </TD>
                        <TD className="max-w-[14rem] text-muted-foreground">
                          <div className="truncate" title={r.title ?? undefined}>{r.title}</div>
                        </TD>
                        <TD><PhoneCell value={r.phone} /></TD>
                        <TD className="max-w-[16rem] text-muted-foreground">
                          <div className="truncate" title={r.email ?? undefined}>{r.email}</div>
                        </TD>
                        <TD>
                          <Chip colour={STAGE_TONE[r.target_stage] ?? "slate"}>
                            {stageFields.show_stage ? r.stage : (r.lead_status ?? r.stage)}
                          </Chip>
                          {showBoth && r.lead_status && (
                            <div className="mt-0.5 text-xs text-muted-foreground">{r.lead_status}</div>
                          )}
                        </TD>
                        <TD className="tabular-nums">{shortDate(r.next_action_date)}</TD>
                        <TD className="max-w-[24rem] text-xs text-muted-foreground">
                          <div className="truncate" title={r.updates ?? undefined}>{r.updates}</div>
                        </TD>
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
