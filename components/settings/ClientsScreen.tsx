"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { setClientOwner, setClientService } from "@/actions/org";
import type { ClientRow, TeamRow, MemberRow } from "@/lib/org";

type Service = { id: string; name: string };

export function ClientsScreen({
  clients, teams, members, services,
}: { clients: ClientRow[]; teams: TeamRow[]; members: MemberRow[]; services: Service[] }) {
  const [rows, setRows] = useState(clients);
  const [filter, setFilter] = useState("");
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  // 773 of the 985 clients are Inactive; showing them by default would bury
  // the ones anybody needs to assign.
  const [status, setStatus] = useState("current");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const pods = teams.filter((t) => t.kind === "pod" && t.active)
    .sort((a, b) => a.name.localeCompare(b.name));
  // Leavers keep their clients on record but stop being offered.
  const selectable = members
    .filter((m) => m.active)
    .sort((a, b) => (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email));

  const shown = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return rows.filter(
      (c) =>
        (status === "all" ||
          (status === "current" ? c.status !== "Inactive" : c.status === status)) &&
        (!onlyUnassigned || (!c.team_id && !c.member_id)) &&
        (!term || c.name.toLowerCase().includes(term))
    );
  }, [rows, filter, onlyUnassigned, status]);

  const statuses = useMemo(
    () => [...new Set(rows.map((c) => c.status).filter(Boolean))].sort() as string[],
    [rows]
  );

  const unassigned = rows.filter(
    (c) => c.status !== "Inactive" && !c.team_id && !c.member_id
  ).length;

  function run(fn: () => Promise<{ success: boolean; error?: string }>, optimistic: () => void) {
    setError("");
    optimistic();
    startTransition(async () => {
      const res = await fn();
      if (!res.success) setError(res.error ?? "Something went wrong");
    });
  }

  // One control for both kinds of owner: a client has exactly one, and offering
  // two pickers would invite setting both and having one silently win.
  const ownerValue = (c: ClientRow) =>
    c.team_id ? `pod:${c.team_id}` : c.member_id ? `person:${c.member_id}` : "";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="h-8 min-w-56 rounded-md border bg-field px-2 text-sm"
          placeholder="Search clients…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select className="h-8 rounded-md border bg-field px-2 text-sm"
                value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="current">Current clients</option>
          <option value="all">All statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={onlyUnassigned}
                 onChange={(e) => setOnlyUnassigned(e.target.checked)} />
          Unassigned ({unassigned})
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
              <th className="px-3 py-2 font-medium">Client</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Service</th>
              <th className="px-3 py-2 font-medium">Covered by</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.id} className={`border-b last:border-0 ${!c.team_id && !c.member_id ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}>
                <td className="px-3 py-2">
                  <Link href={`/settings/clients/${c.id}`}
                        className="font-medium hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{c.status ?? "—"}</td>
                <td className="px-3 py-2">
                  <select
                    className="h-8 rounded-md border bg-field px-2 text-sm"
                    value={c.service_id ?? ""}
                    onChange={(e) => {
                      const next = e.target.value || null;
                      run(
                        () => setClientService(c.id, next),
                        () => setRows((rs) => rs.map((r) => r.id === c.id ? { ...r, service_id: next } : r))
                      );
                    }}
                  >
                    <option value="">— none —</option>
                    {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <select
                    className="h-8 max-w-56 rounded-md border bg-field px-2 text-sm"
                    value={ownerValue(c)}
                    onChange={(e) => {
                      const v = e.target.value;
                      const owner: { teamId: string } | { memberId: string } | null =
                        v.startsWith("pod:") ? { teamId: v.slice(4) }
                        : v.startsWith("person:") ? { memberId: v.slice(7) }
                        : null;
                      const teamId = owner && "teamId" in owner ? owner.teamId : null;
                      const memberId = owner && "memberId" in owner ? owner.memberId : null;
                      run(
                        () => setClientOwner(c.id, owner),
                        () => setRows((rs) => rs.map((r) => r.id === c.id
                          ? { ...r, team_id: teamId, member_id: memberId }
                          : r))
                      );
                    }}
                  >
                    <option value="">— unassigned —</option>
                    {pods.length > 0 && (
                      <optgroup label="Pods">
                        {pods.map((t) => <option key={t.id} value={`pod:${t.id}`}>{t.name}</option>)}
                      </optgroup>
                    )}
                    <optgroup label="Individuals">
                      {selectable.map((m) => (
                        <option key={m.id} value={`person:${m.id}`}>{m.full_name ?? m.email}</option>
                      ))}
                    </optgroup>
                  </select>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No clients match.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Coverage is set here, not on the pod — a client has exactly one owner, and the pod screen
        shows what points at it. Amber rows have nobody. “Current clients” hides the {" "}
        {rows.filter((c) => c.status === "Inactive").length} inactive ones.
      </p>
    </div>
  );
}
