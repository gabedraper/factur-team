"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { createCompany, updateCompany, type CompanyInput } from "@/actions/talent";
import { Button } from "@/components/ui/button";
import { FIELD } from "@/lib/field-class";
import { COMPANY_KIND } from "@/lib/talent/types";

const input = `w-full px-2 py-1.5 text-sm ${FIELD}`;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/**
 * Add or edit a company. Shown as a panel rather than its own page because a
 * company record is eight fields and a round trip to a form page for eight
 * fields is a round trip nobody wants.
 */
export function CompanyForm({
  company, clients, trigger = "Add company",
}: {
  company?: (CompanyInput & { id: string }) | null;
  clients: { id: string; name: string }[];
  trigger?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [form, setForm] = useState<CompanyInput>({
    name: company?.name ?? "",
    domain: company?.domain ?? "",
    website: company?.website ?? "",
    linkedin_url: company?.linkedin_url ?? "",
    industry: company?.industry ?? "",
    headcount_label: company?.headcount_label ?? "",
    city: company?.city ?? "",
    state: company?.state ?? "",
    phone: company?.phone ?? "",
    description: company?.description ?? "",
    kind: company?.kind ?? "prospect",
    status: company?.status ?? "active",
    org_client_id: company?.org_client_id ?? null,
  });

  function set<K extends keyof CompanyInput>(key: K, value: CompanyInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function submit() {
    setError(null);
    start(async () => {
      if (company?.id) {
        const result = await updateCompany(company.id, form);
        if (!result.ok) {
          setError(result.error);
          return;
        }
      } else {
        const result = await createCompany(form);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.push(`/talent/companies/${result.id}`);
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button size="sm" variant={company ? "outline" : "default"} onClick={() => setOpen(true)}>
        {!company && <Plus className="mr-1.5 h-4 w-4" />}
        {trigger}
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 p-6 pt-20">
      <div className="w-full max-w-lg space-y-3 rounded-lg border bg-card p-4 shadow-xl">
        <div className="flex items-center">
          <h2 className="text-sm font-semibold">{company ? "Edit company" : "Add company"}</h2>
          <button
            type="button" onClick={() => setOpen(false)}
            className="ml-auto text-muted-foreground hover:text-foreground" aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <Field label="Name">
              <input className={input} value={form.name} autoFocus
                onChange={(e) => set("name", e.target.value)} />
            </Field>
          </div>
          <Field label="Domain">
            <input className={input} value={form.domain ?? ""} placeholder="acme.com"
              onChange={(e) => set("domain", e.target.value)} />
          </Field>
          <Field label="Industry">
            <input className={input} value={form.industry ?? ""}
              onChange={(e) => set("industry", e.target.value)} />
          </Field>
          <Field label="City">
            <input className={input} value={form.city ?? ""}
              onChange={(e) => set("city", e.target.value)} />
          </Field>
          <Field label="State">
            <input className={input} value={form.state ?? ""}
              onChange={(e) => set("state", e.target.value)} />
          </Field>
          <Field label="Headcount">
            <input className={input} value={form.headcount_label ?? ""} placeholder="51-200"
              onChange={(e) => set("headcount_label", e.target.value)} />
          </Field>
          <Field label="Phone">
            <input className={input} value={form.phone ?? ""}
              onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Type">
            <select className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              value={form.kind} onChange={(e) => set("kind", e.target.value)}>
              {Object.entries(COMPANY_KIND).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label="Factur client">
            <select className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              value={form.org_client_id ?? ""}
              onChange={(e) => set("org_client_id", e.target.value || null)}>
              <option value="">—</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <div className="col-span-2">
            <Field label="Notes">
              <textarea className={`${input} min-h-20`} value={form.description ?? ""}
                onChange={(e) => set("description", e.target.value)} />
            </Field>
          </div>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex gap-2">
          <Button size="sm" onClick={submit} disabled={pending || !form.name.trim()}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
