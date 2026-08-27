"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  deleteEducation, deleteWorkHistory, saveEducation, saveWorkHistory,
  setPersonContacts, setPersonField,
} from "@/actions/talent";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/talent/bits";
import { FIELD } from "@/lib/field-class";
import { onDay } from "@/lib/talent/format";
import type { Contact, Member, Person } from "@/lib/talent/types";

const input = `w-full px-2 py-1.5 text-sm ${FIELD}`;

/**
 * A field that shows its value until it is clicked.
 *
 * The profile is mostly read, occasionally corrected, so the default state is
 * the value rather than a box. Escape abandons the edit and Enter commits it,
 * because a profile gets fixed one field at a time between calls and reaching
 * for a Save button forty times a day is the thing that stops people doing it.
 */
function Inline({
  label, value, onSave, multiline, type = "text", disabled,
}: {
  label: string;
  value: string | null;
  onSave: (next: string) => Promise<void>;
  multiline?: boolean;
  type?: string;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [pending, start] = useTransition();

  function commit() {
    start(async () => {
      await onSave(draft);
      setEditing(false);
    });
  }

  if (!editing) {
    return (
      <div className="group min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="flex items-center gap-1.5">
          <span className={`text-sm ${value ? "" : "text-muted-foreground"} ${multiline ? "whitespace-pre-wrap" : "truncate"}`}>
            {value || "—"}
          </span>
          {!disabled && (
            <button
              type="button"
              onClick={() => { setDraft(value ?? ""); setEditing(true); }}
              className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
              aria-label={`Edit ${label}`}
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="flex items-start gap-1">
        {multiline ? (
          <textarea
            className={`${input} min-h-20`}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          />
        ) : (
          <input
            className={input}
            type={type}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        )}
        <button type="button" onClick={commit} disabled={pending} aria-label="Save" className="mt-1.5">
          <Check className="h-4 w-4 text-emerald-600" />
        </button>
        <button type="button" onClick={() => setEditing(false)} aria-label="Cancel" className="mt-1.5">
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}

/** Emails or phones, where the first entry is the one the app uses. */
function Contacts({
  personId, kind, values, canEdit,
}: {
  personId: string;
  kind: "emails" | "phones";
  values: Contact[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [list, setList] = useState(values);
  const [adding, setAdding] = useState("");
  const [, start] = useTransition();

  function persist(next: Contact[]) {
    setList(next);
    start(async () => {
      await setPersonContacts(personId, kind, next);
      router.refresh();
    });
  }

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {kind === "emails" ? "Email" : "Phone"}
      </div>
      <ul className="space-y-0.5">
        {list.length === 0 && <li className="text-sm text-muted-foreground">—</li>}
        {list.map((c, i) => (
          <li key={`${c.value}-${i}`} className="group flex items-center gap-1.5 text-sm">
            <a
              href={kind === "emails" ? `mailto:${c.value}` : `tel:${c.value}`}
              className="truncate hover:underline"
            >
              {c.value}
            </a>
            {i === 0 && <span className="shrink-0 text-[10px] text-muted-foreground">primary</span>}
            {canEdit && (
              <span className="ml-auto flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                {i > 0 && (
                  <button
                    type="button"
                    onClick={() => persist([list[i], ...list.filter((_, j) => j !== i)])}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Make primary
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => persist(list.filter((_, j) => j !== i))}
                  aria-label="Remove"
                >
                  <Trash2 className="h-3 w-3 text-muted-foreground hover:text-red-600" />
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>

      {canEdit && (
        <div className="mt-1 flex gap-1">
          <input
            className={`${input} py-1 text-xs`}
            value={adding}
            placeholder={kind === "emails" ? "Add email" : "Add phone"}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && adding.trim()) {
                persist([...list, { value: adding.trim(), type: kind === "emails" ? "work" : "mobile" }]);
                setAdding("");
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

type HistoryRow = {
  id: string; company_name: string | null; title: string | null;
  started_on: string | null; ended_on: string | null; is_current: boolean;
  description: string | null;
};

type EducationRow = {
  id: string; school: string | null; degree: string | null;
  field_of_study: string | null; started_on: string | null; ended_on: string | null;
};

export function PersonEditor({
  person, history, education, members, canEdit,
}: {
  person: Person;
  history: HistoryRow[];
  education: EducationRow[];
  members: Member[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [newRole, setNewRole] = useState(false);
  const [newSchool, setNewSchool] = useState(false);

  const save = (field: string) => async (value: string) => {
    await setPersonField(person.id, field, value.trim() === "" ? null : value);
    router.refresh();
  };

  const saveNumber = (field: string) => async (value: string) => {
    await setPersonField(person.id, field, value.trim() === "" ? null : Number(value));
    router.refresh();
  };

  const saveList = (field: string) => async (value: string) => {
    await setPersonField(
      person.id, field,
      value.split(/[,;\n]/).map((v) => v.trim()).filter(Boolean)
    );
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <Panel title="Contact">
        <div className="grid grid-cols-2 gap-4 px-4 py-3">
          <Contacts personId={person.id} kind="emails" values={person.emails} canEdit={canEdit} />
          <Contacts personId={person.id} kind="phones" values={person.phones} canEdit={canEdit} />
          <Inline label="LinkedIn" value={person.linkedin_url} onSave={save("linkedin_url")} disabled={!canEdit} />
          <Inline label="Website" value={person.personal_website} onSave={save("personal_website")} disabled={!canEdit} />
          <Inline label="City" value={person.city} onSave={save("city")} disabled={!canEdit} />
          <Inline label="State" value={person.state} onSave={save("state")} disabled={!canEdit} />
        </div>
      </Panel>

      <Panel title="Profile">
        <div className="grid grid-cols-2 gap-4 px-4 py-3">
          <Inline label="Title" value={person.title} onSave={save("title")} disabled={!canEdit} />
          <Inline label="Company" value={person.company_name} onSave={save("company_name")} disabled={!canEdit} />
          <Inline label="Seniority" value={person.seniority} onSave={save("seniority")} disabled={!canEdit} />
          <Inline
            label="Years experience"
            value={person.years_experience?.toString() ?? null}
            onSave={saveNumber("years_experience")}
            type="number"
            disabled={!canEdit}
          />
          <div className="col-span-2">
            <Inline
              label="Skills"
              value={person.skills.join(", ")}
              onSave={saveList("skills")}
              disabled={!canEdit}
            />
          </div>
          <div className="col-span-2">
            <Inline label="Summary" value={person.summary} onSave={save("summary")} multiline disabled={!canEdit} />
          </div>
        </div>
      </Panel>

      <Panel title="Compensation">
        <div className="grid grid-cols-2 gap-4 px-4 py-3">
          <Inline
            label="Current"
            value={person.current_salary?.toString() ?? null}
            onSave={saveNumber("current_salary")}
            type="number"
            disabled={!canEdit}
          />
          <Inline
            label="Expectation"
            value={person.salary_expectation?.toString() ?? null}
            onSave={saveNumber("salary_expectation")}
            type="number"
            disabled={!canEdit}
          />
          <div className="col-span-2">
            <Inline
              label="Notes"
              value={person.compensation_notes}
              onSave={save("compensation_notes")}
              multiline
              disabled={!canEdit}
            />
          </div>
        </div>
      </Panel>

      <Panel
        title="Work history"
        action={canEdit && (
          <Button size="sm" variant="ghost" onClick={() => setNewRole((v) => !v)}>
            <Plus className="h-4 w-4" />
          </Button>
        )}
      >
        {newRole && <RoleForm personId={person.id} onDone={() => setNewRole(false)} />}
        {history.length === 0 && !newRole ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">—</p>
        ) : (
          <ul className="divide-y">
            {history.map((h) => (
              <li key={h.id} className="group flex gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{h.title ?? "—"}</p>
                  <p className="text-sm text-muted-foreground">{h.company_name ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    {onDay(h.started_on)} – {h.is_current ? "present" : onDay(h.ended_on)}
                  </p>
                  {h.description && (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{h.description}</p>
                  )}
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => start(async () => {
                      await deleteWorkHistory(person.id, h.id);
                      router.refresh();
                    })}
                    className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label="Remove"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-600" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Education"
        action={canEdit && (
          <Button size="sm" variant="ghost" onClick={() => setNewSchool((v) => !v)}>
            <Plus className="h-4 w-4" />
          </Button>
        )}
      >
        {newSchool && <SchoolForm personId={person.id} onDone={() => setNewSchool(false)} />}
        {education.length === 0 && !newSchool ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">—</p>
        ) : (
          <ul className="divide-y">
            {education.map((e) => (
              <li key={e.id} className="group flex gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{e.school ?? "—"}</p>
                  <p className="text-sm text-muted-foreground">
                    {[e.degree, e.field_of_study].filter(Boolean).join(", ") || "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {onDay(e.started_on)} – {onDay(e.ended_on)}
                  </p>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => start(async () => {
                      await deleteEducation(person.id, e.id);
                      router.refresh();
                    })}
                    className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label="Remove"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-600" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {canEdit && (
        <Panel title="Record">
          <div className="grid grid-cols-2 gap-4 px-4 py-3">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">Owner</span>
              <select
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                defaultValue={person.owner_member_id ?? ""}
                onChange={(e) => start(async () => {
                  await setPersonField(person.id, "owner_member_id", e.target.value || null);
                  router.refresh();
                })}
              >
                <option value="">Nobody</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input
                type="checkbox"
                defaultChecked={person.do_not_contact}
                onChange={(e) => start(async () => {
                  await setPersonField(person.id, "do_not_contact", e.target.checked);
                  router.refresh();
                })}
              />
              Do not contact
            </label>
          </div>
        </Panel>
      )}
    </div>
  );
}

function RoleForm({ personId, onDone }: { personId: string; onDone: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState({
    title: "", company_name: "", started_on: "", ended_on: "", is_current: false, description: "",
  });
  const [pending, start] = useTransition();

  return (
    <div className="grid grid-cols-2 gap-2 border-b bg-muted/30 px-4 py-3">
      <input className={input} placeholder="Title" value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus />
      <input className={input} placeholder="Company" value={form.company_name}
        onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
      <input className={input} type="date" value={form.started_on}
        onChange={(e) => setForm({ ...form, started_on: e.target.value })} />
      <input className={input} type="date" value={form.ended_on} disabled={form.is_current}
        onChange={(e) => setForm({ ...form, ended_on: e.target.value })} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.is_current}
          onChange={(e) => setForm({ ...form, is_current: e.target.checked })} />
        Current
      </label>
      <textarea className={`${input} col-span-2 min-h-16`} placeholder="Description"
        value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <div className="col-span-2 flex gap-2">
        <Button size="sm" disabled={pending} onClick={() => start(async () => {
          await saveWorkHistory(personId, form);
          onDone();
          router.refresh();
        })}>Add</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

function SchoolForm({ personId, onDone }: { personId: string; onDone: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState({
    school: "", degree: "", field_of_study: "", started_on: "", ended_on: "",
  });
  const [pending, start] = useTransition();

  return (
    <div className="grid grid-cols-2 gap-2 border-b bg-muted/30 px-4 py-3">
      <input className={input} placeholder="School" value={form.school}
        onChange={(e) => setForm({ ...form, school: e.target.value })} autoFocus />
      <input className={input} placeholder="Degree" value={form.degree}
        onChange={(e) => setForm({ ...form, degree: e.target.value })} />
      <input className={input} placeholder="Field" value={form.field_of_study}
        onChange={(e) => setForm({ ...form, field_of_study: e.target.value })} />
      <div className="grid grid-cols-2 gap-2">
        <input className={input} type="date" value={form.started_on}
          onChange={(e) => setForm({ ...form, started_on: e.target.value })} />
        <input className={input} type="date" value={form.ended_on}
          onChange={(e) => setForm({ ...form, ended_on: e.target.value })} />
      </div>
      <div className="col-span-2 flex gap-2">
        <Button size="sm" disabled={pending} onClick={() => start(async () => {
          await saveEducation(personId, form);
          onDone();
          router.refresh();
        })}>Add</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}
