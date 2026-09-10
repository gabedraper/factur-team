"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Building2, ChevronRight, Maximize2, Minimize2, X, Search, Phone as PhoneIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Chip, Empty, Panel } from "@/components/pipeline/bits";
import { getAccountDetail, listTargetAccounts } from "@/actions/pipeline-targets";
import { useDialer } from "@/components/work-panel/dialer-context";
import { toE164 } from "@/lib/phone";
import {
  TARGET_STAGES, TARGET_STAGE_TONE as STAGE_TONE,
  BOTH_STAGE_FIELDS,
  type AccountContact, type CampaignMembership, type StageFields,
  type TargetAccount, type UnworkedContact,
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
  clientId, clientName, initial, initialTotal, stageFields = BOTH_STAGE_FIELDS,
}: {
  clientId: string;
  clientName: string;
  stageFields?: StageFields;
  /* Omitted when the list is opened inside a client group, where there was no
     server render to seed it -- it fetches its own first page instead. */
  initial?: TargetAccount[];
  initialTotal?: number;
}) {
  const [rows, setRows] = useState<TargetAccount[]>(initial ?? []);
  const [total, setTotal] = useState(initialTotal ?? 0);
  const [stages, setStages] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<TargetAccount | null>(null);
  const [loading, start] = useTransition();
  // The box the account panel is allowed to fill -- its right edge is
  // wherever the work panel currently begins, so the account panel's own
  // absolute positioning follows it there for free, without either
  // component knowing the other's width.
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback((next: {
    stages?: string[]; search?: string; page?: number;
  }) => {
    const s = next.stages ?? stages;
    const q = next.search ?? search;
    const p = next.page ?? 0;
    start(async () => {
      const res = await listTargetAccounts({
        clientId, stages: s, search: q, limit: PAGE, offset: p * PAGE,
      });
      setRows(res.rows);
      setTotal(res.total);
      setPage(p);
    });
  }, [clientId, stages, search]);

  /* Seeded by the server on the per-client page, unseeded when expanded inside
     a group. Only the second case has anything to fetch. */
  useEffect(() => {
    if (initial === undefined) load({ page: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  function toggleStage(s: string) {
    const next = stages.includes(s) ? stages.filter((x) => x !== s) : [...stages, s];
    setStages(next);
    load({ stages: next, page: 0 });
  }

  const pages = Math.ceil(total / PAGE);

  return (
    // relative + min-w-0: the account panel positions itself absolute
    // right-0 against this box, so its right edge is always exactly where
    // this box's own right edge is -- which, being a normal flex child of
    // main, is always exactly where the work panel begins, however wide
    // that currently is.
    <div ref={boxRef} className="relative min-w-0">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative w-56 shrink-0">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); load({ search: e.target.value, page: 0 }); }}
              placeholder="Company or domain"
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
            <Empty>{loading ? "Loading…" : "No companies match."}</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-4 py-2 font-medium">Stage</th>
                  <th className="px-4 py-2 font-medium">Location</th>
                  <th className="px-4 py-2 font-medium">Industry</th>
                  <th className="px-4 py-2 font-medium">Keywords</th>
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
                      <Website domain={r.domain} />
                    </td>
                    <td className="px-4 py-2">
                      <Chip colour={STAGE_TONE[r.target_stage] ?? "slate"}>{r.target_stage}</Chip>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {[r.city, r.state].filter(Boolean).join(", ") || null}
                    </td>
                    <td className="max-w-[14rem] px-4 py-2 text-muted-foreground">
                      <div className="truncate" title={r.industry ?? undefined}>{r.industry}</div>
                    </td>
                    <td className="max-w-[22rem] px-4 py-2 text-xs text-muted-foreground">
                      <div className="truncate" title={r.keywords ?? undefined}>{r.keywords}</div>
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
      </div>

      {selected && (
        <AccountPanel
          clientId={clientId}
          clientName={clientName}
          account={selected}
          onClose={() => setSelected(null)}
          stageFields={stageFields}
          boxRef={boxRef}
        />
      )}
    </div>
  );
}

const PANEL_MIN_WIDTH = 380;
const PANEL_MAX_WIDTH = 900;
const PANEL_DEFAULT_WIDTH = 560;
const PANEL_WIDTH_KEY = "factur-account-panel-width";

function AccountPanel({
  clientId, clientName, account, onClose, stageFields, boxRef,
}: {
  clientId: string;
  clientName: string;
  account: TargetAccount;
  onClose: () => void;
  stageFields: StageFields;
  /** The box this panel positions itself against -- see TargetAccounts. */
  boxRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [contacts, setContacts] = useState<AccountContact[] | null>(null);
  const [unworked, setUnworked] = useState<UnworkedContact[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignMembership[]>([]);
  const [openContact, setOpenContact] = useState<string | null>(null);
  /* Shut by default: it is a long list of people nobody has touched, useful
     when you go looking for it and noise the rest of the time. */
  const [showPotential, setShowPotential] = useState(false);
  const [full, setFull] = useState(false);
  const [width, setWidth] = useState(PANEL_DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    if (saved >= PANEL_MIN_WIDTH && saved <= PANEL_MAX_WIDTH) setWidth(saved);
  }, []);

  /*
   * Dragging the edge, same recipe as the work panel's own handle: measured
   * from the box's current right edge rather than a start offset, so it
   * tracks the pointer exactly rather than drifting. Clamped to the box's
   * own width too -- this panel must never reach past the left sidebar
   * regardless of how wide somebody drags it.
   */
  const drag = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    const box = boxRef.current;
    if (!box) return;
    const right = box.getBoundingClientRect().right;

    const move = (ev: PointerEvent) => {
      const ceiling = Math.min(PANEL_MAX_WIDTH, box.getBoundingClientRect().width);
      const next = Math.round(Math.min(ceiling, Math.max(PANEL_MIN_WIDTH, right - ev.clientX)));
      setWidth(next);
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setWidth((w) => {
        localStorage.setItem(PANEL_WIDTH_KEY, String(w));
        return w;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [boxRef]);

  useEffect(() => {
    let live = true;
    setContacts(null);
    setOpenContact(null);
    setShowPotential(false);
    getAccountDetail({ clientId, accountId: account.account_id }).then((d) => {
      if (!live) return;
      setContacts(d.contacts);
      setUnworked(d.unworked);
      setCampaigns(d.campaigns);
    });
    return () => { live = false; };
  }, [clientId, account.account_id]);

  /* One row per campaign for the company header, and a lookup for the contact
     rows, both off the single fetch. */
  const byCampaign = useMemo(() => {
    const m = new Map<string, { name: string; type: string | null; start_date: string | null; members: number }>();
    for (const c of campaigns) {
      const at = m.get(c.campaign_id);
      if (at) at.members += 1;
      else m.set(c.campaign_id, { name: c.name, type: c.type, start_date: c.start_date, members: 1 });
    }
    return [...m.entries()];
  }, [campaigns]);

  const byContact = useMemo(() => {
    const m = new Map<string, CampaignMembership[]>();
    for (const c of campaigns) m.set(c.contact_id, [...(m.get(c.contact_id) ?? []), c]);
    return m;
  }, [campaigns]);

  /* Escape closes, the way every panel should. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    // absolute + right-0 against boxRef, not fixed-to-viewport: a modal-style
    // overlay was covering the work panel on the right, since it drew
    // relative to the whole screen rather than the space actually left for
    // it. Positioned this way, its right edge is always exactly where the
    // box (and so the work panel) begins, however wide that currently is --
    // growing the work panel pushes this panel along for free, no
    // coordination between the two needed. The list sits underneath,
    // full width, unconditionally: this panel is what overlays it.
    <aside
      style={full ? undefined : { width }}
      className={`absolute inset-y-0 right-0 z-10 flex flex-col overflow-hidden border-l bg-background shadow-lg ${
        dragging ? "" : "transition-[width] duration-200"
      } ${full ? "left-0" : ""}`}
    >
        {!full && (
          <div
            onPointerDown={drag}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            className={`absolute left-0 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-primary/30 ${
              dragging ? "bg-primary/40" : ""
            }`}
          />
        )}
        <header className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <h2 className="truncate text-lg font-semibold">{account.account_name}</h2>
              <Chip colour={STAGE_TONE[account.target_stage] ?? "slate"}>{account.target_stage}</Chip>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <Website domain={account.domain} />
              {account.industry && <span>{account.industry}</span>}
              {[account.city, account.state, account.country].filter(Boolean).length > 0 && (
                <span>{[account.city, account.state, account.country].filter(Boolean).join(", ")}</span>
              )}
              <span>{clientName}</span>
            </div>
            {account.keywords && (
              <p className="mt-1 text-xs text-muted-foreground">{account.keywords}</p>
            )}
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

          {byCampaign.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Campaigns ({byCampaign.length})
              </h3>
              <div className="divide-y rounded-md border">
                {byCampaign.map(([id, c]) => (
                  <div key={id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{c.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[c.type, shortDate(c.start_date)].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {c.members} {c.members === 1 ? "contact" : "contacts"}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Target contacts {contacts ? `(${contacts.length})` : ""}
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
                    campaigns={byContact.get(c.contact_id) ?? []}
                    stageFields={stageFields}
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
              <button
                type="button"
                onClick={() => setShowPotential(!showPotential)}
                className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
              >
                <ChevronRight
                  className={"h-3.5 w-3.5 transition-transform " + (showPotential ? "rotate-90" : "")}
                />
                Potential targets ({unworked.length})
              </button>
              <div className={"divide-y rounded-md border" + (showPotential ? "" : " hidden")}>
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
  );
}

function ContactRow({
  contact: c, campaigns, stageFields, expanded, onToggle,
}: {
  contact: AccountContact;
  campaigns: CampaignMembership[];
  stageFields: StageFields;
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
          {/* Whichever ladder this reader is on. A prospector wants Attempting,
              not Pipeline Hot: Quoting, and neither means much to the other. */}
          <Chip colour={STAGE_TONE[c.target_stage] ?? "slate"}>
            {stageFields.show_stage ? c.stage : (c.lead_status ?? c.stage)}
          </Chip>
        </div>
        {c.next_action_date && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {shortDate(c.next_action_date)}
          </span>
        )}
      </button>

      {expanded && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t bg-muted/20 px-3 py-3 text-sm">
          {stageFields.show_lead_status && (
            <Field label="Prospecting lead status" value={c.lead_status} />
          )}
          {stageFields.show_stage && <Field label="Stage" value={c.stage} />}
          <Field label="Title" value={c.title} />
          <Field label="Email" value={c.email} />
          <PhoneField value={c.phone} />
          <Field label="Opened" value={shortDate(c.opened_on)} />
          <Field label="Next action" value={shortDate(c.next_action_date)} />
          <Field label="Last activity" value={shortDate(c.last_activity_at)} />
          <Field label="Activities" value={String(c.activity_count)} />
          {campaigns.length > 0 && (
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">Campaigns</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {campaigns.map((m) => (
                  <Chip key={m.campaign_id} colour={m.has_responded ? "emerald" : "slate"}>
                    {m.name}
                  </Chip>
                ))}
              </dd>
            </div>
          )}
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

/*
 * The website, wherever it appears. crm_accounts stores a bare domain, so the
 * scheme is put back on for the href while the text stays the domain -- nobody
 * wants to read "https://" in a table cell.
 *
 * The click is stopped from propagating because every place this appears sits
 * inside something else that is clickable: a table row that opens the panel, a
 * client row that expands. Opening a company's site should not also rearrange
 * the page behind it.
 */
function Website({ domain }: { domain: string | null }) {
  if (!domain) return null;
  return (
    <a
      href={`https://${domain}`}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
    >
      {domain}
    </a>
  );
}

/*
 * The number, and a way to ring it. The panel showed the digits as plain text,
 * so the one thing anyone opens a contact to do could not be done from here.
 *
 * Same shape as ContactEditor: toE164 decides whether the number is dialable at
 * all -- Salesforce phone fields hold extensions, spreadsheet ".0" artifacts
 * and two numbers in one box -- and the button says so rather than sending
 * rubbish to the provider.
 */
function PhoneField({ value }: { value: string | null }) {
  const { requestCall } = useDialer();
  const dialable = toE164(value);
  if (!value) return null;

  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">Phone</dt>
      <dd className="flex items-center gap-2">
        <span className="truncate tabular-nums">{value}</span>
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
      </dd>
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
