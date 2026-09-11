"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Chip } from "@/components/pipeline/bits";
import { addVoiceNumber, setVoiceNumberStatus, type VoiceNumberRow } from "@/actions/dialer";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

const STATUS_COLOUR = { active: "emerald", paused: "slate", flagged: "rose" } as const;

/**
 * The pool click-to-dial rotates through, provisioned by hand.
 *
 * "Provisioning" here means recording a number already reserved in Dialpad —
 * this form doesn't buy or reserve anything there, it just registers the pool
 * for rotation. Buying the number itself still happens on Dialpad's side.
 */
export function VoiceNumbers({ numbers, members }: { numbers: VoiceNumberRow[]; members: { id: string; full_name: string | null; email: string }[] }) {
  const [rows, setRows] = useState(numbers);
  const [e164, setE164] = useState("");
  const [label, setLabel] = useState("");
  const [assignee, setAssignee] = useState<string>("shared");
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  function add() {
    if (!/^\+\d{8,15}$/.test(e164.trim())) {
      setError("Enter the number in E.164 format, e.g. +14155551234.");
      return;
    }
    setError(null);
    start(async () => {
      const result = await addVoiceNumber({
        e164: e164.trim(),
        provider: "dialpad",
        label: label.trim() || null,
        assigned_member_id: assignee === "shared" ? null : assignee,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRows((r) => [
        {
          id: crypto.randomUUID(),
          e164: e164.trim(),
          provider: "dialpad",
          label: label.trim() || null,
          assigned_member_id: assignee === "shared" ? null : assignee,
          assigned_member_name: assignee === "shared" ? null : members.find((m) => m.id === assignee)?.full_name ?? null,
          status: "active",
          last_used_at: null,
          calls_placed: 0,
        },
        ...r,
      ]);
      setE164("");
      setLabel("");
    });
  }

  function cycleStatus(row: VoiceNumberRow) {
    const next = row.status === "active" ? "paused" : row.status === "paused" ? "flagged" : "active";
    setRows((r) => r.map((x) => (x.id === row.id ? { ...x, status: next } : x)));
    start(async () => {
      try {
        await setVoiceNumberStatus(row.id, next);
      } catch {
        setRows((r) => r.map((x) => (x.id === row.id ? { ...x, status: row.status } : x)));
      }
    });
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
        <div>
          <label className="text-xs text-muted-foreground">Number</label>
          <Input value={e164} onChange={(e) => setE164(e.target.value)} placeholder="+14155551234" className="w-40" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Label</label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Optional" className="w-40" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Assign to</label>
          <Select value={assignee} onValueChange={setAssignee}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="shared">Shared pool</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.full_name ?? m.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={add} className="gap-1"><Plus className="h-4 w-4" /> Add number</Button>
      </div>

      <Table>
        <THead>
          <TR>
            <TH>Number</TH>
            <TH>Assigned to</TH>
            <TH>Calls placed</TH>
            <TH>Last used</TH>
            <TH>Status</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id}>
              <TD className="tabular-nums">{r.e164}{r.label && <span className="ml-2 text-xs text-muted-foreground">{r.label}</span>}</TD>
              <TD className="text-muted-foreground">{r.assigned_member_name ?? "Shared pool"}</TD>
              <TD className="tabular-nums">{r.calls_placed}</TD>
              <TD className="text-muted-foreground">{r.last_used_at ? new Date(r.last_used_at).toLocaleString() : "Never"}</TD>
              <TD>
                <button type="button" onClick={() => cycleStatus(r)}>
                  <Chip colour={STATUS_COLOUR[r.status]}>{r.status}</Chip>
                </button>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
