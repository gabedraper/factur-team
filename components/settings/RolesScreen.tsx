"use client";

import { useMemo, useState, useTransition } from "react";
import { createRole, updateRole, deleteRole, setRolePermission } from "@/actions/org";
import type { RoleDetail } from "@/lib/org";

type Service = { id: string; name: string };
type Perm = {
  key: string; name: string; description: string | null;
  category: string; position: number;
};

// Mirrors the order of the sidebar, so the roles screen reads like the app
// rather than like the database.
const CATEGORY_ORDER = ["Learn", "Scoreboard", "Timelines", "Administration"];

export function RolesScreen({
  roles, permissions, services,
}: { roles: RoleDetail[]; permissions: Perm[]; services: Service[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [draft, setDraft] = useState({ name: "", serviceId: "", description: "" });

  const grouped = useMemo(() => {
    const byCategory = new Map<string, Perm[]>();
    for (const p of permissions) {
      byCategory.set(p.category, [...(byCategory.get(p.category) ?? []), p]);
    }
    // Anything with an unrecognised category still shows, after the known ones,
    // rather than silently disappearing from the screen.
    const known = CATEGORY_ORDER.filter((c) => byCategory.has(c));
    const rest = [...byCategory.keys()].filter((c) => !CATEGORY_ORDER.includes(c)).sort();
    return [...known, ...rest].map((c) => ({
      category: c,
      perms: (byCategory.get(c) ?? []).sort((a, b) => a.position - b.position),
    }));
  }, [permissions]);

  function run(fn: () => Promise<{ success: boolean; error?: string }>) {
    setError("");
    startTransition(async () => {
      const res = await fn();
      if (!res.success) setError(res.error ?? "Something went wrong");
    });
  }

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      <section className="rounded-md border bg-card p-4 space-y-2">
        <h2 className="text-sm font-medium">New role</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input className="h-8 min-w-40 rounded-md border bg-field px-2 text-sm"
                 placeholder="Role name" value={draft.name}
                 onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          <select className="h-8 rounded-md border bg-field px-2 text-sm"
                  value={draft.serviceId}
                  onChange={(e) => setDraft((d) => ({ ...d, serviceId: e.target.value }))}>
            <option value="">No service (visibility only)</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input className="h-8 min-w-56 flex-1 rounded-md border bg-field px-2 text-sm"
                 placeholder="What is this role? (optional)" value={draft.description}
                 onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
          <button className="h-8 rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50"
                  disabled={!draft.name.trim() || pending}
                  onClick={() => {
                    run(() => createRole(draft.name, draft.serviceId || null, draft.description || null));
                    setDraft({ name: "", serviceId: "", description: "" });
                  }}>
            Create
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          A role tied to a service is a job someone does and counts towards their allocation. A role
          with no service — like Manager — only says what they may see.
        </p>
      </section>

      {roles.map((r) => {
        const builtIn = r.slug === "app-admin" || r.slug === "manager";
        return (
          <section key={r.id} className={`rounded-md border bg-card p-4 space-y-3 ${r.active ? "" : "opacity-60"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <input className="h-8 min-w-40 rounded-md border bg-field px-2 text-sm font-medium"
                     defaultValue={r.name}
                     onBlur={(e) => { if (e.target.value.trim() !== r.name) run(() => updateRole(r.id, { name: e.target.value })); }} />
              <select className="h-8 rounded-md border bg-field px-2 text-sm"
                      defaultValue={r.service_id ?? ""}
                      onChange={(e) => run(() => updateRole(r.id, { service_id: e.target.value || null }))}>
                <option value="">No service</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <span className="text-xs text-muted-foreground">
                {r.holders} {r.holders === 1 ? "person" : "people"}
              </span>
              <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" defaultChecked={r.active}
                       onChange={(e) => run(() => updateRole(r.id, { active: e.target.checked }))} />
                Active
              </label>
              <button
                className="h-8 rounded-md border px-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
                disabled={builtIn || r.holders > 0 || pending}
                title={builtIn ? "Built in" : r.holders ? "Someone holds it" : "Delete"}
                onClick={() => run(() => deleteRole(r.id))}
              >
                Delete
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {grouped.map(({ category, perms }) => (
                <div key={category}>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {category}
                  </p>
                  <div className="space-y-1">
                    {perms.map((p) => (
                      <label key={p.key} className="flex items-start gap-1.5 text-sm"
                             title={p.description ?? undefined}>
                        <input type="checkbox" className="mt-0.5"
                               defaultChecked={r.permissionKeys.includes(p.key)}
                               onChange={(e) => run(() => setRolePermission(r.id, p.key, e.target.checked))} />
                        <span>{p.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
