"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { runReconcileNow } from "@/actions/salesforce-sync";

export function CheckNow() {
  const [busy, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-3">
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => start(async () => {
          const r = await runReconcileNow();
          setNote(r.ok ? r.summary : r.error);
        })}
      >
        {busy ? "Checking…" : "Check now"}
      </Button>
      {note && <span className="text-meta text-muted-foreground">{note}</span>}
    </span>
  );
}
