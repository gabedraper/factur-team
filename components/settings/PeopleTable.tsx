"use client";

import { useMemo, useState, useTransition } from "react";
import { setMemberRole, setMemberManager, toggleStandaloneRole, setMemberActive } from "@/actions/org";
import type { MemberRow } from "@/lib/org";
import { isJobRole } from "@/lib/org-roles";
import { useSort, SortHeader } from "@/components/ui/sortable";

type Role = { id: string; slug: string; name: string; service_id: string | null; active: boolean };
type Service = { id: string; name: string };

export function PeopleTable(
  { members, roles, services }: { members: MemberRow[]; roles: Role[]; services: Service[] }
) {
  const [rows, setRows] = useState(members);
  const [filter, setFilter] = useState("");
  const [onlyReview, setOnlyReview] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  // Every role defined in Settings is offered here, except the two that are
  // already their own checkboxes. A role with no service is still a job someone
  // can hold -- it just has no service to file it under.
  const jobRoles = useMemo(() => roles.filter(isJobRole), [roles]);

  // Grouped by service so a long list reads as the org chart it describes.
  // Retired roles stay out of the list, but a person still holding one keeps
  // seeing it (below) rather than having their role silently read as none.
  const roleGroups = useMemo(() => {
    const live = jobRoles.filter((r) => r.active);
    const groups = services
      .map((s) => ({ label: s.name, roles: live.filter((r) => r.service_id === s.id) }))
      .filter((g) => g.roles.length);
    const unfiled = live.filter((r) => !r.service_id);
    if (unfiled.length) groups.push({ label: "No service", roles: unfiled });
    return groups;
  }, [jobRoles, services]);

  const managerRole = roles.find((r) => r.slug === "manager");
  const adminRole = roles.find((r) => r.slug === "app-admin");

  // People who have left are kept, not deleted, so their history still reads
  // correctly -- but they are not who this screen is usually about, so they sit
  // behind a checkbox. Everything below counts within whatever is in scope, so
  // the numbers match what is on screen.
  const inScope = useMemo(
    () => (showInactive ? rows : rows.filter((m) => m.active)),
    [rows, showInactive]
  );

  const shown = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return inScope.filter(
      (m) =>
        (!onlyReview || m.needs_review) &&
        (!term ||
          (m.full_name ?? "").toLowerCase().includes(term) ||
          m.email.toLowerCase().includes(term))
    );
  }, [inScope, filter, onlyReview]);

  // Unsorted, the list arrives with anyone needing review at the top -- worth
  // being able to click back to, which is why the third click clears the sort.
  const { sorted, sortProps } = useSort(shown, {
    person: (m) => m.full_name ?? m.email,
    role: (m) => roles.find((r) => r.id === m.roleIds.find((id) => jobRoles.some((jr) => jr.id === id)))?.name,
    manager: (m) => rows.find((r) => r.id === m.manager_member_id)?.full_name,
    mgr: (m) => (managerRole ? m.roleIds.includes(managerRole.id) : false),
    admin: (m) => (adminRole ? m.roleIds.includes(adminRole.id) : false),
    active: (m) => m.active,
  });

  function run(fn: () => Promise<{ success: boolean; error?: string }>, optimistic: () => void) {
    setError("");
    optimistic();
    startTransition(async () => {
      const res = await fn();
      if (!res.success) setError(res.error ?? "Something went wrong");
    });
  }

  const reviewCount = inScope.filter((r) => r.needs_review).length;
  const inactiveCount = rows.filter((r) => !r.active).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="h-8 min-w-56 rounded-md border bg-field px-2 text-sm"
          placeholder="Search name or email…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} />
          Needs review ({reviewCount})
        </label>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive ({inactiveCount})
        </label>
        <span className="ml-auto text-xs text-muted-foreground">
          {shown.length} of {inScope.length}{pending && " · saving…"}
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
              <SortHeader className="px-3 py-2" {...sortProps("person")}>Person</SortHeader>
              <SortHeader className="px-3 py-2" {...sortProps("role")}>Role</SortHeader>
              <SortHeader className="px-3 py-2" {...sortProps("manager")}>Manager</SortHeader>
              <SortHeader className="px-3 py-2" align="center" {...sortProps("mgr")}>Mgr</SortHeader>
              <SortHeader className="px-3 py-2" align="center" {...sortProps("admin")}>Admin</SortHeader>
              <SortHeader className="px-3 py-2" align="center" {...sortProps("active")}>Active</SortHeader>
            </tr>
          </thead>
          <tbody>
            {sorted.map((m) => {
              const roleId = m.roleIds.find((id) => jobRoles.some((r) => r.id === id)) ?? "";
              // A role they hold that the list above leaves out, because it was
              // retired. Shown so the picker reflects reality.
              const retired = jobRoles.find((r) => r.id === roleId && !r.active);
              return (
                <tr key={m.id} className={`border-b last:border-0 ${m.needs_review ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{m.full_name ?? m.email}</div>
                    <div className="text-xs text-muted-foreground">{m.email}</div>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className="h-8 rounded-md border bg-field px-2 text-sm"
                      value={roleId}
                      onChange={(e) => {
                        const next = e.target.value || null;
                        run(
                          () => setMemberRole(m.id, next),
                          () => setRows((rs) => rs.map((r) => r.id === m.id
                            ? { ...r, needs_review: false,
                                roleIds: [...r.roleIds.filter((id) => !jobRoles.some((jr) => jr.id === id)),
                                          ...(next ? [next] : [])] }
                            : r))
                        );
                      }}
                    >
                      <option value="">— none —</option>
                      {retired && <option value={retired.id}>{retired.name} (retired)</option>}
                      {roleGroups.map((g) => (
                        <optgroup key={g.label} label={g.label}>
                          {g.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className="h-8 max-w-48 rounded-md border bg-field px-2 text-sm"
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
                           .sort((a, b) => (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email))
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
