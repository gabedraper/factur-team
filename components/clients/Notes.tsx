"use client";

import { useState, useTransition } from "react";
import {
  addClientNote, setNotePinned, deleteClientNote, editClientNote, type ClientNote,
} from "@/actions/client-notes";
import { FIELD } from "@/lib/field-class";
import { Pin, PinOff, Trash2, Plus } from "lucide-react";

function when(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

/**
 * What somebody needs to know before they act on this client's money.
 *
 * Pinned notes sit here, above the trail. An unpinned note is an event and
 * takes its place in the trail by date; a pinned one is standing context --
 * "they pay on the 5th, do not chase before then" -- and belongs where somebody
 * about to send a chase will actually read it.
 *
 * The QuickBooks note is always here and never editable. It lives on their
 * customer record over there, and pretending otherwise would let somebody edit
 * a copy that nothing reads.
 */
export function Notes({ clientId, notes }: { clientId: string; notes: ClientNote[] }) {
  const [all, setAll] = useState(notes);
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [pinNew, setPinNew] = useState(false);
  const [problem, setProblem] = useState("");
  const [pending, startTransition] = useTransition();

  const pinned = all.filter((n) => n.pinned);

  function add() {
    const body = draft.trim();
    if (!body) return;
    setProblem("");
    startTransition(async () => {
      const res = await addClientNote(clientId, body, pinNew);
      if (!res.success) {
        setProblem(res.error ?? "Couldn't save that.");
        return;
      }
      setAll((n) => [
        {
          id: crypto.randomUUID(),
          source: "app" as const,
          body,
          pinned: pinNew,
          author_email: null,
          created_at: new Date().toISOString(),
        },
        ...n,
      ]);
      setDraft("");
      setPinNew(false);
      setWriting(false);
    });
  }

  function pin(note: ClientNote, next: boolean) {
    if (!note.id) return;
    const id = note.id;
    setProblem("");
    setAll((n) => n.map((x) => (x.id === id ? { ...x, pinned: next } : x)));
    startTransition(async () => {
      const res = await setNotePinned(clientId, id, next);
      if (!res.success) {
        setProblem(res.error ?? "Couldn't change that.");
        setAll((n) => n.map((x) => (x.id === id ? { ...x, pinned: !next } : x)));
      }
    });
  }

  function save(note: ClientNote) {
    if (!note.id || !editDraft.trim()) return;
    const id = note.id;
    const body = editDraft.trim();
    setProblem("");
    startTransition(async () => {
      const res = await editClientNote(clientId, id, body);
      if (!res.success) {
        setProblem(res.error ?? "Couldn't save that.");
        return;
      }
      setAll((n) => n.map((x) => (x.id === id ? { ...x, body } : x)));
      setEditing(null);
    });
  }

  function remove(note: ClientNote) {
    if (!note.id) return;
    const id = note.id;
    setProblem("");
    setAll((n) => n.filter((x) => x.id !== id));
    startTransition(async () => {
      const res = await deleteClientNote(clientId, id);
      if (!res.success) {
        setProblem(res.error ?? "Couldn't delete that.");
        setAll(notes);
      }
    });
  }

  return (
    <div className="space-y-2">
      {problem && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {problem}
        </p>
      )}

      {pinned.map((n) => (
        <div
          key={n.id ?? "quickbooks"}
          className="rounded-lg border border-amber-300/60 bg-amber-50/60 px-3 py-2 dark:border-amber-900/60 dark:bg-amber-950/20"
        >
          <div className="flex items-start gap-2">
            <Pin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 flex-1">
              {editing === n.id ? (
                <div className="space-y-2">
                  <textarea
                    autoFocus
                    rows={3}
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    className={`${FIELD} w-full px-2 py-1 text-sm`}
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setEditing(null)}
                      className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => save(n)}
                      disabled={pending || !editDraft.trim()}
                      className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div className="whitespace-pre-wrap text-sm">{n.body}</div>
              )}
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>
                  {n.source === "quickbooks"
                    ? "QuickBooks customer record"
                    : [n.author_email, when(n.created_at)].filter(Boolean).join(" · ")}
                </span>
                {n.id && editing !== n.id && (
                  <>
                    <button
                      onClick={() => { setEditing(n.id); setEditDraft(n.body); }}
                      className="hover:text-foreground"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => pin(n, false)}
                      disabled={pending}
                      className="inline-flex items-center gap-1 hover:text-foreground disabled:opacity-50"
                    >
                      <PinOff className="h-3 w-3" /> Unpin
                    </button>
                    <button
                      onClick={() => remove(n)}
                      disabled={pending}
                      className="inline-flex items-center gap-1 hover:text-foreground disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}

      {writing ? (
        <div className="space-y-2 rounded-lg border bg-card px-3 py-2">
          <textarea
            autoFocus
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className={`${FIELD} w-full px-2 py-1 text-sm`}
          />
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={pinNew}
                onChange={(e) => setPinNew(e.target.checked)}
              />
              Pin to top
            </label>
            <span className="ml-auto flex gap-2">
              <button
                onClick={() => { setWriting(false); setDraft(""); }}
                className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={add}
                disabled={pending || !draft.trim()}
                className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Save note
              </button>
            </span>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setWriting(true)}
          className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          <Plus className="h-4 w-4" /> Add note
        </button>
      )}
    </div>
  );
}
