"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Send, X } from "lucide-react";
import { sendTalentEmail } from "@/actions/talent-mail";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/talent/bits";
import { FIELD } from "@/lib/field-class";

type Template = { id: string; name: string; subject: string; body: string };

/**
 * Writing to a candidate.
 *
 * Two buttons, not one, and Draft is the wider of them. The message goes out
 * from the sender's own mailbox either way, so drafting puts it in their Gmail
 * to read once more before it goes -- which for a first approach to a candidate
 * is worth the extra click. Sending outright is there for the reply to a reply.
 *
 * Merge fields are filled server-side at send time, so what is typed here is
 * the template and what arrives is the letter.
 */
export function EmailPerson({
  personId, personName, to, templates, jobId, candidateId, blocked,
}: {
  personId: string;
  personName: string;
  to: string | null;
  templates: Template[];
  jobId?: string | null;
  candidateId?: string | null;
  blocked: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState(to ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function place(mode: "semi" | "full") {
    setError(null);
    setResult(null);
    start(async () => {
      const res = await sendTalentEmail({
        personId, to: address, subject, body, mode, jobId, candidateId,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult(
        res.placed === "sent"
          ? `Sent to ${address}`
          : `Drafted in your Gmail — open Drafts to send it`
      );
      setSubject("");
      setBody("");
      router.refresh();
    });
  }

  if (blocked) {
    return (
      <Button size="sm" variant="outline" disabled title={blocked}>
        <Mail className="mr-1.5 h-4 w-4" />
        {blocked}
      </Button>
    );
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Mail className="mr-1.5 h-4 w-4" />
        Email
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 p-6 pt-20">
      <div className="w-full max-w-2xl space-y-3 rounded-lg border bg-card p-4 shadow-xl">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Email {personName}</h2>
          <button
            type="button"
            onClick={() => { setOpen(false); setResult(null); setError(null); }}
            className="ml-auto text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            className={`min-w-56 flex-1 px-2 py-1.5 text-sm ${FIELD}`}
            value={address}
            placeholder="To"
            onChange={(e) => setAddress(e.target.value)}
          />
          {templates.length > 0 && (
            <select
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
              value=""
              onChange={(e) => {
                const t = templates.find((x) => x.id === e.target.value);
                if (t) { setSubject(t.subject); setBody(t.body); }
              }}
            >
              <option value="">Template</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
        </div>

        <input
          className={`w-full px-2 py-1.5 text-sm ${FIELD}`}
          value={subject}
          placeholder="Subject"
          autoFocus
          onChange={(e) => setSubject(e.target.value)}
        />

        <textarea
          className={`min-h-48 w-full px-3 py-2 text-sm ${FIELD}`}
          value={body}
          placeholder="Hi {{first_name}},"
          onChange={(e) => setBody(e.target.value)}
        />

        <div className="flex flex-wrap items-center gap-1.5">
          {["{{first_name}}", "{{name}}", "{{title}}", "{{company}}"].map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setBody((b) => `${b}${f}`)}
              className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground"
            >
              {f}
            </button>
          ))}
        </div>

        {result && (
          <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
            {result}
          </p>
        )}
        {error && (
          <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {error}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={pending || !address.includes("@") || !subject.trim()}
            onClick={() => place("semi")}
          >
            {pending ? "Placing…" : "Draft in my Gmail"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !address.includes("@") || !subject.trim()}
            onClick={() => place("full")}
          >
            <Send className="mr-1.5 h-4 w-4" />
            Send now
          </Button>
          <Chip className="ml-auto">from your mailbox</Chip>
        </div>
      </div>
    </div>
  );
}
