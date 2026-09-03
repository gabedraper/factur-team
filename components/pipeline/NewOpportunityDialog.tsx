"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { createOpportunity, searchCrmContacts, type ContactMatch } from "@/actions/pipeline";

type ClientOption = { id: string; name: string; heldBy: string | null; mine: boolean };

/**
 * Starting a pursuit: pick the client doing the pursuing, then who they're
 * pursuing. Contact search is typed rather than browsed -- crm_contacts is
 * large enough that an unfiltered list isn't a starting point anyone wants.
 *
 * A rep collision (another Client's rep already pursuing this same Contact)
 * doesn't block the create -- createOpportunity() already decided that's a
 * human call, not a validation failure, so it's surfaced as a note on the
 * new pursuit rather than something to dismiss here.
 */
export function NewOpportunityDialog({
  clients, initialContact, trigger,
}: {
  clients: ClientOption[];
  /** Pre-fills the contact step, e.g. from a "Create opportunity" row on /data/people. */
  initialContact?: ContactMatch;
  /** Replaces the default "New pursuit" button as the open trigger. */
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContactMatch[]>([]);
  const [contact, setContact] = useState<ContactMatch | null>(initialContact ?? null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [collisionNote, setCollisionNote] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [saving, startSave] = useTransition();

  function search(value: string) {
    setQuery(value);
    setContact(null);
    if (value.trim().length < 2) { setResults([]); return; }
    startSearch(async () => {
      try {
        setResults((await searchCrmContacts(value)).results);
      } catch {
        setResults([]);
      }
    });
  }

  function reset() {
    setClientId(""); setQuery(""); setResults([]); setContact(initialContact ?? null);
    setNotes(""); setError(null); setCollisionNote(null);
  }

  function submit() {
    if (!clientId || !contact) {
      setError("Pick both a client and a contact.");
      return;
    }
    setError(null);
    startSave(async () => {
      const result = await createOpportunity({
        client_id: clientId,
        contact_id: contact.id,
        account_id: contact.account_id,
        notes: notes || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.collision) {
        setCollisionNote(
          `Heads up: the same account manager already has ${contact.first_name ?? "this contact"} open under another client.`
        );
      }
      setOpen(false);
      reset();
      router.push(`/opportunities/${result.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        {trigger ?? <Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> New Opportunity</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New Opportunity</DialogTitle></DialogHeader>

        <div className="space-y-3">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {collisionNote && <p className="text-sm text-amber-600">{collisionNote}</p>}

          <div>
            <label className="text-xs text-muted-foreground">Client</label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger><SelectValue placeholder="Which client?" /></SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Contact</label>
            {contact ? (
              <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <span className="flex-1">
                  {[contact.first_name, contact.last_name].filter(Boolean).join(" ")}
                  {contact.account_name && <span className="text-muted-foreground"> · {contact.account_name}</span>}
                </span>
                <button type="button" onClick={() => setContact(null)} aria-label="Clear contact">
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            ) : (
              <>
                <Input
                  value={query}
                  onChange={(e) => search(e.target.value)}
                  placeholder="Search by name or email…"
                />
                {results.length > 0 && (
                  <ul className="mt-1 max-h-48 overflow-auto rounded-md border">
                    {results.map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => { setContact(r); setResults([]); }}
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                        >
                          {[r.first_name, r.last_name].filter(Boolean).join(" ") || r.email}
                          {(r.title || r.account_name) && (
                            <span className="block text-xs text-muted-foreground">
                              {[r.title, r.account_name].filter(Boolean).join(" · ")}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {searching && <p className="mt-1 text-xs text-muted-foreground">Searching…</p>}
              </>
            )}
          </div>

          <Textarea placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Creating…" : "Create Opportunity"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
