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

export function ResultsTable({ clients }: { clients: ClientResult[] }) {
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState("");
  const [service, setService] = useState("");
  const [work, setWork] = useState("");
  const [size, setSize] = useState("");
  const [capability, setCapability] = useState("");

  const options = useMemo(() => {
    const uniq = (xs: (string | null)[]) =>
      [...new Set(xs.filter((x): x is string => Boolean(x)))].sort();
    return {
      status: uniq(clients.map((c) => c.status)),
      service: uniq(clients.flatMap((c) => c.services)),
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
        (!service || c.services.includes(service)) &&
        (!work || c.businessType === work) &&
        (!size || c.sizeBand === size) &&
        (!capability || c.capabilities.includes(capability)) &&
        (!q ||
          c.name.toLowerCase().includes(q) ||
          (c.businessType ?? "").toLowerCase().includes(q) ||
          c.capabilities.some((x) => x.toLowerCase().includes(q))),
    );
  }, [clients, term, status, service, work, size, capability]);

  const { sorted, sortProps } = useSort(shown, {
    name: (c) => c.name,
    status: (c) => c.status,
    service: (c) => c.primaryService,
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
              <SortHeader {...sortProps("name")}>Client</SortHeader>
              <SortHeader {...sortProps("status")}>Status</SortHeader>
              <SortHeader {...sortProps("service")}>Service</SortHeader>
              <SortHeader {...sortProps("work")}>Type of work</SortHeader>
              <SortHeader {...sortProps("size")}>Size</SortHeader>
              <SortHeader {...sortProps("since")}>Started</SortHeader>
              <SortHeader {...sortProps("months")}>Months</SortHeader>
              <SortHeader {...sortProps("leads")}>Leads</SortHeader>
              <SortHeader {...sortProps("appointments")}>Appts</SortHeader>
              <SortHeader {...sortProps("quotes")}>Quotes</SortHeader>
              <SortHeader {...sortProps("pos")}>POs</SortHeader>
              <SortHeader {...sortProps("poAmount")}>PO value</SortHeader>
              <SortHeader {...sortProps("perMonth")}>Leads / mo</SortHeader>
              <SortHeader {...sortProps("first3")}>First 3 mo</SortHeader>
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
                <td className="px-3 py-2">
                  {c.primaryService ?? "—"}
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
