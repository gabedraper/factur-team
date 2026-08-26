"use client";

import { useState, useTransition } from "react";
import {
  addClientContact, removeClientContact, setContactOptOut,
} from "@/actions/client-contacts";
import { ROLES, ROLE_LABEL, SOURCE_LABEL, type Contact, type Role } from "@/lib/client-contacts";

/**
 * Who we email at this client, and who has asked us not to.
 *
 * Synced rows are shown but not edited: Salesforce and QuickBooks own those,
 * and changing one here would be undone by the next sync. Correcting one means
 * adding a row alongside it, which outranks it from then on.
 */
export function ContactsPanel({
  clientId,
  contacts,
  canEdit,
}: {
  clientId: string;
  contacts: Contact[];
  canEdit: boolean;
}) {
  const [rows, setRows] = useState(contacts);
  const [email, setEmail] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [role, setRole] = useState<Role>("primary");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function add() {
    setError("");
    startTransition(async () => {
      const res = await addClientContact(clientId, email, first, last, role);
      if (!res.success) { setError(res.error ?? "Couldn't add that."); return; }
      setEmail(""); setFirst(""); setLast("");
      location.reload();
    });
  }

  function toggleOptOut(c: Contact) {
    setError("");
    const next = !c.opted_out_at;
    setRows((rs) =>
      rs.map((r) => (r.id === c.id ? { ...r, opted_out_at: next ? new Date().toISOString() : null } : r))
    );
    startTransition(async () => {
      const res = await setContactOptOut(c.id, clientId, next, "");
      if (!res.success) {
        setRows((rs) => rs.map((r) => (r.id === c.id ? c : r)));
        setError(res.error ?? "Couldn't save that.");
      }
    });
  }

  function remove(c: Contact) {
    setError("");
    setRows((rs) => rs.filter((r) => r.id !== c.id));
    startTransition(async () => {
      const res = await removeClientContact(c.id, clientId);
      if (!res.success) { setError(res.error ?? "Couldn't remove that."); location.reload(); }
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No contacts.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">From</th>
              <th className="px-3 py-2 font-medium">Emailing</th>
              {canEdit && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const stopped = c.opted_out_at || c.bounced_at || !c.active;
              return (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="px-3 py-2">{ROLE_LABEL[c.role]}</td>
                  <td className="px-3 py-2">
                    {[c.first_name, c.last_name].filter(Boolean).join(" ") || (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{c.email}</td>
                  <td className="px-3 py-2 text-muted-foreground">{SOURCE_LABEL[c.source]}</td>
                  <td className="px-3 py-2">
                    {c.bounced_at ? (
                      <span className="text-red-600 dark:text-red-400">Bounced</span>
                    ) : c.opted_out_at ? (
                      <span className="text-amber-600 dark:text-amber-400">Opted out</span>
                    ) : (
                      <span className="text-emerald-600 dark:text-emerald-400">Yes</span>
                    )}
                  </td>
                  {canEdit && (
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => toggleOptOut(c)}
                        disabled={pending || !!c.bounced_at}
                        className="text-xs text-muted-foreground underline hover:text-foreground disabled:opacity-50"
                      >
                        {stopped ? "resume" : "opt out"}
                      </button>
                      {c.source === "manual" && (
                        <button
                          onClick={() => remove(c)}
                          disabled={pending}
                          className="ml-3 text-xs text-muted-foreground underline hover:text-destructive"
                        >
                          remove
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted-foreground">
            Role
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="mt-1 block h-8 rounded-md border bg-field px-2 text-sm"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            First name
            <input
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              className="mt-1 block h-8 w-32 rounded-md border bg-field px-2 text-sm"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Last name
            <input
              value={last}
              onChange={(e) => setLast(e.target.value)}
              className="mt-1 block h-8 w-32 rounded-md border bg-field px-2 text-sm"
            />
          </label>
          <label className="flex-1 text-xs text-muted-foreground">
            Email
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block h-8 w-full rounded-md border bg-field px-2 text-sm"
            />
          </label>
          <button
            onClick={add}
            disabled={pending || !email.trim()}
            className="h-8 rounded-md border px-3 text-sm disabled:opacity-50"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
