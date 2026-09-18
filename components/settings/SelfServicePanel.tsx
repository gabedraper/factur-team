"use client";

import { useState, useTransition } from "react";
import { setMyRole } from "@/actions/self-service";
import { FIELD } from "@/lib/field-class";
import { control } from "@/components/ui/control";

/**
 * Your own role, set without an administrator.
 *
 * The server works out who you are from your session, so nothing this
 * component sends can name somebody else. Roles carrying administrator or
 * manager access are shown but unavailable unless you already hold
 * org.manage; the server refuses them regardless of what this sends.
 *
 * Clients are not here. Who works a client is decided on the client's own
 * record (Settings > Clients), where every role on it is set together and
 * the history is written; a second door on this page let one person take a
 * client from another without either of them seeing it happen.
 */

type Role = { id: string; name: string; service_id: string | null; restricted: boolean };
type Service = { id: string; name: string };

export function SelfServicePanel({
  roles,
  services,
  currentRoleId,
  canAssignRestricted,
}: {
  roles: Role[];
  services: Service[];
  currentRoleId: string | null;
  /** Whether this person may take a role carrying administrator or manager access. */
  canAssignRestricted: boolean;
}) {
  const [roleId, setRoleId] = useState(currentRoleId ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const serviceName = new Map(services.map((s) => [s.id, s.name]));

  // Grouped by service, because eleven roles as one flat list is a wall.
  const grouped = new Map<string, Role[]>();
  for (const r of roles) {
    const key = r.service_id ? (serviceName.get(r.service_id) ?? "Other") : "Other";
    grouped.set(key, [...(grouped.get(key) ?? []), r]);
  }

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

  return (
    <div className="space-y-4">
      {problem && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-body text-destructive">
          {problem}
        </p>
      )}

      <div className="grid grid-cols-[8rem_1fr] items-center gap-y-2 text-body">
        <label htmlFor="own-role" className="text-muted-foreground">
          Role
        </label>
        <select
          id="own-role"
          value={roleId}
          disabled={pending}
          onChange={(e) => chooseRole(e.target.value)}
          className={control({ size: "sm", className: `w-full ${FIELD}` })}
        >
          <option value="">None</option>
          {[...grouped.entries()].map(([service, list]) => (
            <optgroup key={service} label={service}>
              {list.map((r) => {
                /*
                 * Shown but unavailable rather than hidden. Somebody looking
                 * for Team Lead should find it and see that it needs an
                 * administrator, not decide the list is broken. The server
                 * refuses it either way.
                 */
                const locked = r.restricted && !canAssignRestricted;
                return (
                  <option key={r.id} value={r.id} disabled={locked}>
                    {r.name}
                    {locked ? " — administrator only" : ""}
                  </option>
                );
              })}
            </optgroup>
          ))}
        </select>
      </div>
    </div>
  );
}
