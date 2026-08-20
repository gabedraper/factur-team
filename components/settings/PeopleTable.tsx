"use client";

import { useMemo, useState, useTransition } from "react";
import { setMemberRole, setMemberManager, toggleStandaloneRole, setMemberActive } from "@/actions/org";
import type { MemberRow } from "@/lib/org";

type Role = { id: string; slug: string; name: string; service_id: string | null; active: boolean };

export function PeopleTable({ members, roles }: { members: MemberRow[]; roles: Role[] }) {
  const [rows, setRows] = useState(members);
  const [filter, setFilter] = useState("");
  const [onlyReview, setOnlyReview] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  // Service roles are the job. Manager and app-admin say what someone may see
  // rather than what they do, so they sit alongside as toggles.
  const serviceRoles = useMemo(() => roles.filter((r) => r.service_id), [roles]);
  const managerRole = roles.find((r) => r.slug === "manager");
  const adminRole = roles.find((r) => r.slug === "app-admin");

  const shown = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return rows.filter(
      (m) =>
        (!onlyReview || m.needs_review) &&
        (!term ||
          (m.full_name ?? "").toLowerCase().includes(term) ||
          m.email.toLowerCase().includes(term))
    );
  }, [rows, filter, onlyReview]);

  function run(fn: () => Promise<{ success: boolean; error?: string }>, optimistic: () => void) {
    setError("");
    optimistic();
    startTransition(async () => {
      const res = await fn();
      if (!res.success) setError(res.error ?? "Something went wrong");
    });
  }

  const reviewCount = rows.filter((r) => r.needs_review).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="h-8 min-w-56 rounded-md border bg-background px-2 text-sm"
          placeholder="Search name or email…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} />
          Needs review ({reviewCount})
        </label>
        <span className="ml-auto text-xs text-muted-foreground">
          {shown.length} of {rows.length}{pending && " · saving…"}
        </span>
      </div>

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Person</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Manager</th>
              <th className="px-3 py-2 font-medium text-center">Mgr</th>
              <th className="px-3 py-2 font-medium text-center">Admin</th>
              <th className="px-3 py-2 font-medium text-center">Active</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => {
              const roleId = m.roleIds.find((id) => serviceRoles.some((r) => r.id === id)) ?? "";
              return (
                <tr key={m.id} className={`border-b last:border-0 ${m.needs_review ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{m.full_name ?? m.email}</div>
                    <div className="text-xs text-muted-foreground">{m.email}</div>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className="h-8 rounded-md border bg-background px-2 text-sm"
                      value={roleId}
                      onChange={(e) => {
                        const next = e.target.value || null;
                        run(
                          () => setMemberRole(m.id, next),
                          () => setRows((rs) => rs.map((r) => r.id === m.id
                            ? { ...r, needs_review: false,
                                roleIds: [...r.roleIds.filter((id) => !serviceRoles.some((sr) => sr.id === id)),
                                          ...(next ? [next] : [])] }
                            : r))
                        );
                      }}
                    >
                      <option value="">— none —</option>
                      {serviceRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className="h-8 max-w-48 rounded-md border bg-background px-2 text-sm"
                      value={m.manager_member_id ?? ""}
                      onChange={(e) => {
                        const next = e.target.value || null;
                        run(
                          () => setMemberManager(m.id, next),
                          () => setRows((rs) => rs.map((r) => r.id === m.id ? { ...r, manager_member_id: next } : r))
                        );
                      }}
                    >
                      <option value="">— none —</option>
                      {rows.filter((r) => r.id !== m.id && r.active)
                           .map((r) => <option key={r.id} value={r.id}>{r.full_name ?? r.email}</option>)}
                    </select>
                  </td>
                  {([["manager", managerRole], ["app-admin", adminRole]] as const).map(([slug, role]) => {
                    const on = role ? m.roleIds.includes(role.id) : false;
                    return (
                      <td key={slug} className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={!role}
                          onChange={(e) => {
                            const next = e.target.checked;
                            if (!role) return;
                            run(
                              () => toggleStandaloneRole(m.id, slug, next),
                              () => setRows((rs) => rs.map((row) => row.id === m.id
                                ? { ...row, roleIds: next ? [...row.roleIds, role.id] : row.roleIds.filter((id) => id !== role.id) }
                                : row))
                            );
                          }}
                        />
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={m.active}
                      onChange={(e) => {
                        const next = e.target.checked;
                        run(
                          () => setMemberActive(m.id, next),
                          () => setRows((rs) => rs.map((r) => r.id === m.id ? { ...r, active: next } : r))
                        );
                      }}
                    />
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Nobody matches.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Amber rows came from Salesforce without a role that could be resolved — picking one clears
        the flag. <b>Mgr</b> lets someone see their team unmasked on the scoreboards;
        <b> Admin</b> grants full control including this screen.
      </p>
    </div>
  );
}
