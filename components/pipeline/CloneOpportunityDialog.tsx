"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { cloneOpportunity } from "@/actions/pipeline";

type ClientOption = { id: string; name: string; heldBy: string | null; mine: boolean };

/**
 * Cross-selling an RFQ: the same pursuit, opened under a client who can
 * actually make the part.
 *
 * One question, the receiving client -- the contact and everything typed
 * against the RFQ come across on their own, and what the first client's
 * pursuit had reached does not. That is spelled out under the picker rather
 * than left to be discovered on the copy, because "keeping all the
 * information already entered" is the whole point and a rep needs to know
 * before they click which half of it that means.
 *
 * Closing the first one stays a separate, deliberate act: its stage is one
 * select away on the page behind this, and nobody's pipeline should close
 * itself as a side effect of a copy.
 */
export function CloneOpportunityDialog({
  opportunityId, clients, currentClientId,
}: {
  opportunityId: string;
  clients: ClientOption[];
  /** Dropped from the picker -- it is the client already pursuing this one. */
  currentClientId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  function submit() {
    if (!clientId) {
      setError("Pick the client to clone it onto.");
      return;
    }
    setError(null);
    startSave(async () => {
      const result = await cloneOpportunity(opportunityId, clientId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setClientId("");
      router.push(`/opportunities/${result.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setClientId(""); setError(null); } }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1">
          <Copy className="h-4 w-4" /> Clone to another client
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Clone to another client</DialogTitle></DialogHeader>

        <div className="space-y-3">
          {error && <p className="text-body text-red-600">{error}</p>}

          <div>
            <label className="text-meta text-muted-foreground">Client</label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger><SelectValue placeholder="Which client takes it on?" /></SelectTrigger>
              <SelectContent>
                {clients.filter((c) => c.id !== currentClientId).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-meta text-muted-foreground">
            The contact, the company, the notes and the updates come across. Stage, lead status,
            the funnel and the dates start fresh, and a note on each record says where the copy
            came from.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Cloning…" : "Clone opportunity"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
