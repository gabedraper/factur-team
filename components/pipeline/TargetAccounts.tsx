"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Building2, ChevronRight, Maximize2, Minimize2, X, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Chip, Empty, Panel } from "@/components/pipeline/bits";
import { getAccountDetail, listTargetAccounts } from "@/actions/pipeline-targets";
import {
  TARGET_STAGES, TARGET_STAGE_TONE as STAGE_TONE,
  type AccountContact, type TargetAccount, type UnworkedContact,
} from "@/lib/pipeline/targets";

/*
 * A client's companies, and the way into each one.
 *
 * The list is server-paged rather than filtered in the browser, because the
 * average client is pursuing 613 companies and the largest 41,260 -- a number
 * you cannot hand to a table component and hope.
 *
 * Clicking a company opens a panel rather than navigating. Choosing which
 * company to work is a scanning job: you look at one, decide it is not the one,
 * look at the next. A page load between each would make that miserable, and
 * losing your place in the list would make it worse. The panel expands to full
 * width for when scanning turns into working.
 */

const PAGE = 50;

function shortDate(v: string | null) {
  if (!v) return null;
  return new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" });
}

export function TargetAccounts({
  clientId, clientName, initial, initialTotal,
}: {
  clientId: string;
  clientName: string;
  initial: TargetAccount[];
  initialTotal: number;
}) {
  const [rows, setRows] = useState(initial);
  const [total, setTotal] = useState(initialTotal);
  const [stages, setStages] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [openOnly, setOpenOnly] = useState(true);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<TargetAccount | null>(null);
  const [loading, start] = useTransition();

  const load = useCallback((next: {
    stages?: string[]; search?: string; openOnly?: boolean; page?: number;
  }) => {
    const s = next.stages ?? stages;
    const q = next.search ?? search;
    const o = next.openOnly ?? openOnly;
    const p = next.page ?? 0;
    start(async () => {
      const res = await listTargetAccounts({
        clientId, stages: s, search: q, openOnly: o, limit: PAGE, offset: p * PAGE,
      });
      setRows(res.rows);
      setTotal(res.total);
      setPage(p);
    });
  }, [clientId, stages, search, openOnly]);

  function toggleStage(s: string) {
    const next = stages.includes(s) ? stages.filter((x) => x !== s) : [...stages, s];
    setStages(next);
    load({ stages: next, page: 0 });
  }

  const pages = Math.ceil(total / PAGE);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); load({ search: e.target.value, page: 0 }); }}
            placeholder="Company or domain"
            className="pl-8"
          />
        </div>
        <Button
          variant={openOnly ? "default" : "outline"}
          size="sm"
          onClick={() => { const v = !openOnly; setOpenOnly(v); load({ openOnly: v, page: 0 }); }}
        >
          Open only
        </Button>
      </div>

      <div className="flex flex-wrap gap-1">
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
          <Empty>{loading ? "Loading…" : "No companies match."}</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 font-medium">Stage</th>
                <th className="px-4 py-2 font-medium">Location</th>
                <th className="px-4 py-2 text-right font-medium">Contacts</th>
                <th className="px-4 py-2 font-medium">Next action</th>
                <th className="px-4 py-2 font-medium">Last activity</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.account_id}
                  onClick={() => setSelected(r)}
                  className={`cursor-pointer border-b last:border-0 hover:bg-muted/40 ${
                    selected?.account_id === r.account_id ? "bg-muted/60" : ""
                  }`}
                >
                  <td className="px-4 py-2">
                    <div className="font-medium">{r.account_name}</div>
                    {r.domain && <div className="text-xs text-muted-foreground">{r.domain}</div>}
                  </td>
                  <td className="px-4 py-2">
                    <Chip colour={STAGE_TONE[r.target_stage] ?? "slate"}>{r.target_stage}</Chip>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {[r.city, r.state].filter(Boolean).join(", ") || null}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {r.open_contacts}
                    {r.contacts > r.open_contacts && (
                      <span className="ml-1 text-xs text-muted-foreground">/ {r.contacts}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 tabular-nums">{shortDate(r.next_action_date)}</td>
                  <td className="px-4 py-2 tabular-nums text-muted-foreground">
                    {shortDate(r.last_activity_at)}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    <ChevronRight className="h-4 w-4" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

      {selected && (
        <AccountPanel
          clientId={clientId}
          clientName={clientName}
          account={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function AccountPanel({
  clientId, clientName, account, onClose,
}: {
  clientId: string;
  clientName: string;
  account: TargetAccount;
  onClose: () => void;
}) {
  const [full, setFull] = useState(false);
  const [contacts, setContacts] = useState<AccountContact[] | null>(null);
  const [unworked, setUnworked] = useState<UnworkedContact[]>([]);
  const [openContact, setOpenContact] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setContacts(null);
    setOpenContact(null);
    getAccountDetail({ clientId, accountId: account.account_id }).then((d) => {
      if (!live) return;
      setContacts(d.contacts);
      setUnworked(d.unworked);
    });
    return () => { live = false; };
  }, [clientId, account.account_id]);

  /* Escape closes, the way every panel should. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <aside
        className={`relative flex h-full flex-col overflow-hidden border-l bg-background shadow-xl transition-all ${
          full ? "w-full" : "w-full max-w-2xl"
        }`}
      >
        <header className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <h2 className="truncate text-lg font-semibold">{account.account_name}</h2>
              <Chip colour={STAGE_TONE[account.target_stage] ?? "slate"}>{account.target_stage}</Chip>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {account.domain && <span>{account.domain}</span>}
              {account.industry && <span>{account.industry}</span>}
              {[account.city, account.state, account.country].filter(Boolean).length > 0 && (
                <span>{[account.city, account.state, account.country].filter(Boolean).join(", ")}</span>
              )}
              <span>{clientName}</span>
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="icon" onClick={() => setFull(!full)}>
              {full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {account.latest_update && (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">{account.latest_update}</p>
          )}

          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              In progress {contacts ? `(${contacts.length})` : ""}
            </h3>
            {contacts === null ? (
              <Empty>Loading…</Empty>
            ) : contacts.length === 0 ? (
              <Empty>No pursuits here.</Empty>
            ) : (
              <div className="divide-y rounded-md border">
                {contacts.map((c) => (
                  <ContactRow
                    key={c.opportunity_id}
                    contact={c}
                    expanded={openContact === c.opportunity_id}
                    onToggle={() =>
                      setOpenContact(openContact === c.opportunity_id ? null : c.opportunity_id)
                    }
                  />
                ))}
              </div>
            )}
          </section>

          {unworked.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Not worked yet ({unworked.length})
              </h3>
              <div className="divide-y rounded-md border">
                {unworked.map((c) => (
                  <div key={c.contact_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {[c.first_name, c.last_name].filter(Boolean).join(" ") || c.email}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[c.title, c.email].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    {c.other_clients_pursuing > 0 && (
                      <Chip colour="amber">
                        {c.other_clients_pursuing} other {c.other_clients_pursuing === 1 ? "client" : "clients"}
                      </Chip>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}

function ContactRow({
  contact: c, expanded, onToggle,
}: {
  contact: AccountContact;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/40">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {[c.first_name, c.last_name].filter(Boolean).join(" ") || c.email}
          </div>
          <div className="truncate text-xs text-muted-foreground">{c.title}</div>
        </div>
        <div className="hidden shrink-0 sm:block">
          <Chip colour={STAGE_TONE[c.target_stage] ?? "slate"}>{c.stage}</Chip>
        </div>
        {c.next_action_date && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {shortDate(c.next_action_date)}
          </span>
        )}
      </button>

      {expanded && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t bg-muted/20 px-3 py-3 text-sm">
          <Field label="Prospecting lead status" value={c.lead_status} />
          <Field label="Stage" value={c.stage} />
          <Field label="Email" value={c.email} />
          <Field label="Phone" value={c.phone} />
          <Field label="Opened" value={shortDate(c.opened_on)} />
          <Field label="Next action" value={shortDate(c.next_action_date)} />
          <Field label="Last activity" value={shortDate(c.last_activity_at)} />
          <Field label="Activities" value={String(c.activity_count)} />
          {c.updates && (
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">Updates</dt>
              <dd className="whitespace-pre-wrap">{c.updates}</dd>
            </div>
          )}
          <div className="col-span-2">
            <a href={`/opportunities/${c.opportunity_id}`} className="text-sm font-medium underline">
              Open pursuit
            </a>
          </div>
        </dl>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}
