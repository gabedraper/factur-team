"use client";

import { useMemo, useState, useTransition } from "react";
import {
  createTeam, renameTeam, setTeamActive, setMemberTeam, addCoverage, removeCoverage,
} from "@/actions/org";
import type { TeamRow, MemberRow } from "@/lib/org";

type Service = { id: string; name: string; slug: string };
type Client = { id: string; name: string | null; status: string | null };
type Coverage = { id: string; client_id: string; client_name: string | null; member_id: string | null };

export function TeamsScreen({
  services, teams, members, clients, individualCoverage,
}: {
  services: Service[]; teams: TeamRow[]; members: MemberRow[];
  clients: Client[]; individualCoverage: Coverage[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [newPod, setNewPod] = useState({ serviceId: services[0]?.id ?? "", name: "" });

  const nameOf = (id: string) => {
    const m = members.find((x) => x.id === id);
    return m?.full_name ?? m?.email ?? "unknown";
  };
  const clientLabel = (c: Client) => c.name ?? c.id;

  function run(fn: () => Promise<{ success: boolean; error?: string }>) {
    setError("");
    startTransition(async () => {
      const res = await fn();
      if (!res.success) setError(res.error ?? "Something went wrong");
    });
  }

  // A client is covered once, by a pod or a person, so anything already spoken
  // for is dropped from the pickers rather than offered and then rejected.
  const takenClientIds = useMemo(() => new Set([
    ...teams.flatMap((t) => t.clients.map((c) => c.client_id)),
    ...individualCoverage.map((c) => c.client_id),
  ]), [teams, individualCoverage]);

  const pods = teams.filter((t) => t.kind === "pod");
  const activeMembers = members.filter((m) => m.active);

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      <section className="rounded-md border bg-card p-4">
        <h2 className="text-sm font-medium">New pod</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          A pod is several people working a group of clients together. People who cover clients on
          their own do not need one — give them coverage directly, below.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={newPod.serviceId}
            onChange={(e) => setNewPod((p) => ({ ...p, serviceId: e.target.value }))}
          >
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input
            className="h-8 min-w-48 rounded-md border bg-background px-2 text-sm"
            placeholder="Pod name"
            value={newPod.name}
            onChange={(e) => setNewPod((p) => ({ ...p, name: e.target.value }))}
          />
          <button
            className="h-8 rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50"
            disabled={!newPod.name.trim() || pending}
            onClick={() => {
              run(() => createTeam(newPod.serviceId, newPod.name, "pod"));
              setNewPod((p) => ({ ...p, name: "" }));
            }}
          >
            Create pod
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Pods {pending && <span className="text-xs text-muted-foreground">· saving…</span>}</h2>
        {pods.length === 0 && (
          <p className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
            No pods yet.
          </p>
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
              <span className="text-xs text-muted-foreground">
                {services.find((s) => s.id === pod.service_id)?.name}
              </span>
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
                    {activeMembers.filter((m) => !pod.memberIds.includes(m.id))
                      .map((m) => <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Clients ({pod.clients.length})
                </p>
                <div className="space-y-1">
                  {pod.clients.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 truncate">{c.client_name ?? c.client_id}</span>
                      <button className="text-muted-foreground hover:text-foreground"
                              onClick={() => run(() => removeCoverage(c.id))}>×</button>
                    </div>
                  ))}
                  <select
                    className="h-7 max-w-full rounded-md border bg-background px-1.5 text-xs text-muted-foreground"
                    value=""
                    onChange={(e) => {
                      const c = clients.find((x) => x.id === e.target.value);
                      if (c) run(() => addCoverage(c.id, c.name, { teamId: pod.id }));
                    }}
                  >
                    <option value="">+ add client</option>
                    {clients.filter((c) => !takenClientIds.has(c.id))
                      .map((c) => <option key={c.id} value={c.id}>{clientLabel(c)}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Individual coverage</h2>
        <p className="text-xs text-muted-foreground">
          Account managers who cover clients on their own rather than through a pod.
        </p>
        <div className="rounded-md border bg-card p-4 space-y-2">
          {individualCoverage.map((c) => (
            <div key={c.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-44 truncate">{c.member_id ? nameOf(c.member_id) : "—"}</span>
              <span className="flex-1 truncate text-muted-foreground">{c.client_name ?? c.client_id}</span>
              <button className="text-muted-foreground hover:text-foreground"
                      onClick={() => run(() => removeCoverage(c.id))}>×</button>
            </div>
          ))}
          {individualCoverage.length === 0 && (
            <p className="text-sm text-muted-foreground">Nobody covers a client directly yet.</p>
          )}
          <AddIndividual members={activeMembers} clients={clients} taken={takenClientIds} onAdd={run} />
        </div>
      </section>
    </div>
  );
}

function AddIndividual({
  members, clients, taken, onAdd,
}: {
  members: MemberRow[]; clients: Client[]; taken: Set<string>;
  onAdd: (fn: () => Promise<{ success: boolean; error?: string }>) => void;
}) {
  const [memberId, setMemberId] = useState("");
  const [clientId, setClientId] = useState("");

  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-2">
      <select className="h-7 rounded-md border bg-background px-1.5 text-xs"
              value={memberId} onChange={(e) => setMemberId(e.target.value)}>
        <option value="">Person…</option>
        {members.map((m) => <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>)}
      </select>
      <select className="h-7 rounded-md border bg-background px-1.5 text-xs"
              value={clientId} onChange={(e) => setClientId(e.target.value)}>
        <option value="">Client…</option>
        {clients.filter((c) => !taken.has(c.id))
          .map((c) => <option key={c.id} value={c.id}>{c.name ?? c.id}</option>)}
      </select>
      <button
        className="h-7 rounded-md border px-2 text-xs disabled:opacity-50"
        disabled={!memberId || !clientId}
        onClick={() => {
          const c = clients.find((x) => x.id === clientId);
          if (!c) return;
          onAdd(() => addCoverage(c.id, c.name, { memberId }));
          setClientId("");
        }}
      >
        Assign
      </button>
    </div>
  );
}
