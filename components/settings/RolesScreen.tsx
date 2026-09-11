"use client";

import { useMemo, useState, useTransition } from "react";
import {
  createRole, updateRole, deleteRoles, setRolePermission, setRolePermissions, setRoleClientAssignable,
} from "@/actions/org";
import { isStandaloneRole } from "@/lib/org-roles";
import type { RoleDetail } from "@/lib/org";
import { Surface } from "@/components/ui/surface";
import { BulkBar, BulkAction, SelectAllBox } from "@/components/list/BulkBar";

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
  // Built-in roles cannot be deleted, so they cannot be selected either --
  // otherwise "select all" would tick boxes the delete then has to skip.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const deletable = useMemo(() => roles.filter((r) => !isStandaloneRole(r.slug)), [roles]);
  const allSelected = deletable.length > 0 && deletable.every((r) => selected.has(r.id));
  const someSelected = deletable.some((r) => selected.has(r.id));

  function toggleAll(on: boolean) {
    setSelected(on ? new Set(deletable.map((r) => r.id)) : new Set());
  }
  function toggleOne(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }

  function deleteSelected() {
    const picked = roles.filter((r) => selected.has(r.id));
    if (!picked.length) return;
    const holders = picked.reduce((n, r) => n + r.holders, 0);
    const names = picked.map((r) => `"${r.name}"`).join(", ");
    const what = picked.length === 1 ? `Delete ${names}?` : `Delete ${picked.length} roles (${names})?`;
    const who = holders === 0 ? "" :
      ` ${holders === 1 ? "1 person holds" : `${holders} people hold`} ${picked.length === 1 ? "this role" : "these roles"} and will lose ${picked.length === 1 ? "it" : "them"}. Anyone whose job it was is flagged for review.`;
    if (!window.confirm(what + who)) return;
    run(async () => {
      const res = await deleteRoles(picked.map((r) => r.id));
      if (res.success) setSelected(new Set());
      return res;
    });
  }

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
      else if (res.error) setError(res.error);
    });
  }

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      <Surface as="section" className="space-y-2">
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
          with no service — like Manager or Beta Tester — only says what they may see.
        </p>
      </Surface>

      {someSelected ? (
        <BulkBar count={selected.size} noun="role" onClear={() => toggleAll(false)}>
          <BulkAction danger onClick={deleteSelected}>Delete roles</BulkAction>
        </BulkBar>
      ) : (
        <label className="flex items-center gap-2 px-1 text-meta text-muted-foreground">
          <SelectAllBox checked={allSelected} indeterminate={someSelected}
                        onChange={toggleAll} label="Select all roles" />
          Select all roles
        </label>
      )}

      {roles.map((r) => {
        const builtIn = isStandaloneRole(r.slug);
        const allKeys = permissions.map((p) => p.key);
        return (
          <Surface as="section" key={r.id} className={`space-y-3 ${r.active ? "" : "opacity-60"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <input type="checkbox" aria-label={`Select ${r.name}`}
                     className="h-3.5 w-3.5 cursor-pointer accent-[hsl(var(--primary))] disabled:cursor-default disabled:opacity-40"
                     checked={selected.has(r.id)} disabled={builtIn}
                     title={builtIn ? "Built in" : undefined}
                     onChange={(e) => toggleOne(r.id, e.target.checked)} />
              <input className="h-8 min-w-40 rounded-md border bg-field px-2 text-sm font-medium"
                     defaultValue={r.name}
                     onBlur={(e) => { if (e.target.value.trim() !== r.name) run(() => updateRole(r.id, { name: e.target.value })); }} />
              <select className="h-8 rounded-md border bg-field px-2 text-sm"
                      defaultValue={r.service_id ?? ""}
                      onChange={(e) => run(() => updateRole(r.id, { service_id: e.target.value || null }))}>
                <option value="">No service</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select className="h-8 rounded-md border bg-field px-2 text-sm"
                      defaultValue={r.stage_field}
                      title="Which progress field this role sees on a pursuit"
                      onChange={(e) => run(() => updateRole(r.id, {
                        stage_field: e.target.value as "stage" | "lead_status" | "both",
                      }))}>
                <option value="both">Stage &amp; lead status</option>
                <option value="stage">Stage</option>
                <option value="lead_status">Lead status</option>
              </select>
              <span className="text-xs text-muted-foreground">
                {r.holders} {r.holders === 1 ? "person" : "people"}
              </span>
              <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground"
                     title="Shows this role as an assignment on every client">
                <input type="checkbox" defaultChecked={r.client_assignable}
                       onChange={(e) => run(() => setRoleClientAssignable(r.id, e.target.checked))} />
                On clients
              </label>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" defaultChecked={r.active}
                       onChange={(e) => run(() => updateRole(r.id, { active: e.target.checked }))} />
                Active
              </label>
              <button
                className="h-8 rounded-md border px-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
                disabled={builtIn || pending}
                title={builtIn ? "Built in" : "Delete role"}
                onClick={() => {
                  const who = r.holders === 1 ? "1 person holds" : `${r.holders} people hold`;
                  const msg = r.holders
                    ? `Delete "${r.name}"? ${who} this role and will lose it. Anyone whose job it was is flagged for review.`
                    : `Delete "${r.name}"?`;
                  if (!window.confirm(msg)) return;
                  run(() => deleteRoles([r.id]));
                }}
              >
                Delete role
              </button>
            </div>

            <div className="flex items-center gap-3 text-meta text-muted-foreground">
              <span>{r.permissionKeys.length} of {allKeys.length} permissions</span>
              <button type="button" className="underline-offset-2 hover:underline disabled:opacity-40"
                      disabled={pending || r.permissionKeys.length === allKeys.length}
                      onClick={() => run(() => setRolePermissions(r.id, allKeys, true))}>
                Select all
              </button>
              <button type="button" className="underline-offset-2 hover:underline disabled:opacity-40"
                      disabled={pending || r.permissionKeys.length === 0}
                      onClick={() => run(() => setRolePermissions(r.id, allKeys, false))}>
                Clear all
              </button>
            </div>

            <div key={r.permissionKeys.slice().sort().join(",")}
                 className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          </Surface>
        );
      })}
    </div>
  );
}
