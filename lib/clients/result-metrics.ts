/*
 * The shapes and labels, with no database behind them, so the table component
 * can import them -- lib/clients/results.ts opens a Supabase connection and
 * pulling that into a client bundle drags next/headers along with it.
 */

/**
 * What each service is contracted to produce.
 *
 * LG delivers leads, OSDR turns them into appointments, OBDM and OP carry them
 * through to a quote. Every service tracks POs, which is why POs are not on
 * this list -- they are the outcome shown next to the headline, never the
 * headline itself.
 */
export const HEADLINE_LABEL = {
  leads: "Leads",
  appointments: "Appointments",
  quotes: "Quotes",
} as const;

export type HeadlineMetric = keyof typeof HEADLINE_LABEL;

export type ClientResult = {
  id: string;
  name: string;
  website: string | null;
  status: string | null;
  services: string[];
  primaryService: string | null;
  headlineMetric: HeadlineMetric | null;
  clientSince: string | null;
  clientEnd: string | null;
  monthsElapsed: number | null;
  businessType: string | null;
  businessTypeInferred: boolean;
  capabilities: string[];
  materials: string[];
  certifications: string[];
  marketsServed: string[];
  employees: number | null;
  sizeBand: string | null;
  sizeInferred: boolean;
  industry: string | null;
  summary: string | null;
  servicesDelivered: string[];
  busiestService: string | null;
  multiService: boolean;
  monthsWithResults: number;
  leads: number;
  appointments: number;
  quotes: number;
  pos: number;
  poAmount: number;
  quoteAmount: number;
  first3: { leads: number; appointments: number; quotes: number; pos: number };
  leadsPerMonth: number | null;
};

/** One stint a client spent on a service. Overlaps between rows are legitimate. */
export type ServicePeriod = {
  id: string;
  service: string;
  startedOn: string;
  endedOn: string | null;
  monthlyRate: number | null;
  tier: string | null;
  note: string | null;
  source: string;
};

/** One service's run of months, in engagement order. */
export type ServiceSeries = {
  service: string;
  headline: HeadlineMetric | null;
  months: MonthRow[];
  totals: { leads: number; appointments: number; quotes: number; quoteAmount: number; pos: number; poAmount: number };
};

export type MonthRow = {
  service: string;
  monthIndex: number;
  monthStart: string;
  leads: number;
  appointments: number;
  quotes: number;
  pos: number;
  quoteAmount: number;
  poAmount: number;
};

/**
 * Which metric a service is contracted on. Mirrors the SQL function of the
 * same name; both exist because the view sorts on it and the page labels with
 * it, and neither should have to call the other.
 */
export function serviceHeadline(service: string | null): HeadlineMetric | null {
  if (!service) return null;
  if (["OP", "OBDM", "SMB - OBDM", "Constructur - OBDM"].includes(service)) return "quotes";
  if (["OSDR", "SMB - OSDR", "Constructur - OSDR"].includes(service)) return "appointments";
  if (["LG", "Constructur - LG", "RG"].includes(service)) return "leads";
  return null;
}
