"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Input } from "@/components/ui/input";
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
  const [state, setState] = useState({ phone: phone ?? "", email: email ?? "" });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  function save(patch: Partial<typeof state>) {
    const next = { ...state, ...patch };
    setState(next);
    setError(null);
    start(async () => {
      try {
        await updateContact(contactId, { phone: next.phone || null, email: next.email || null });
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
            onBlur={(e) => save({ phone: e.target.value })}
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
            onBlur={(e) => save({ email: e.target.value })}
          />
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-xs text-muted-foreground">Industry</span>
          <span>{industry ?? "—"}</span>
        </div>
      </div>
    </Panel>
  );
}
