import Link from "next/link";
import { notFound } from "next/navigation";
import { getClient, getMonths, HEADLINE_LABEL } from "@/lib/clients/results";

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

export default async function ClientResultPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const [client, months] = await Promise.all([getClient(clientId), getMonths(clientId)]);
  if (!client) notFound();

  const headline = client.headlineMetric;
  const peak = Math.max(1, ...months.map((m) => m.leads));

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <Link href="/clients/results" className="text-sm text-muted-foreground hover:underline">
          Client Results
        </Link>
        <h1 className="text-xl font-semibold">{client.name}</h1>
        <span className="text-sm text-muted-foreground">
          {client.primaryService ?? "—"}
          {headline && ` · ${HEADLINE_LABEL[headline]}`}
        </span>
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
            client.pos
              ? `${nf.format(client.pos)} · ${money.format(client.poAmount)}`
              : "—"
          }
        />
      </div>

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

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Month</th>
              <th className="px-3 py-2 font-medium">Calendar</th>
              <th className="px-3 py-2 font-medium">Leads</th>
              <th className="px-3 py-2 font-medium">Appts</th>
              <th className="px-3 py-2 font-medium">Quotes</th>
              <th className="px-3 py-2 font-medium">POs</th>
              <th className="px-3 py-2 font-medium">Quote value</th>
              <th className="px-3 py-2 font-medium">PO value</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.monthIndex} className="border-t">
                <td className="px-3 py-1.5 tabular-nums">{m.monthIndex}</td>
                <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                  {monthLabel.format(new Date(`${m.monthStart}T00:00:00Z`))}
                </td>
                <td className="px-3 py-1.5 tabular-nums">
                  <span className="inline-flex items-center gap-2">
                    <span className="w-8 text-right">{m.leads || "—"}</span>
                    <span
                      className="h-1.5 rounded-sm bg-sky-500/70"
                      style={{ width: `${(m.leads / peak) * 96}px` }}
                    />
                  </span>
                </td>
                <td className="px-3 py-1.5 tabular-nums">{m.appointments || "—"}</td>
                <td className="px-3 py-1.5 tabular-nums">{m.quotes || "—"}</td>
                <td className="px-3 py-1.5 tabular-nums">{m.pos || "—"}</td>
                <td className="px-3 py-1.5 tabular-nums">
                  {m.quoteAmount ? money.format(m.quoteAmount) : "—"}
                </td>
                <td className="px-3 py-1.5 tabular-nums">
                  {m.poAmount ? money.format(m.poAmount) : "—"}
                </td>
              </tr>
            ))}
            {!months.length && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-muted-foreground">
                  No results recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
