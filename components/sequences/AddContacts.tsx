"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addToSequence } from "@/actions/sequence-audience";
import { parseCsv, type Candidate } from "@/lib/sequences/audience";

/**
 * Pick where the people come from, then look at them before anybody is added.
 *
 * The review step is the point of the screen. Everything arrives selected,
 * because the common case is "yes, all of these" -- and the uncommon case, the
 * one that matters, is spotting the three that should not be there before a
 * hundred emails go out rather than after.
 */
export function AddContacts({
  slug,
  contacts,
}: {
  slug: string;
  contacts: Candidate[];
}) {
  const router = useRouter();
  const [source, setSource] = useState<"contacts" | "csv" | null>(null);
  const [rows, setRows] = useState<Candidate[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  function load(next: Candidate[], from: "contacts" | "csv") {
    setSource(from);
    setRows(next);
    // Everything sendable starts ticked.
    setChosen(new Set(next.filter((r) => !r.problem).map((r) => r.email)));
    setError(next.length === 0 ? "No email addresses found in that file." : "");
  }

  function onFile(file: File) {
    setError(""); setNote("");
    const reader = new FileReader();
    reader.onload = () => load(parseCsv(String(reader.result ?? "")), "csv");
    reader.onerror = () => setError("That file could not be read.");
    reader.readAsText(file);
  }

  function toggle(email: string) {
    setChosen((c) => {
      const next = new Set(c);
      if (next.has(email)) next.delete(email); else next.add(email);
      return next;
    });
  }

  const shown = rows.filter((r) => {
    const term = filter.trim().toLowerCase();
    if (!term) return true;
    return [r.email, r.firstName, r.lastName, r.company]
      .some((v) => v?.toLowerCase().includes(term));
  });

  const selectable = shown.filter((r) => !r.problem);
  const allShownChosen = selectable.length > 0 && selectable.every((r) => chosen.has(r.email));

  function add() {
    setError(""); setNote("");
    startTransition(async () => {
      const picked = rows.filter((r) => chosen.has(r.email) && !r.problem);
      const res = await addToSequence(slug, picked);
      if (!res.success) { setError(res.error ?? "Couldn't add those."); return; }
      setNote(
        `${res.added} added` +
        (res.alreadyIn ? `, ${res.alreadyIn} already in this sequence` : "") +
        ". Nothing has been emailed."
      );
      router.push(`/sequences/${slug}`);
    });
  }

  if (!source) {
    return (
      <div className="space-y-3">
        <button
          onClick={() => load(contacts, "contacts")}
          className="block w-full rounded-md border bg-card px-4 py-3 text-left hover:bg-muted"
        >
          <span className="block font-medium">Contacts in the app</span>
          <span className="block text-sm text-muted-foreground">
            {contacts.length} contacts, opted-out and bounced addresses already excluded
          </span>
        </button>

        <label className="block cursor-pointer rounded-md border bg-card px-4 py-3 hover:bg-muted">
          <span className="block font-medium">CSV upload</span>
          <span className="block text-sm text-muted-foreground">
            Any file with a column of email addresses
          </span>
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="mt-2 block w-full text-sm"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
        </label>

        <div className="rounded-md border bg-card px-4 py-3 opacity-60">
          <span className="block font-medium">Salesforce list or report</span>
          <span className="block text-sm text-muted-foreground">
            Needs a Salesforce connection the app does not have yet
          </span>
        </div>

        {error && (
          <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}
      {note && <p className="text-sm text-muted-foreground">{note}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => { setSource(null); setRows([]); setChosen(new Set()); }}
          className="h-8 rounded-md border px-3 text-sm"
        >
          Back
        </button>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search"
          className="h-8 min-w-56 rounded-md border bg-field px-2 text-sm"
        />
        <button
          onClick={() =>
            setChosen((c) => {
              const next = new Set(c);
              for (const r of selectable) {
                if (allShownChosen) next.delete(r.email); else next.add(r.email);
              }
              return next;
            })
          }
          className="h-8 rounded-md border px-3 text-sm"
        >
          {allShownChosen ? "Deselect all" : "Select all"}
        </button>
        <span className="ml-auto text-xs text-muted-foreground">
          {chosen.size} of {rows.filter((r) => !r.problem).length} selected
        </span>
        <button
          onClick={add}
          disabled={pending || chosen.size === 0}
          className="h-8 rounded-md bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50"
        >
          Add {chosen.size} to sequence
        </button>
      </div>

      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 w-8" />
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Company</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.email} className="border-b last:border-0">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={chosen.has(r.email)}
                    disabled={!!r.problem}
                    onChange={() => toggle(r.email)}
                  />
                </td>
                <td className="px-3 py-2">
                  {[r.firstName, r.lastName].filter(Boolean).join(" ") || (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {r.email}
                  {r.problem && (
                    <span className="ml-2 text-red-600 dark:text-red-400">{r.problem}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{r.company ?? "—"}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  Nothing matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
