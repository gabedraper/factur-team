"use client";

import { useState, useTransition } from "react";
import { createTeam, renameTeam, setTeamActive, setMemberTeam, setPodManager } from "@/actions/org";
import type { TeamRow, MemberRow } from "@/lib/org";

export function TeamsScreen({
  teams, members,
}: { teams: TeamRow[]; members: MemberRow[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [newPod, setNewPod] = useState("");

  const nameOf = (id: string) => {
    const m = members.find((x) => x.id === id);
    return m?.full_name ?? m?.email ?? "unknown";
  };

  function run(fn: () => Promise<{ success: boolean; error?: string }>) {
    setError("");
    startTransition(async () => {
      const res = await fn();
      if (!res.success) setError(res.error ?? "Something went wrong");
    });
  }

  const pods = teams.filter((t) => t.kind === "pod");
  // Leavers keep their history but stop being offered as a choice.
  const selectable = members
    .filter((m) => m.active)
    .sort((a, b) => (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email));

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      <section className="rounded-md border bg-card p-4">
        <h2 className="mb-2 text-sm font-medium">New pod</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="h-8 min-w-48 rounded-md border bg-background px-2 text-sm"
            placeholder="Pod name"
            value={newPod}
            onChange={(e) => setNewPod(e.target.value)}
          />
          <button
            className="h-8 rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50"
            disabled={!newPod.trim() || pending}
            onClick={() => { run(() => createTeam(newPod, "pod")); setNewPod(""); }}
          >
            Create pod
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">
          Pods {pending && <span className="text-xs text-muted-foreground">· saving…</span>}
        </h2>

        {pods.length === 0 && (
          <p className="rounded-md border bg-card p-4 text-sm text-muted-foreground">No pods yet.</p>
        )}

        {pods.map((pod) => (
          <div key={pod.id} className={`rounded-md border bg-card p-4 space-y-3 ${pod.active ? "" : "opacity-60"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="h-8 min-w-48 rounded-md border bg-background px-2 text-sm font-medium"
                defaultValue={pod.name}
                onBlur={(e) => {
                  if (e.target.value.trim() !== pod.name) run(() => renameTeam(pod.id, e.target.value));
                }}
              />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Manager
                <select
                  className="h-8 rounded-md border bg-background px-2 text-sm"
                  defaultValue={pod.manager_member_id ?? ""}
                  onChange={(e) => run(() => setPodManager(pod.id, e.target.value || null))}
                >
                  <option value="">— none —</option>
                  {selectable.map((m) => (
                    <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>
                  ))}
                </select>
              </label>
              <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={pod.active}
                       onChange={(e) => run(() => setTeamActive(pod.id, e.target.checked))} />
                Active
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Members ({pod.memberIds.length})
                </p>
                <div className="space-y-1">
                  {pod.memberIds.map((id) => (
                    <div key={id} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 truncate">{nameOf(id)}</span>
                      <button className="text-muted-foreground hover:text-foreground"
                              onClick={() => run(() => setMemberTeam(id, pod.id, false))}>×</button>
                    </div>
                  ))}
                  <select
                    className="h-7 rounded-md border bg-background px-1.5 text-xs text-muted-foreground"
                    value=""
                    onChange={(e) => { if (e.target.value) run(() => setMemberTeam(e.target.value, pod.id, true)); }}
                  >
                    <option value="">+ add member</option>
                    {selectable.filter((m) => !pod.memberIds.includes(m.id))
                      .map((m) => <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Clients ({pod.clients.length})
                </p>
                {pod.clients.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    None yet — assign this pod on the client record.
                  </p>
                ) : (
                  <ul className="space-y-0.5 text-sm">
                    {pod.clients.map((c) => <li key={c.id} className="truncate">{c.name}</li>)}
                  </ul>
                )}
              </div>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
