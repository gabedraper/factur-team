"use client";

import { useState, useTransition } from "react";
import { setMyRole, claimClient } from "@/actions/self-service";
import { FIELD } from "@/lib/field-class";

/**
 * Your own role and your own client list, set without an administrator.
 *
 * The server works out who you are from your session, so nothing this
 * component sends can name somebody else. What it can do is give you any role
 * that exists, including one that carries org.manage.
 */

type Role = { id: string; name: string; service_id: string | null };
type Service = { id: string; name: string };
type Client = { id: string; name: string; heldBy: string | null; mine: boolean };

export function SelfServicePanel({
  roles,
  services,
  currentRoleId,
  clients,
}: {
  roles: Role[];
  services: Service[];
  currentRoleId: string | null;
  clients: Client[];
}) {
  const [roleId, setRoleId] = useState(currentRoleId ?? "");
  const [rows, setRows] = useState(clients);
  const [filter, setFilter] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const serviceName = new Map(services.map((s) => [s.id, s.name]));

  // Grouped by service, because eleven roles as one flat list is a wall.
  const grouped = new Map<string, Role[]>();
  for (const r of roles) {
    const key = r.service_id ? (serviceName.get(r.service_id) ?? "Other") : "Other";
    grouped.set(key, [...(grouped.get(key) ?? []), r]);
  }

  const shown = filter.trim()
    ? rows.filter((c) => c.name.toLowerCase().includes(filter.trim().toLowerCase()))
    : rows;

  function chooseRole(next: string) {
    const previous = roleId;
    setRoleId(next);
    setProblem(null);
    start(async () => {
      const res = await setMyRole(next || null);
      if (!res.success) {
        setRoleId(previous);
        setProblem(res.error ?? "Could not change your role.");
      }
    });
  }

  function toggleClient(client: Client) {
    const next = !client.mine;
    // Moved straight away and put back if the server refuses, so the list does
    // not sit still while a click is in flight.
    setRows((r) =>
      r.map((c) =>
        c.id === client.id ? { ...c, mine: next, heldBy: next ? "You" : null } : c
      )
    );
    setProblem(null);
    start(async () => {
      const res = await claimClient(client.id, next);
      if (!res.success) {
        setRows((r) => r.map((c) => (c.id === client.id ? client : c)));
        setProblem(res.error ?? "Could not change that client.");
      }
    });
  }

  return (
    <div className="space-y-4">
      {problem && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {problem}
        </p>
      )}

      <div className="grid grid-cols-[8rem_1fr] items-center gap-y-2 text-sm">
        <label htmlFor="own-role" className="text-muted-foreground">
          Role
        </label>
        <select
          id="own-role"
          value={roleId}
          disabled={pending}
          onChange={(e) => chooseRole(e.target.value)}
          className={`h-8 w-full rounded-md border px-2 text-sm disabled:opacity-50 ${FIELD}`}
        >
          <option value="">None</option>
          {[...grouped.entries()].map(([service, list]) => (
            <optgroup key={service} label={service}>
              {list.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-32 shrink-0 text-sm text-muted-foreground">Clients</span>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search clients…"
            className={`h-8 w-full rounded-md border px-2 text-sm ${FIELD}`}
          />
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
            {rows.filter((c) => c.mine).length}
          </span>
        </div>

        <div className="max-h-72 overflow-y-auto rounded-md border">
          <table className="w-full text-sm">
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} className="border-b last:border-b-0">
                  <td className="w-8 px-3 py-1.5">
                    <input
                      type="checkbox"
                      checked={c.mine}
                      disabled={pending}
                      onChange={() => toggleClient(c)}
                      aria-label={c.name}
                    />
                  </td>
                  <td className="px-1 py-1.5">{c.name}</td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground">
                    {c.mine ? "You" : c.heldBy}
                  </td>
                </tr>
              ))}
              {!shown.length && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                    No clients match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
