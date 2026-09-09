"use client";

import { useState, useTransition } from "react";
import { Check, Phone as PhoneIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/pipeline/bits";
import { updateContact } from "@/actions/pipeline";
import { useDialer } from "@/components/work-panel/dialer-context";
import { toE164 } from "@/lib/phone";

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
  const { requestCall } = useDialer();

  // Explicit Save rather than auto-save-on-blur: these fields double as the
  // number a click-to-dial affordance would read from, and a click meant to
  // dial shouldn't also fire a blur-triggered save.
  const dirty = state.phone !== initial.phone || state.email !== initial.email;

  // Dials whatever's currently in the field, saved or not -- crm_contacts.phone
  // is Salesforce-sourced and often not clean E.164 (parens/dashes, a
  // spreadsheet-import ".0" suffix, even outright corrupted "+XXX ..."
  // entries), so this is null more often than it should be. That's surfaced
  // below rather than silently disabling the button with no explanation.
  const dialableNumber = toE164(state.phone);

  function save() {
    setError(null);
    start(async () => {
      const result = await updateContact(contactId, { phone: state.phone || null, email: state.email || null });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  }

  return (
    <Panel title="Contact" action={saved && <span className="flex items-center gap-1 text-xs text-emerald-600"><Check className="h-3 w-3" /> Saved</span>}>
      <div className="space-y-3 p-4 text-sm">
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div>
          <label className="text-xs text-muted-foreground">Phone</label>
          <div className="flex gap-2">
            <Input
              value={state.phone}
              onChange={(e) => setState((s) => ({ ...s, phone: e.target.value }))}
              placeholder="+14155551234"
              className="tabular-nums"
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              title={dialableNumber ? `Call ${dialableNumber}` : "This number doesn't look valid"}
              disabled={!dialableNumber}
              onClick={() => dialableNumber && requestCall(dialableNumber)}
            >
              <PhoneIcon className="h-4 w-4" />
            </Button>
          </div>
          {state.phone.trim() && !dialableNumber && (
            <p className="mt-1 text-xs text-red-600">Doesn&apos;t look like a valid number.</p>
          )}
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
