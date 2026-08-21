"use client";

import { useState, useTransition } from "react";
import { createRole, updateRole, deleteRole, setRolePermission } from "@/actions/org";
import type { RoleDetail } from "@/lib/org";

type Service = { id: string; name: string };
type Perm = { key: string; name: string; description: string | null };

export function RolesScreen({
  roles, permissions, services,
}: { roles: RoleDetail[]; permissions: Perm[]; services: Service[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [draft, setDraft] = useState({ name: "", serviceId: "", description: "" });

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
          <input className="h-8 min-w-40 rounded-md border bg-background px-2 text-sm"
                 placeholder="Role name" value={draft.name}
                 onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          <select className="h-8 rounded-md border bg-background px-2 text-sm"
                  value={draft.serviceId}
                  onChange={(e) => setDraft((d) => ({ ...d, serviceId: e.target.value }))}>
            <option value="">No service (visibility only)</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input className="h-8 min-w-56 flex-1 rounded-md border bg-background px-2 text-sm"
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
              <input className="h-8 min-w-40 rounded-md border bg-background px-2 text-sm font-medium"
                     defaultValue={r.name}
                     onBlur={(e) => { if (e.target.value.trim() !== r.name) run(() => updateRole(r.id, { name: e.target.value })); }} />
              <select className="h-8 rounded-md border bg-background px-2 text-sm"
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

            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {permissions.map((p) => (
                <label key={p.key} className="flex items-center gap-1.5 text-sm" title={p.description ?? undefined}>
                  <input type="checkbox"
                         defaultChecked={r.permissionKeys.includes(p.key)}
                         onChange={(e) => run(() => setRolePermission(r.id, p.key, e.target.checked))} />
                  {p.name}
                </label>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
