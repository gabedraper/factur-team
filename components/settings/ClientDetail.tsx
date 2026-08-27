"use client";

import { useState, useTransition } from "react";
import { setClientRole, setClientLead, setClientOwner, setClientService } from "@/actions/org";

type Person = { id: string; name: string };
type Team = Record<string, unknown> | null;

const money = (v: unknown) =>
  typeof v === "number" ? v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : "—";
const date = (v: unknown) =>
  typeof v === "string" && v
    ? new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : "—";
const text = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

export function ClientDetail({
  client, salesforce, team, people, services, roles, assignments,
}: {
  client: Record<string, unknown>;
  salesforce: Record<string, unknown> | null;
  team: Team;
  people: Person[];
  services: { id: string; name: string }[];
  /** The roles Settings says are assigned per client, in the order shown. */
  roles: { id: string; name: string }[];
  assignments: Record<string, string | null>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const id = String(client.id);

  function run(fn: () => Promise<{ success: boolean; error?: string }>) {
    setError("");
    startTransition(async () => {
      const res = await fn();
      if (!res.success) setError(res.error ?? "Something went wrong");
    });
  }

  const Picker = ({
    value, onChange, placeholder = "— none —",
  }: { value: string; onChange: (v: string | null) => void; placeholder?: string }) => (
    <select
      className="h-8 w-full max-w-64 rounded-md border bg-field px-2 text-sm"
      value={value}
      disabled={pending}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{placeholder}</option>
      {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );

  const ownerValue = client.team_id ? `pod:${client.team_id}` : client.member_id ? `person:${client.member_id}` : "";

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      <section className="rounded-md border bg-card p-4 space-y-3">
        <h2 className="text-sm font-medium">Team {pending && <span className="text-xs text-muted-foreground">· saving…</span>}</h2>

        <div className="grid gap-3 sm:grid-cols-2">
          {roles.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No roles are set to be assigned per client.
            </p>
          )}
          {roles.map((r) => (
            <label key={r.id} className="block">
              <span className="mb-1 block text-xs text-muted-foreground">{r.name}</span>
              <Picker
                value={String(assignments[r.id] ?? "")}
                onChange={(v) => run(() => setClientRole(id, r.id, v))}
              />
            </label>
          ))}
        </div>

        <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
          {([
            ["team_lead_id", "Team Lead", "team_lead", "team_lead_overridden", "the account manager’s manager"],
            ["data_team_lead_id", "Data Team Lead", "data_team_lead", "data_team_lead_overridden", "the data analyst’s manager"],
          ] as const).map(([field, label, nameKey, flagKey, derivedFrom]) => {
            const overridden = Boolean(team?.[flagKey]);
            return (
              <label key={field} className="block">
                <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
                <Picker
                  value={String(client[field] ?? "")}
                  onChange={(v) => run(() => setClientLead(id, field, v))}
                  placeholder={
                    team?.[nameKey] ? `${team[nameKey]} (from ${derivedFrom})` : "— nobody —"
                  }
                />
                <span className="mt-1 block text-xs text-muted-foreground">
                  {overridden
                    ? "Set by hand. Clear it to follow the reporting line again."
                    : `Follows ${derivedFrom}.`}
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="rounded-md border bg-card p-4 space-y-3">
        <h2 className="text-sm font-medium">Service</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">Service</span>
            <select
              className="h-8 w-full max-w-64 rounded-md border bg-field px-2 text-sm"
              value={String(client.service_id ?? "")}
              disabled={pending}
              onChange={(e) => run(() => setClientService(id, e.target.value || null))}
            >
              <option value="">— none —</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>
      </section>

      {salesforce && (
        <section className="rounded-md border bg-card p-4">
          <h2 className="mb-1 text-sm font-medium">From Salesforce</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Read-only. Change these in Salesforce; they refresh on the next sync.
          </p>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {([
              ["Status", text(salesforce.client_status__c)],
              ["Account", text(salesforce.client_account__r_name)],
              ["Service", text(salesforce.service__c)],
              ["Service level", text(salesforce.service_level__c)],
              ["Owner", text(salesforce.owner_name)],
              ["Client owner", text(salesforce.client_owner__c)],
              ["Health score", text(salesforce.health_score__c)],
              ["Performance", text(salesforce.client_performance__c)],
              ["Client since", date(salesforce.client_since__c)],
              ["Client end", date(salesforce.client_end__c)],
              ["Contract start", date(salesforce.contract_start__c)],
              ["Contract end", date(salesforce.contract_end__c)],
              ["Days until contract ends", text(salesforce.days_until_the_contract_ends__c)],
              ["Agreement length", text(salesforce.agreement_length__c)],
              ["Months of service", text(salesforce.months_of_service__c)],
              ["Month to month", salesforce.month_to_month_agreement__c ? "Yes" : "No"],
              ["Signed MSA", salesforce.signed_msa__c ? "Yes" : "No"],
              ["Monthly billing rate", money(salesforce.monthly_billing_rate__c)],
              ["Total revenue", money(salesforce.total_revenue__c)],
              ["Lifetime revenue", money(salesforce.client_lifetime_revenue__c)],
              ["Open balance", money(salesforce.open_balance__c)],
              ["Last invoice sent", date(salesforce.last_invoice_sent__c)],
              ["Last payment received", date(salesforce.last_payment_received__c)],
              ["Last activity", date(salesforce.lastactivitydate)],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b py-1 last:border-0">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="text-right">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
