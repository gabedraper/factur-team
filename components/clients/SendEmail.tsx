"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Surface } from "@/components/ui/surface";
import { control } from "@/components/ui/control";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/client-contacts";
import { previewClientRecipients, type Recipient, type Unreachable } from "@/actions/client-outreach";
import { startBroadcast, sendBroadcastBatch } from "@/actions/client-broadcast";

/*
 * One email to the clients that are ticked.
 *
 * Two stages, because they are two different decisions. Writing it is a
 * decision about wording; sending it is a decision about a hundred and ninety
 * real people, and putting both behind one button is how an announcement goes
 * out with a placeholder still in it.
 *
 * Between them sits the rehearsal: one copy, rendered exactly as the first
 * client will see it, drafted into your own mailbox. It is not recorded, so the
 * real send is untouched by it.
 *
 * Sending reports as it goes. The batch call returns what is left, so a long
 * send shows a number climbing rather than a spinner that might mean anything.
 */

const MERGE_HINT = "{{first_name}}, {{company}} and {{sender}} are filled in for each client.";

export function SendEmail({
  clientIds,
  onClose,
  onDone,
}: {
  clientIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [roles, setRoles] = useState<Role[]>(["primary"]);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [unreachable, setUnreachable] = useState<Unreachable[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [busy, setBusy] = useState(false);

  /* Set once it is written down and the audience is fixed. */
  const [slug, setSlug] = useState<string | null>(null);
  const [queued, setQueued] = useState(0);
  const [sent, setSent] = useState(0);
  const [failed, setFailed] = useState(0);
  const [rehearsed, setRehearsed] = useState(false);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (slug) return;
    startLoad(async () => {
      const res = await previewClientRecipients(clientIds, roles);
      setProblem(res.error ?? null);
      setRecipients(res.recipients);
      setUnreachable(res.unreachable);
    });
  }, [clientIds, roles, slug]);

  const toggleRole = (role: Role) =>
    setRoles((rs) => (rs.includes(role) ? rs.filter((r) => r !== role) : [...rs, role]));

  const prepare = async () => {
    setProblem(null);
    setBusy(true);
    const res = await startBroadcast({ name, subject, body, clientIds, roles });
    setBusy(false);
    if (!res.success || !res.slug) {
      setProblem(res.error ?? "Could not prepare the email.");
      return;
    }
    setSlug(res.slug);
    setQueued(res.recipients ?? 0);
  };

  const rehearse = async () => {
    if (!slug) return;
    setProblem(null);
    setBusy(true);
    const res = await sendBroadcastBatch(slug, "rehearse");
    setBusy(false);
    if (!res.success) { setProblem(res.error ?? "Could not draft it."); return; }
    setRehearsed(true);
  };

  /* Twenty at a time until the queue is empty, so a long send cannot run past
     the request timeout and can say how far it got. */
  const sendAll = async () => {
    if (!slug) return;
    setProblem(null);
    setBusy(true);
    let guard = 0;
    for (;;) {
      const res = await sendBroadcastBatch(slug, "send");
      if (!res.success) { setProblem(res.error ?? "Sending stopped."); break; }
      setSent((n) => n + (res.done ?? 0));
      setFailed((n) => n + (res.failed ?? 0));
      if ((res.remaining ?? 0) <= 0) { setFinished(true); break; }
      /* Nothing moved and nothing failed: stop rather than spin. */
      if ((res.done ?? 0) === 0 && (res.failed ?? 0) === 0) break;
      if (++guard > 100) break;
    }
    setBusy(false);
    onDone();
    router.refresh();
  };

  const ready = name.trim() && subject.trim() && body.trim() && recipients.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        role="dialog"
        aria-label="Send an email"
        className="flex h-full w-full max-w-lg flex-col bg-card shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b px-card py-3">
          <h2 className="text-section-title">{slug ? "Check and send" : "Write the email"}</h2>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-card py-4">
          {finished ? (
            <Surface>
              <p className="text-body">
                Sent to {sent} {sent === 1 ? "person" : "people"}
                {failed > 0 ? `, ${failed} failed` : ""}.
              </p>
              <p className="mt-1 text-meta text-muted-foreground">
                Every message is recorded against the client it went to.
              </p>
            </Surface>
          ) : slug ? (
            <>
              <Surface>
                <p className="text-body">{queued} ready to send.</p>
                <p className="mt-1 text-meta text-muted-foreground">
                  Nothing has gone out yet. Draft one to yourself first — it renders exactly
                  as the first client will see it, and it is not counted as sent.
                </p>
              </Surface>

              {rehearsed && (
                <p className="text-body text-muted-foreground">
                  A copy is waiting in your drafts. Read it, then send.
                </p>
              )}

              {(sent > 0 || failed > 0) && (
                <p className="text-body tabular-nums">
                  {sent} sent{failed > 0 ? `, ${failed} failed` : ""} of {queued}.
                </p>
              )}

              {problem && <p className="text-body text-red-600 dark:text-red-400">{problem}</p>}
            </>
          ) : (
            <>
              <Field label="Name it" hint="Only you see this. It is how you find the send later.">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="September service update"
                />
              </Field>

              <Field label="Subject">
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="A change to your reporting in October"
                />
              </Field>

              <Field label="Message" hint={MERGE_HINT} error={problem ?? undefined}>
                <textarea
                  rows={10}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={"Hi {{first_name}},\n\n...\n\n{{sender}}"}
                  className={control({ multiline: true, className: "w-full" })}
                />
              </Field>

              <fieldset className="space-y-1">
                <legend className="text-meta text-muted-foreground">Send to</legend>
                {ROLES.map((role) => (
                  <label key={role} className="flex items-center gap-2 text-body">
                    <input
                      type="checkbox"
                      checked={roles.includes(role)}
                      onChange={() => toggleRole(role)}
                    />
                    {ROLE_LABEL[role]}
                  </label>
                ))}
              </fieldset>

              <section className="space-y-2">
                <h3 className="text-section-title">
                  {loading
                    ? "Working out who…"
                    : `${recipients.length} recipient${recipients.length === 1 ? "" : "s"}`}
                </h3>
                {unreachable.length > 0 && (
                  <p className="text-meta text-muted-foreground">
                    {unreachable.length} of the clients picked have no address on file and will
                    not get this: {unreachable.slice(0, 5).map((u) => u.clientName).join(", ")}
                    {unreachable.length > 5 ? ` and ${unreachable.length - 5} more` : ""}.
                  </p>
                )}
              </section>
            </>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t px-card py-3">
          <Button variant="outline" size="sm" onClick={onClose}>
            {finished ? "Close" : "Cancel"}
          </Button>
          {!slug && (
            <Button className="ml-auto" size="sm" disabled={busy || loading || !ready} onClick={prepare}>
              Prepare for {recipients.length}
            </Button>
          )}
          {slug && !finished && (
            <>
              <Button variant="outline" size="sm" disabled={busy} onClick={rehearse}>
                Draft one to me
              </Button>
              <Button className="ml-auto" size="sm" disabled={busy} onClick={sendAll}>
                Send to {queued}
              </Button>
            </>
          )}
        </footer>
      </aside>
    </div>
  );
}
