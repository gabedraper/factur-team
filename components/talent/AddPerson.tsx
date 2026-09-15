"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { createPerson, findPossibleDuplicates, type PersonInput } from "@/actions/talent";
import { Button } from "@/components/ui/button";
import { FIELD } from "@/lib/field-class";
import { PERSON_TYPE } from "@/lib/talent/types";
import { Field } from "@/components/ui/field";

type Dupe = {
  id: string; name: string; title: string | null;
  company: string | null; primary_email: string | null;
};

const input = `w-full px-2 py-1.5 text-body ${FIELD}`;

/**
 * Adding somebody by hand.
 *
 * The duplicate check runs when the email or name field is left, not on submit.
 * Told afterwards, a recruiter has already typed the whole record and will add
 * it anyway; told while they are still filling it in, they open the existing
 * profile instead. That difference is the entire value of the check.
 */
export function AddPerson({ onAdded }: { onAdded?: (id: string) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PersonInput>({ full_name: "", emails: "", person_types: ["candidate"] });
  const [dupes, setDupes] = useState<Dupe[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function set<K extends keyof PersonInput>(key: K, value: PersonInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function check() {
    if (!form.full_name?.trim() && !form.emails?.trim()) return;
    start(async () => {
      setDupes(await findPossibleDuplicates({
        full_name: form.full_name, emails: form.emails, linkedin_url: form.linkedin_url,
      }));
    });
  }

  function submit() {
    setError(null);
    start(async () => {
      const result = await createPerson(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setForm({ full_name: "", emails: "", person_types: ["candidate"] });
      setDupes([]);
      onAdded?.(result.id);
      router.push(`/talent/people/${result.id}`);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 h-4 w-4" />
        Add person
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 p-6 pt-20">
      <div className="w-full max-w-lg space-y-3 rounded-md bg-card p-card shadow-modal">
        <div className="flex items-center">
          <h2 className="text-body font-semibold">Add person</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ml-auto text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Name" className="col-span-2">
            <input
              className={input}
              value={form.full_name ?? ""}
              onChange={(e) => set("full_name", e.target.value)}
              onBlur={check}
              autoFocus
            />
          </Field>

          <Field label="Email">
            <input
              className={input}
              value={form.emails ?? ""}
              onChange={(e) => set("emails", e.target.value)}
              onBlur={check}
            />
          </Field>

          <Field label="Phone">
            <input
              className={input}
              value={form.phones ?? ""}
              onChange={(e) => set("phones", e.target.value)}
            />
          </Field>

          <Field label="Title">
            <input className={input} value={form.title ?? ""} onChange={(e) => set("title", e.target.value)} />
          </Field>

          <Field label="Company">
            <input
              className={input}
              value={form.company_name ?? ""}
              onChange={(e) => set("company_name", e.target.value)}
            />
          </Field>

          <Field label="City">
            <input className={input} value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} />
          </Field>

          <Field label="State">
            <input className={input} value={form.state ?? ""} onChange={(e) => set("state", e.target.value)} />
          </Field>

          <Field label="LinkedIn" className="col-span-2">
            <input
              className={input}
              value={form.linkedin_url ?? ""}
              onChange={(e) => set("linkedin_url", e.target.value)}
              onBlur={check}
            />
          </Field>

          <fieldset className="col-span-2">
            <span className="mb-1 block text-meta font-medium text-muted-foreground">Type</span>
            <div className="flex flex-wrap gap-3">
              {Object.entries(PERSON_TYPE).map(([k, v]) => (
                <label key={k} className="flex items-center gap-1.5 text-body">
                  <input
                    type="checkbox"
                    checked={form.person_types?.includes(k) ?? false}
                    onChange={(e) =>
                      set(
                        "person_types",
                        e.target.checked
                          ? [...(form.person_types ?? []), k]
                          : (form.person_types ?? []).filter((t) => t !== k)
                      )
                    }
                  />
                  {v}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        {dupes.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
            <p className="text-meta font-medium text-amber-900 dark:text-amber-200">
              Already here
            </p>
            <ul className="mt-1 space-y-1">
              {dupes.map((d) => (
                <li key={d.id} className="text-body">
                  <Link
                    href={`/talent/people/${d.id}`}
                    className="text-amber-900 underline underline-offset-4 dark:text-amber-100"
                  >
                    {d.name}
                  </Link>
                  <span className="ml-2 text-meta text-amber-800/80 dark:text-amber-200/70">
                    {[d.title, d.company, d.primary_email].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="text-body text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex gap-2">
          <Button size="sm" onClick={submit} disabled={pending || !form.full_name?.trim()}>
            {pending ? "Adding…" : "Add"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
