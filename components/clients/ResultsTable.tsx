"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSort, SortHeader } from "@/components/ui/sortable";
import { HEADLINE_LABEL, type ClientResult } from "@/lib/clients/result-metrics";

const nf = new Intl.NumberFormat("en-US");
const money = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});

const SIZE_ORDER = ["micro", "small", "mid", "large"];
const SIZE_LABEL: Record<string, string> = {
  micro: "< 10", small: "10–49", mid: "50–249", large: "250+",
};

const STATUS_CLASS: Record<string, string> = {
  Active: "text-emerald-600 dark:text-emerald-400",
  Onboarding: "text-sky-600 dark:text-sky-400",
  Hold: "text-amber-600 dark:text-amber-400",
  "Financial Pause": "text-amber-600 dark:text-amber-400",
  Inactive: "text-muted-foreground",
};

/** A value the user did not enter, marked so it is never mistaken for one. */
function Inferred({ children }: { children: React.ReactNode }) {
  return <span className="italic text-muted-foreground">{children}</span>;
}

function Select({
  value, onChange, options, all,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  all: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border bg-background px-2 py-1 text-sm"
    >
      <option value="">{all}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

/*
 * What each column is, on hover.
 *
 * These numbers are derived from Salesforce opportunity stages rather than read
 * off a field, so the definitions are judgement calls and nobody should have to
 * find this file to learn what one means. Same `title` treatment the AR column
 * on Client Health uses.
 */
const HINTS: Record<string, string> = {
  client: "The client record in Salesforce. Click through for their month-by-month history.",

  status: "Client Status in Salesforce: Active, Onboarding, Inactive, Hold or Financial Pause.",

  service: "Which services we actually delivered, in the order they took them.\n\n" +
    "Read from the Service tag on each opportunity, not from the client record \u2014 " +
    "the client record holds one value and cannot show an upgrade.",

  work: "Type of Work in Salesforce, a 22-value list your team maintains.\n\n" +
    "Italic means it was read from the client's website because Salesforce had no value.",

  size: "Headcount band from the employee count on the linked Salesforce Account.\n\n" +
    "Under 10, 10\u201349, 50\u2013249, 250+. Italic means it was estimated from the website.",

  since: "Client Since in Salesforce. This is month 1, which is what makes one " +
    "client's first quarter comparable to another's.",

  months: "Months that produced at least one result \u2014 not months since they started.\n\n" +
    "A client averages about 5 quiet months that are not counted here, so this " +
    "runs shorter than the calendar.",

  leads: "Every opportunity handed to the client, counted in the month it was created.\n\n" +
    "That is the month the lead was delivered. An opportunity that later became a " +
    "quote or a PO still counts as a lead here, in its own month.",

  appointments: "Opportunities that reached an appointment stage.\n\n" +
    "Counted strictly: a quote with no recorded appointment stage is not counted, " +
    "so this understates OSDR work rather than guessing.",

  quotes: "Opportunities that reached a quoting stage, or that were won \u2014 " +
    "you cannot win without quoting.\n\n" +
    "Excludes anything closed as No Quote.",

  pos: "Opportunities marked Closed Won.",

  poAmount: "Sum of PO Amount on won opportunities.\n\n" +
    "Salesforce leaves this blank on most POs, so it is a floor, not the true total. " +
    "A dash next to a PO count means the amount was never filled in.",

  perMonth: "Total leads divided by months that produced results.\n\n" +
    "The one figure that compares a three-month client with a three-year one.",

  first3: "Leads delivered in the client's first three months.\n\n" +
    "Blank for clients whose early months predate the opportunity data.",
};

export function ResultsTable({ clients }: { clients: ClientResult[] }) {
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState("");
  const [service, setService] = useState("");
  const [work, setWork] = useState("");
  const [size, setSize] = useState("");
  const [capability, setCapability] = useState("");
  const [onlySwitched, setOnlySwitched] = useState(false);

  const options = useMemo(() => {
    const uniq = (xs: (string | null)[]) =>
      [...new Set(xs.filter((x): x is string => Boolean(x)))].sort();
    return {
      status: uniq(clients.map((c) => c.status)),
      service: uniq(clients.flatMap((c) => c.servicesDelivered)),
      work: uniq(clients.map((c) => c.businessType)),
      capability: uniq(clients.flatMap((c) => c.capabilities)),
      size: SIZE_ORDER.filter((s) => clients.some((c) => c.sizeBand === s)),
    };
  }, [clients]);

  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    return clients.filter(
      (c) =>
        (!status || c.status === status) &&
        (!service || c.servicesDelivered.includes(service)) &&
        (!work || c.businessType === work) &&
        (!size || c.sizeBand === size) &&
        (!capability || c.capabilities.includes(capability)) &&
        (!onlySwitched || c.multiService) &&
        (!q ||
          c.name.toLowerCase().includes(q) ||
          (c.businessType ?? "").toLowerCase().includes(q) ||
          c.capabilities.some((x) => x.toLowerCase().includes(q))),
    );
  }, [clients, term, status, service, work, size, capability, onlySwitched]);

  const { sorted, sortProps } = useSort(shown, {
    name: (c) => c.name,
    status: (c) => c.status,
    service: (c) => c.busiestService ?? c.primaryService,
    work: (c) => c.businessType,
    size: (c) => (c.sizeBand ? SIZE_ORDER.indexOf(c.sizeBand) : null),
    since: (c) => c.clientSince,
    months: (c) => c.monthsWithResults,
    leads: (c) => c.leads,
    appointments: (c) => c.appointments,
    quotes: (c) => c.quotes,
    pos: (c) => c.pos,
    poAmount: (c) => c.poAmount,
    perMonth: (c) => c.leadsPerMonth,
    first3: (c) => c.first3.leads,
  });

  // Totals follow the filters, so a cohort's numbers are the ones on screen.
  const totals = useMemo(
    () =>
      shown.reduce(
        (a, c) => ({
          leads: a.leads + c.leads,
          appointments: a.appointments + c.appointments,
          quotes: a.quotes + c.quotes,
          pos: a.pos + c.pos,
          poAmount: a.poAmount + c.poAmount,
        }),
        { leads: 0, appointments: 0, quotes: 0, pos: 0, poAmount: 0 },
      ),
    [shown],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search"
          className="rounded-md border bg-background px-2 py-1 text-sm"
        />
        <Select value={status} onChange={setStatus} options={options.status} all="All statuses" />
        <Select value={service} onChange={setService} options={options.service} all="All services" />
        <Select value={work} onChange={setWork} options={options.work} all="All types of work" />
        <Select
          value={size}
          onChange={setSize}
          options={options.size}
          all="All sizes"
        />
        {options.capability.length > 0 && (
          <Select
            value={capability}
            onChange={setCapability}
            options={options.capability}
            all="All capabilities"
          />
        )}
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={onlySwitched}
            onChange={(e) => setOnlySwitched(e.target.checked)}
          />
          Changed service
        </label>
        <span className="ml-auto text-sm text-muted-foreground tabular-nums">
          {nf.format(shown.length)} clients · {nf.format(totals.leads)} leads ·{" "}
          {nf.format(totals.appointments)} appts · {nf.format(totals.quotes)} quotes ·{" "}
          {nf.format(totals.pos)} POs · {money.format(totals.poAmount)}
        </span>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <SortHeader {...sortProps("name")}><span title={HINTS.client}>Client</span></SortHeader>
              <SortHeader {...sortProps("status")}><span title={HINTS.status}>Status</span></SortHeader>
              <SortHeader {...sortProps("service")}><span title={HINTS.service}>Service</span></SortHeader>
              <SortHeader {...sortProps("work")}><span title={HINTS.work}>Type of work</span></SortHeader>
              <SortHeader {...sortProps("size")}><span title={HINTS.size}>Size</span></SortHeader>
              <SortHeader {...sortProps("since")}><span title={HINTS.since}>Started</span></SortHeader>
              <SortHeader {...sortProps("months")}><span title={HINTS.months}>Months</span></SortHeader>
              <SortHeader {...sortProps("leads")}><span title={HINTS.leads}>Leads</span></SortHeader>
              <SortHeader {...sortProps("appointments")}><span title={HINTS.appointments}>Appts</span></SortHeader>
              <SortHeader {...sortProps("quotes")}><span title={HINTS.quotes}>Quotes</span></SortHeader>
              <SortHeader {...sortProps("pos")}><span title={HINTS.pos}>POs</span></SortHeader>
              <SortHeader {...sortProps("poAmount")}><span title={HINTS.poAmount}>PO value</span></SortHeader>
              <SortHeader {...sortProps("perMonth")}><span title={HINTS.perMonth}>Leads / mo</span></SortHeader>
              <SortHeader {...sortProps("first3")}><span title={HINTS.first3}>First 3 mo</span></SortHeader>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={c.id} className="border-t hover:bg-muted/30">
                <td className="px-3 py-2">
                  <Link href={`/clients/results/${c.id}`} className="hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className={`px-3 py-2 ${STATUS_CLASS[c.status ?? ""] ?? ""}`}>
                  {c.status ?? "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  {c.servicesDelivered.length
                    ? c.servicesDelivered.join(" → ")
                    : c.primaryService ?? "—"}
                  {c.headlineMetric && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      {HEADLINE_LABEL[c.headlineMetric]}
                    </span>
                  )}
                </td>
                <td className="max-w-56 truncate px-3 py-2" title={c.businessType ?? ""}>
                  {c.businessType
                    ? c.businessTypeInferred
                      ? <Inferred>{c.businessType}</Inferred>
                      : c.businessType
                    : "—"}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {c.sizeBand ? (
                    c.sizeInferred ? (
                      <Inferred>{SIZE_LABEL[c.sizeBand]}</Inferred>
                    ) : (
                      SIZE_LABEL[c.sizeBand]
                    )
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                  {c.clientSince ?? "—"}
                </td>
                <td className="px-3 py-2 tabular-nums">{c.monthsWithResults || "—"}</td>
                <td className="px-3 py-2 tabular-nums">{c.leads ? nf.format(c.leads) : "—"}</td>
                <td className="px-3 py-2 tabular-nums">
                  {c.appointments ? nf.format(c.appointments) : "—"}
                </td>
                <td className="px-3 py-2 tabular-nums">{c.quotes ? nf.format(c.quotes) : "—"}</td>
                <td className="px-3 py-2 tabular-nums">{c.pos ? nf.format(c.pos) : "—"}</td>
                <td className="px-3 py-2 tabular-nums">
                  {c.poAmount ? money.format(c.poAmount) : "—"}
                </td>
                <td className="px-3 py-2 tabular-nums">{c.leadsPerMonth ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums">
                  {c.first3.leads ? nf.format(c.first3.leads) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
