"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectGroup, SelectLabel, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Panel } from "@/components/pipeline/bits";
import { updateOpportunity } from "@/actions/pipeline";

// Salesforce's actual Opportunity.StageName picklist, read from the org's
// field metadata -- Skyvia syncs this both ways, so this can't drift from
// what Salesforce will actually accept or the sync starts rejecting writes.
const STAGE_GROUPS: { label: string; values: string[] }[] = [
  {
    label: "Prospecting",
    values: [
      "Prospecting: Pipeline Cold", "Prospecting: Cold Call List", "Prospecting: Cold Referral",
      "Prospecting: Warm Referral", "Prospecting: Referred", "Lead Generated", "Lead Generated: Scheduled",
    ],
  },
  {
    label: "Pipeline",
    values: [
      "Pipeline: Warm", "Pipeline: Hot", "Pipeline: LT Follow Up", "Pipeline - Selling",
      "Pipeline Hot: Client RFQ Review", "Pipeline Hot: Quote Follow up", "Pipeline Hot: Quoting",
      "Pipeline Hot: Supplier forms / NDA", "Pipeline Hot: Appointment set",
    ],
  },
  {
    label: "Closed",
    values: ["Closed: Closed Won", "Closed: Closed Lost", "Closed: DQ Contact", "Closed: DQ Company", "Closed: No Quote"],
  },
  { label: "Other", values: ["Sales Support"] },
];

// Salesforce's Opportunity.Prospecting_Lead_Status__c picklist, same reason.
const LEAD_STATUSES = [
  "Pipeline - Cold", "Pipeline - Warm SDR", "Pipeline - Warm", "Pipeline - Selling",
  "Closing", "LTFU", "Lost Follow Up", "Customer", "Relationship", "No Fit Ever - Contact", "No Fit Ever - Account",
];

const FUNNEL_STEPS = [
  { key: "reached_lead", label: "Lead" },
  { key: "reached_eval_call_scheduled", label: "Eval call scheduled" },
  { key: "reached_selling", label: "Selling" },
  { key: "reached_discovery", label: "Discovery" },
  { key: "reached_proposal", label: "Proposal" },
  { key: "reached_closing", label: "Closing" },
] as const;

type FunnelKey = (typeof FUNNEL_STEPS)[number]["key"];

export type EditableOpportunity = {
  id: string;
  stage: string;
  lead_status: string | null;
  notes: string | null;
  next_action_date: string | null;
  updates: string | null;
} & Record<FunnelKey, boolean>;

export function OpportunityEditor({ opportunity }: { opportunity: EditableOpportunity }) {
  const [state, setState] = useState(opportunity);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  function save(patch: Partial<EditableOpportunity>) {
    const next = { ...state, ...patch };
    setState(next);
    setError(null);
    start(async () => {
      try {
        await updateOpportunity(opportunity.id, patch);
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      } catch (e) {
        setState(state);
        setError(e instanceof Error ? e.message : "Could not save that change.");
      }
    });
  }

  return (
    <Panel title="Pursuit" action={saved && <span className="flex items-center gap-1 text-xs text-emerald-600"><Check className="h-3 w-3" /> Saved</span>}>
      <div className="space-y-3 p-4">
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div>
          <label className="text-xs text-muted-foreground">Stage</label>
          <Select value={state.stage} onValueChange={(v) => save({ stage: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {STAGE_GROUPS.map((g) => (
                <SelectGroup key={g.label}>
                  <SelectLabel>{g.label}</SelectLabel>
                  {g.values.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-xs text-muted-foreground">Lead status</label>
          <Select value={state.lead_status ?? ""} onValueChange={(v) => save({ lead_status: v })}>
            <SelectTrigger><SelectValue placeholder="Not set" /></SelectTrigger>
            <SelectContent>
              {LEAD_STATUSES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Funnel reached</label>
          <div className="flex flex-wrap gap-2">
            {FUNNEL_STEPS.map((step) => {
              const on = state[step.key];
              return (
                <button
                  key={step.key}
                  type="button"
                  onClick={() => save({ [step.key]: !on } as Partial<EditableOpportunity>)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    on ? "border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {on ? "✓ " : ""}{step.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="text-xs text-muted-foreground">Next action</label>
          <Input
            type="date"
            value={state.next_action_date ?? ""}
            onChange={(e) => save({ next_action_date: e.target.value || null })}
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground">Updates</label>
          <Textarea
            value={state.updates ?? ""}
            onChange={(e) => setState((s) => ({ ...s, updates: e.target.value }))}
            onBlur={(e) => save({ updates: e.target.value || null })}
            rows={2}
            placeholder="Running note reps work from day to day"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground">Notes</label>
          <Textarea
            value={state.notes ?? ""}
            onChange={(e) => setState((s) => ({ ...s, notes: e.target.value }))}
            onBlur={(e) => save({ notes: e.target.value || null })}
            rows={2}
          />
        </div>
      </div>
    </Panel>
  );
}
