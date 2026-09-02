import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getClient, getServiceSeries, getServicePeriods, HEADLINE_LABEL,
  type ServiceSeries,
} from "@/lib/clients/results";
import { ServicePeriods } from "@/components/clients/ServicePeriods";

export const dynamic = "force-dynamic";

const nf = new Intl.NumberFormat("en-US");
const money = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});
const monthLabel = new Intl.DateTimeFormat("en-US", {
  month: "short", year: "numeric", timeZone: "UTC",
});

const SIZE_LABEL: Record<string, string> = {
  micro: "< 10", small: "10–49", mid: "50–249", large: "250+",
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Tags({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {items.map((i) => (
        <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-xs">
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
  month: "Month of the engagement. 1 is the client's first month.",
  calendar: "The calendar month that month number fell in.",
  leads: "Opportunities handed to the client, counted in the month they were created.",
  appts: "Opportunities that reached an appointment stage. Counted strictly.",
  quotes: "Opportunities that reached a quoting stage, or were won. Excludes No Quote.",
  pos: "Opportunities marked Closed Won.",
  quoteValue: "Sum of Total Quote Amount, where Salesforce has it.",
  poValue: "Sum of PO Amount. Blank on most POs, so it is a floor, not the true total.",
};

/** One service's months. The headline column is tinted; the rest sit beside it. */
function ServiceTable({ series }: { series: ServiceSeries }) {
  const headline = series.headline;
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
          <span className="text-xs text-muted-foreground">{HEADLINE_LABEL[headline]}</span>
        )}
        <span className="text-sm text-muted-foreground tabular-nums">
          {monthLabel.format(new Date(`${series.months[0].monthStart}T00:00:00Z`))} –{" "}
          {monthLabel.format(
            new Date(`${series.months[series.months.length - 1].monthStart}T00:00:00Z`),
          )}
          {" · "}
          {series.months.length} months · {nf.format(series.totals.leads)} leads ·{" "}
          {nf.format(series.totals.appointments)} appts ·{" "}
          {nf.format(series.totals.quotes)} quotes · {nf.format(series.totals.pos)} POs
          {series.totals.poAmount > 0 && ` · ${money.format(series.totals.poAmount)}`}
        </span>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium"><span title={HINTS.month}>Month</span></th>
              <th className="px-3 py-2 font-medium"><span title={HINTS.calendar}>Calendar</span></th>
              <th className="px-3 py-2 font-medium"><span title={HINTS.leads}>Leads</span></th>
              <th className="px-3 py-2 font-medium"><span title={HINTS.appts}>Appts</span></th>
              <th className="px-3 py-2 font-medium"><span title={HINTS.quotes}>Quotes</span></th>
              <th className="px-3 py-2 font-medium"><span title={HINTS.pos}>POs</span></th>
              <th className="px-3 py-2 font-medium"><span title={HINTS.quoteValue}>Quote value</span></th>
              <th className="px-3 py-2 font-medium"><span title={HINTS.poValue}>PO value</span></th>
              <th className="w-28 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {series.months.map((m) => (
              <tr key={m.monthIndex} className="border-t">
                <td className="px-3 py-1.5 tabular-nums">{m.monthIndex}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                  {monthLabel.format(new Date(`${m.monthStart}T00:00:00Z`))}
                </td>
                <td className="px-3 py-1.5 tabular-nums">{m.leads || "—"}</td>
                <td className="px-3 py-1.5 tabular-nums">{m.appointments || "—"}</td>
                <td className="px-3 py-1.5 tabular-nums">{m.quotes || "—"}</td>
                <td className="px-3 py-1.5 tabular-nums">{m.pos || "—"}</td>
                <td className="px-3 py-1.5 tabular-nums">
                  {m.quoteAmount ? money.format(m.quoteAmount) : "—"}
                </td>
                <td className="px-3 py-1.5 tabular-nums">
                  {m.poAmount ? money.format(m.poAmount) : "—"}
                </td>
                <td className="px-3 py-1.5">
                  <span
                    className="block h-1.5 rounded-sm bg-sky-500/70"
                    style={{ width: `${(bar(m) / peak) * 100}%` }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function ClientResultPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const [client, series, periods] = await Promise.all([
    getClient(clientId),
    getServiceSeries(clientId),
    getServicePeriods(clientId),
  ]);
  if (!client) notFound();

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <Link href="/clients/results" className="text-sm text-muted-foreground hover:underline">
          Client Results
        </Link>
        <h1 className="text-xl font-semibold">{client.name}</h1>
        <span className="text-sm text-muted-foreground">{client.status ?? "—"}</span>
        {client.website && (
          <a
            href={client.website}
            target="_blank"
            rel="noreferrer noopener"
            className="text-sm text-muted-foreground hover:underline"
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
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
          <span>
            <span className="text-xs text-muted-foreground">Type of work </span>
            <span className={client.businessTypeInferred ? "italic" : ""}>
              {client.businessType ?? "—"}
            </span>
          </span>
          <span>
            <span className="text-xs text-muted-foreground">Size </span>
            <span className={client.sizeInferred ? "italic" : ""}>
              {client.sizeBand ? SIZE_LABEL[client.sizeBand] : "—"}
              {client.employees ? ` · ${nf.format(client.employees)}` : ""}
            </span>
          </span>
          {client.industry && (
            <span>
              <span className="text-xs text-muted-foreground">Industry </span>
              {client.industry}
            </span>
          )}
        </div>
        {client.summary && <p className="text-sm">{client.summary}</p>}
        <Tags label="Capabilities" items={client.capabilities} />
        <Tags label="Materials" items={client.materials} />
        <Tags label="Certifications" items={client.certifications} />
        <Tags label="Markets" items={client.marketsServed} />
      </div>

      {series.map((s) => (
        <ServiceTable key={s.service} series={s} />
      ))}
      {!series.length && (
        <p className="rounded-md border p-4 text-sm text-muted-foreground">
          No results recorded.
        </p>
      )}
    </div>
  );
}
