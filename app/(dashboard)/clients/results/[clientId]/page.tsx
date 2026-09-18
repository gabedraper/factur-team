import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import {
  getClient, getServiceSeries, getServicePeriods, getMonthRecords, HEADLINE_LABEL,
  type MonthRecord, type ServiceSeries,
} from "@/lib/clients/results";
import { SF_BASE } from "@/lib/timelines/assemble";
import { ServicePeriods } from "@/components/clients/ServicePeriods";
import { myPermissions } from "@/lib/org";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/ui/page-header";
import { TableScroll, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

export const dynamic = "force-dynamic";

const nf = new Intl.NumberFormat("en-US");
const money = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});
const monthLabel = new Intl.DateTimeFormat("en-US", {
  month: "short", year: "numeric", timeZone: "UTC",
});
const dayLabel = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", timeZone: "UTC",
});

const SIZE_LABEL: Record<string, string> = {
  micro: "< 10", small: "10–49", mid: "50–249", large: "250+",
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-meta text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Tags({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-1.5">
      <span className="text-meta text-muted-foreground">{label}</span>
      {items.map((i) => (
        <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-meta">
          {i}
        </span>
      ))}
    </div>
  );
}

/*
 * The same definitions the list page shows on hover, kept here too: this table
 * is the one people screenshot for a client conversation, and "quotes" needs to
 * mean the same thing in both places.
 */
const HINTS = {
  month: "Month of the engagement. Month 1 is the earlier of Client Since and the client's first result.",
  calendar: "The calendar month that month number fell in.",
  leads: "Opportunities handed to the client, counted in the month they were created.",
  appts: "Reached an explicit appointment stage. Never inferred from a later quote.",
  quotes: "Reached a quoting stage, was won, or carries a quote amount \u2014 including quotes later lost or still on follow-up.",
  pos: "Closed Won, or carrying a PO amount or PO date at another stage.",
  quoteValue: "Sum of Total Quote Amount \u2014 the value quoted, including quotes later lost or still on follow-up.",
  poValue: "Sum of PO Amount. Blank on most POs, so it is a floor, not the true total.",
};

/**
 * The records behind one month, listed under its row.
 *
 * The count on its own sends you to Salesforce to find out who the four leads
 * were, which is most of the reason the breakdown was read and then left. The
 * names are the answer, and each one links back to its record.
 */
function MonthRecords({ records, counted }: { records: MonthRecord[]; counted: number }) {
  return (
    <TD colSpan={9} className="bg-muted/30">
      {!records.length ? (
        <p className="text-body text-muted-foreground">
          {counted
            ? `${nf.format(counted)} leads are counted for this month, but the lead sync does not cover this client, so the individual records are not here.`
            : "No leads recorded for this month."}
        </p>
      ) : (
        <>
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH>Created</TH>
                  <TH>Opportunity</TH>
                  <TH>Company</TH>
                  <TH>Contact</TH>
                  <TH>Stage</TH>
                  <TH>Counted as</TH>
                  <TH>Owner</TH>
                </TR>
              </THead>
              <TBody>
                {records.map((r) => (
                  <TR key={r.id}>
                    <TD className="whitespace-nowrap tabular-nums text-muted-foreground">
                      {dayLabel.format(new Date(r.createdOn))}
                    </TD>
                    <TD className="max-w-xs truncate">
                      <a
                        href={`${SF_BASE}/lightning/r/Opportunity/${r.id}/view`}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="hover:underline"
                        title={r.name ?? ""}
                      >
                        {r.name ?? ""}
                      </a>
                    </TD>
                    <TD className="max-w-xs truncate">{r.account ?? ""}</TD>
                    <TD className="text-muted-foreground">{r.contact ?? ""}</TD>
                    <TD className="whitespace-nowrap">{r.stage ?? ""}</TD>
                    {/* Which of the row's four numbers this record is part of,
                        so a cell can be read without knowing the stages. */}
                    <TD className="whitespace-nowrap">
                      {["Lead", r.appointment && "Appt", r.quote && "Quote", r.po && "PO"]
                        .filter((t): t is string => Boolean(t))
                        .map((t) => (
                          <span key={t} className="mr-1 rounded bg-muted px-1.5 py-0.5 text-meta">
                            {t}
                          </span>
                        ))}
                    </TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{r.owner ?? ""}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
          {records.length !== counted && (
            /* Said out loud: a drill-down that does not add up to the number
               above it is how a working page gets reported as broken. */
            <p className="pt-2 text-meta text-muted-foreground">
              {nf.format(records.length)} listed against {nf.format(counted)} counted. The
              records come from the hourly lead sync, which covers current clients only and
              carries no service tag; the count is the hand-run backfill, which splits by
              service and also credits quote and PO evidence at stages not listed here.
            </p>
          )}
        </>
      )}
    </TD>
  );
}

/** One service's months. The headline column is tinted; the rest sit beside it. */
function ServiceTable({
  series, clientId, open, records,
}: {
  series: ServiceSeries;
  clientId: string;
  /** "<service>:<month start>", so two services cannot open the same month at once. */
  open: string | null;
  records: MonthRecord[];
}) {
  const headline = series.headline;
  const base = `/clients/results/${clientId}`;
  const peak = Math.max(
    1,
    ...series.months.map((m) =>
      headline === "quotes" ? m.quotes : headline === "appointments" ? m.appointments : m.leads,
    ),
  );
  const bar = (m: (typeof series.months)[number]) =>
    headline === "quotes" ? m.quotes : headline === "appointments" ? m.appointments : m.leads;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-semibold">{series.service}</h2>
        {headline && (
          <span className="text-meta text-muted-foreground">{HEADLINE_LABEL[headline]}</span>
        )}
        <span className="text-body text-muted-foreground tabular-nums">
          {monthLabel.format(new Date(`${series.months[0].monthStart}T00:00:00Z`))} –{" "}
          {monthLabel.format(
            new Date(`${series.months[series.months.length - 1].monthStart}T00:00:00Z`),
          )}
          {" · "}
          {series.months.length} months · {nf.format(series.totals.leads)} leads ·{" "}
          {nf.format(series.totals.appointments)} appts ·{" "}
          {nf.format(series.totals.quotes)} quotes
          {series.totals.quoteAmount > 0 && ` (${money.format(series.totals.quoteAmount)})`}
          {" · "}{nf.format(series.totals.pos)} POs
          {series.totals.poAmount > 0 && ` (${money.format(series.totals.poAmount)})`}
        </span>
      </div>

      <TableScroll className="rounded-md border">
        <Table>
          <THead>
            <TR>
              <TH><span title={HINTS.month}>Month</span></TH>
              <TH><span title={HINTS.calendar}>Calendar</span></TH>
              <TH><span title={HINTS.leads}>Leads</span></TH>
              <TH><span title={HINTS.appts}>Appts</span></TH>
              <TH><span title={HINTS.quotes}>Quotes</span></TH>
              <TH><span title={HINTS.pos}>POs</span></TH>
              <TH><span title={HINTS.quoteValue}>Quote value</span></TH>
              <TH><span title={HINTS.poValue}>PO value</span></TH>
              <TH className="w-28" />
            </TR>
          </THead>
          <TBody>
            {series.months.map((m) => {
              const key = `${series.service}:${m.monthStart}`;
              const isOpen = open === key;
              return (
                <Fragment key={m.monthIndex}>
                  <TR className="border-t">
                    <TD className="tabular-nums">{m.monthIndex}</TD>
                    <TD className="whitespace-nowrap text-muted-foreground">
                      {/* Which month is open is a query parameter rather than
                          component state, so it survives a reload and pastes
                          into Slack as the month somebody was looking at. */}
                      <Link
                        href={isOpen ? base : `${base}?month=${encodeURIComponent(key)}`}
                        scroll={false}
                        aria-expanded={isOpen}
                        className="flex items-center gap-1 hover:underline"
                      >
                        <ChevronRight
                          className={`h-3 w-3 shrink-0 transition-transform duration-fast ease-out ${
                            isOpen ? "rotate-90" : ""
                          }`}
                          aria-hidden
                        />
                        {monthLabel.format(new Date(`${m.monthStart}T00:00:00Z`))}
                      </Link>
                    </TD>
                    <TD className="tabular-nums">{m.leads || "—"}</TD>
                    <TD className="tabular-nums">{m.appointments || "—"}</TD>
                    <TD className="tabular-nums">{m.quotes || "—"}</TD>
                    <TD className="tabular-nums">{m.pos || "—"}</TD>
                    <TD className="tabular-nums">
                      {m.quoteAmount ? money.format(m.quoteAmount) : "—"}
                    </TD>
                    <TD className="tabular-nums">
                      {m.poAmount ? money.format(m.poAmount) : "—"}
                    </TD>
                    <TD>
                      <span
                        className="block h-1.5 rounded-sm bg-sky-500/70"
                        style={{ width: `${(bar(m) / peak) * 100}%` }}
                      />
                    </TD>
                  </TR>
                  {isOpen && (
                    <TR className="border-t">
                      <MonthRecords records={records} counted={m.leads} />
                    </TR>
                  )}
                </Fragment>
              );
            })}
          </TBody>
        </Table>
      </TableScroll>
    </div>
  );
}

export default async function ClientResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const perms = await myPermissions();
  if (!perms.has("clients.results") && !perms.has("org.manage")) {
    return <NoAccess section="Client results" need="View client results" />;
  }

  const [{ clientId }, { month }] = await Promise.all([params, searchParams]);
  const open = month ?? null;
  // Only the month that is open is fetched, so a page nobody drills into costs
  // what it always did.
  const openMonth = open?.split(":")[1] ?? "";
  const [client, series, periods, records] = await Promise.all([
    getClient(clientId),
    getServiceSeries(clientId),
    getServicePeriods(clientId),
    /^\d{4}-\d{2}-\d{2}$/.test(openMonth) ? getMonthRecords(clientId, openMonth) : [],
  ]);
  if (!client) notFound();

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <Link href="/clients/results" className="text-body text-muted-foreground hover:underline">
          Client Results
        </Link>
        <PageHeader title={client.name} />
        <span className="text-body text-muted-foreground">{client.status ?? "—"}</span>
        {client.website && (
          <a
            href={client.website}
            target="_blank"
            rel="noreferrer noopener"
            className="text-body text-muted-foreground hover:underline"
          >
            {client.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="Started" value={client.clientSince ?? "—"} />
        <Stat label="Ended" value={client.clientEnd ?? "—"} />
        <Stat label="Months" value={String(client.monthsWithResults || "—")} />
        <Stat label="Leads" value={nf.format(client.leads)} />
        <Stat label="Appointments" value={nf.format(client.appointments)} />
        <Stat label="Quotes" value={nf.format(client.quotes)} />
        <Stat
          label="POs"
          value={
            client.pos ? `${nf.format(client.pos)} · ${money.format(client.poAmount)}` : "—"
          }
        />
      </div>

      <ServicePeriods clientId={clientId} periods={periods} />

      <div className="space-y-2 rounded-md border p-3">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-body">
          <span>
            <span className="text-meta text-muted-foreground">Type of work </span>
            <span className={client.businessTypeInferred ? "italic" : ""}>
              {client.businessType ?? "—"}
            </span>
          </span>
          <span>
            <span className="text-meta text-muted-foreground">Size </span>
            <span className={client.sizeInferred ? "italic" : ""}>
              {client.sizeBand ? SIZE_LABEL[client.sizeBand] : "—"}
              {client.employees ? ` · ${nf.format(client.employees)}` : ""}
            </span>
          </span>
          {client.industry && (
            <span>
              <span className="text-meta text-muted-foreground">Industry </span>
              {client.industry}
            </span>
          )}
        </div>
        {client.summary && <p className="text-body">{client.summary}</p>}
        <Tags label="Capabilities" items={client.capabilities} />
        <Tags label="Materials" items={client.materials} />
        <Tags label="Certifications" items={client.certifications} />
        <Tags label="Markets" items={client.marketsServed} />
      </div>

      {series.map((s) => (
        <ServiceTable
          key={s.service}
          series={s}
          clientId={clientId}
          open={open}
          records={records}
        />
      ))}
      {!series.length && (
        <p className="rounded-md border p-4 text-body text-muted-foreground">
          No results recorded.
        </p>
      )}
    </div>
  );
}
