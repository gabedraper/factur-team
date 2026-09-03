"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/pipeline/bits";
import { updateContact } from "@/actions/pipeline";

export function ContactEditor({
  contactId, phone, email, industry,
}: {
  contactId: string;
  phone: string | null;
  email: string | null;
  industry: string | null;
}) {
  const initial = { phone: phone ?? "", email: email ?? "" };
  const [state, setState] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Explicit Save rather than auto-save-on-blur: these fields double as the
  // number a click-to-dial affordance would read from, and a click meant to
  // dial shouldn't also fire a blur-triggered save.
  const dirty = state.phone !== initial.phone || state.email !== initial.email;

  function save() {
    setError(null);
    start(async () => {
      try {
        await updateContact(contactId, { phone: state.phone || null, email: state.email || null });
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save that change.");
      }
    });
  }

  return (
    <Panel title="Contact" action={saved && <span className="flex items-center gap-1 text-xs text-emerald-600"><Check className="h-3 w-3" /> Saved</span>}>
      <div className="space-y-3 p-4 text-sm">
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div>
          <label className="text-xs text-muted-foreground">Phone</label>
          <Input
            value={state.phone}
            onChange={(e) => setState((s) => ({ ...s, phone: e.target.value }))}
            placeholder="+14155551234"
            className="tabular-nums"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Email</label>
          <Input
            type="email"
            value={state.email}
            onChange={(e) => setState((s) => ({ ...s, email: e.target.value }))}
          />
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-xs text-muted-foreground">Industry</span>
          <span>{industry ?? "—"}</span>
        </div>
        <Button size="sm" onClick={save} disabled={!dirty || pending}>
          Save
        </Button>
      </div>
    </Panel>
  );
}
