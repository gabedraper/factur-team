"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createJob, updateJob, type JobInput } from "@/actions/talent-jobs";
import { Button } from "@/components/ui/button";
import { FIELD } from "@/lib/field-class";
import {
  EMPLOYMENT_TYPE, JOB_KIND, JOB_STATUS, REMOTE, SALARY_PERIOD,
  type Member, type Workflow,
} from "@/lib/talent/types";

type CompanyOption = { id: string; name: string };

const input = `w-full px-2 py-1.5 text-sm ${FIELD}`;
const select = "w-full rounded-md border bg-background px-2 py-1.5 text-sm";

function Row({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={wide ? "col-span-2 block" : "block"}>
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/**
 * One form for creating and editing a search.
 *
 * The fee fields only appear once the job is something other than an internal
 * hire, because a fee percentage on a role you are filling in your own company
 * is a field nobody can answer and everybody has to look at.
 */
export function JobForm({
  job, companies, members, workflows,
}: {
  job?: (JobInput & { id: string; public_slug?: string | null }) | null;
  companies: CompanyOption[];
  members: Member[];
  workflows: Workflow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<JobInput>({
    title: job?.title ?? "",
    company_id: job?.company_id ?? null,
    workflow_id: job?.workflow_id ?? null,
    status: job?.status ?? "active",
    job_kind: job?.job_kind ?? "internal",
    employment_type: job?.employment_type ?? "full_time",
    confidential: job?.confidential ?? false,
    description: job?.description ?? "",
    requirements: job?.requirements ?? "",
    internal_notes: job?.internal_notes ?? "",
    city: job?.city ?? "",
    state: job?.state ?? "",
    country: job?.country ?? "",
    remote: job?.remote ?? "onsite",
    salary_min: job?.salary_min ?? null,
    salary_max: job?.salary_max ?? null,
    salary_currency: job?.salary_currency ?? "USD",
    salary_period: job?.salary_period ?? "year",
    fee_type: job?.fee_type ?? null,
    fee_percent: job?.fee_percent ?? null,
    fee_flat: job?.fee_flat ?? null,
    openings: job?.openings ?? 1,
    owner_member_id: job?.owner_member_id ?? null,
    opened_on: job?.opened_on ?? null,
    target_fill_on: job?.target_fill_on ?? null,
  });

  function set<K extends keyof JobInput>(key: K, value: JobInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const billable = form.job_kind !== "internal";

  function save() {
    setError(null);
    start(async () => {
      try {
        if (job?.id) {
          await updateJob(job.id, form);
          router.push(`/talent/jobs/${job.id}`);
        } else {
          const id = await createJob(form);
          router.push(`/talent/jobs/${id}`);
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save that");
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 rounded-lg border bg-card p-4">
        <Row label="Title" wide>
          <input
            className={input}
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Outbound SDR"
            autoFocus
          />
        </Row>

        <Row label="Company">
          <select
            className={select}
            value={form.company_id ?? ""}
            onChange={(e) => set("company_id", e.target.value || null)}
          >
            <option value="">—</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Row>

        <Row label="Owner">
          <select
            className={select}
            value={form.owner_member_id ?? ""}
            onChange={(e) => set("owner_member_id", e.target.value || null)}
          >
            <option value="">Me</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>
            ))}
          </select>
        </Row>

        <Row label="Status">
          <select className={select} value={form.status} onChange={(e) => set("status", e.target.value)}>
            {Object.entries(JOB_STATUS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Row>

        <Row label="Type">
          <select className={select} value={form.job_kind} onChange={(e) => set("job_kind", e.target.value)}>
            {Object.entries(JOB_KIND).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Row>

        <Row label="Employment">
          <select
            className={select}
            value={form.employment_type}
            onChange={(e) => set("employment_type", e.target.value)}
          >
            {Object.entries(EMPLOYMENT_TYPE).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Row>

        <Row label="Pipeline">
          <select
            className={select}
            value={form.workflow_id ?? ""}
            onChange={(e) => set("workflow_id", e.target.value || null)}
          >
            <option value="">Default</option>
            {workflows.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </Row>

        <Row label="Openings">
          <input
            className={input}
            type="number"
            min={0}
            value={form.openings ?? 1}
            onChange={(e) => set("openings", Number(e.target.value))}
          />
        </Row>

        <Row label="Working arrangement">
          <select className={select} value={form.remote} onChange={(e) => set("remote", e.target.value)}>
            {Object.entries(REMOTE).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Row>

        <Row label="City">
          <input className={input} value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} />
        </Row>
        <Row label="State">
          <input className={input} value={form.state ?? ""} onChange={(e) => set("state", e.target.value)} />
        </Row>

        <Row label="Opened">
          <input
            className={input} type="date"
            value={form.opened_on ?? ""}
            onChange={(e) => set("opened_on", e.target.value || null)}
          />
        </Row>
        <Row label="Target fill">
          <input
            className={input} type="date"
            value={form.target_fill_on ?? ""}
            onChange={(e) => set("target_fill_on", e.target.value || null)}
          />
        </Row>

        <Row label="Salary from">
          <input
            className={input} type="number"
            value={form.salary_min ?? ""}
            onChange={(e) => set("salary_min", num(e.target.value))}
          />
        </Row>
        <Row label="Salary to">
          <input
            className={input} type="number"
            value={form.salary_max ?? ""}
            onChange={(e) => set("salary_max", num(e.target.value))}
          />
        </Row>

        <Row label="Per">
          <select
            className={select}
            value={form.salary_period}
            onChange={(e) => set("salary_period", e.target.value)}
          >
            {Object.entries(SALARY_PERIOD).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Row>

        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input
            type="checkbox"
            checked={form.confidential ?? false}
            onChange={(e) => set("confidential", e.target.checked)}
          />
          Confidential
        </label>

        {billable && (
          <>
            <Row label="Fee">
              <select
                className={select}
                value={form.fee_type ?? ""}
                onChange={(e) => set("fee_type", e.target.value || null)}
              >
                <option value="">—</option>
                <option value="percentage">Percentage</option>
                <option value="flat">Flat</option>
                <option value="hourly_markup">Hourly markup</option>
              </select>
            </Row>
            <Row label={form.fee_type === "flat" ? "Amount" : "Percent"}>
              <input
                className={input} type="number" step="0.01"
                value={(form.fee_type === "flat" ? form.fee_flat : form.fee_percent) ?? ""}
                onChange={(e) =>
                  form.fee_type === "flat"
                    ? set("fee_flat", num(e.target.value))
                    : set("fee_percent", num(e.target.value))
                }
              />
            </Row>
          </>
        )}
      </div>

      <div className="grid gap-3 rounded-lg border bg-card p-4">
        <Row label="Description" wide>
          <textarea
            className={`${input} min-h-32`}
            value={form.description ?? ""}
            onChange={(e) => set("description", e.target.value)}
          />
        </Row>
        <Row label="Requirements" wide>
          <textarea
            className={`${input} min-h-24`}
            value={form.requirements ?? ""}
            onChange={(e) => set("requirements", e.target.value)}
          />
        </Row>
        <Row label="Internal notes" wide>
          <textarea
            className={`${input} min-h-20`}
            value={form.internal_notes ?? ""}
            onChange={(e) => set("internal_notes", e.target.value)}
          />
        </Row>
      </div>

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button onClick={save} disabled={pending || !form.title.trim()}>
          {pending ? "Saving…" : job?.id ? "Save" : "Create job"}
        </Button>
        <Button variant="ghost" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
