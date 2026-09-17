"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Portal } from "@/components/ui/portal";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Surface } from "@/components/ui/surface";
import { control } from "@/components/ui/control";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/client-contacts";
import { previewClientRecipients, type Recipient, type Unreachable } from "@/actions/client-outreach";
import { startBroadcast, sendBroadcastBatch, draftBroadcastPreview } from "@/actions/client-broadcast";

/*
 * One email to the clients that are ticked.
 *
 * Two screens, because they are two different decisions. Writing it is a
 * decision about wording; sending it is a decision about a hundred and ninety
 * real people, and putting both behind one button is how an announcement goes
 * out with a placeholder still in it.
 *
 * The second screen is a review and nothing more: it writes nothing, so Back
 * costs nothing and closing the panel leaves nothing behind. It used to create
 * the sequence and enrol everybody before showing the list, which made a review
 * screen into a commitment -- going back would have had to delete real rows,
 * and every abandoned draft left a sequence and an audience lying about.
 *
 * It names every recipient rather than counting them. A number is not
 * checkable: "194 ready" could be the right 194 or the wrong ones, and the only
 * way to know is to look.
 */

/** What fill() in lib/sequences/audience understands. Nothing else is replaced. */
const MERGE_TAGS = [
  { tag: "{{first_name}}", label: "First name" },
  { tag: "{{company}}", label: "Company" },
  { tag: "{{last_name}}", label: "Last name" },
  { tag: "{{sender}}", label: "Your name" },
] as const;

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
  const [stage, setStage] = useState<"write" | "check" | "done">("write");
  const [roles, setRoles] = useState<Role[]>(["primary"]);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [unreachable, setUnreachable] = useState<Unreachable[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [busy, setBusy] = useState(false);
  const [rehearsed, setRehearsed] = useState(false);
  const [sent, setSent] = useState(0);
  const [failed, setFailed] = useState(0);
  const [finishedAs, setFinishedAs] = useState<"send" | "draft">("send");

  /*
   * Merge tags go in at the cursor of whichever box was last used, so a tag can
   * land mid-sentence in the message or inside the subject line. Typing them by
   * hand worked and was a small misery -- and a mistyped one is invisible until
   * a client reads "Hi {{frist_name}}".
   */
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [lastUsed, setLastUsed] = useState<"subject" | "body">("body");
  /* Where to put the cursor once React has painted the new value. */
  const caret = useRef<{ field: "subject" | "body"; at: number } | null>(null);

  useEffect(() => {
    const pending = caret.current;
    if (!pending) return;
    caret.current = null;
    const el = pending.field === "subject" ? subjectRef.current : bodyRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(pending.at, pending.at);
  }, [subject, body]);

  const insertTag = (tag: string) => {
    const field = lastUsed;
    const el = field === "subject" ? subjectRef.current : bodyRef.current;
    const current = field === "subject" ? subject : body;
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + tag + current.slice(end);
    caret.current = { field, at: start + tag.length };
    if (field === "subject") setSubject(next);
    else setBody(next);
  };

  /* Who it would go to. Re-read while writing, since the roles change it. */
  useEffect(() => {
    if (stage === "done") return;
    startLoad(async () => {
      const res = await previewClientRecipients(clientIds, roles);
      setProblem(res.error ?? null);
      setRecipients(res.recipients);
      setUnreachable(res.unreachable);
    });
  }, [clientIds, roles, stage]);

  const toggleRole = (role: Role) =>
    setRoles((rs) => (rs.includes(role) ? rs.filter((r) => r !== role) : [...rs, role]));

  const rehearse = async () => {
    setProblem(null);
    setBusy(true);
    const res = await draftBroadcastPreview({ subject, body, clientIds, roles });
    setBusy(false);
    if (!res.success) { setProblem(res.error ?? "Could not draft it."); return; }
    setRehearsed(true);
  };

  /*
   * Writing it down and sending are one action from here. The audience is fixed
   * at the moment the first message leaves rather than minutes earlier, and a
   * send that never starts leaves nothing behind.
   *
   * Twenty at a time: the whole queue in one server action runs past the
   * request timeout at this size, and batching is what lets the screen say how
   * far it got.
   */
  const deliverAll = async (deliver: "send" | "draft") => {
    setProblem(null);
    setBusy(true);
    setFinishedAs(deliver);

    const started = await startBroadcast({ name, subject, body, clientIds, roles });
    if (!started.success || !started.slug) {
      setBusy(false);
      setProblem(started.error ?? "Could not prepare the email.");
      return;
    }

    let guard = 0;
    for (;;) {
      const res = await sendBroadcastBatch(started.slug, deliver);
      if (!res.success) { setProblem(res.error ?? "It stopped partway."); break; }
      setSent((n) => n + (res.done ?? 0));
      setFailed((n) => n + (res.failed ?? 0));
      if ((res.remaining ?? 0) <= 0) break;
      /* Nothing moved and nothing failed: stop rather than spin. */
      if ((res.done ?? 0) === 0 && (res.failed ?? 0) === 0) break;
      if (++guard > 100) break;
    }

    setBusy(false);
    setStage("done");
    onDone();
    router.refresh();
  };

  const ready = Boolean(name.trim() && subject.trim() && body.trim() && recipients.length > 0);

  const title =
    stage === "write"
      ? "Write the email"
      : stage === "check"
        ? "Check and send"
        : finishedAs === "send"
          ? "Sent"
          : "Drafted";

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
        <aside
          role="dialog"
          aria-label="Send an email"
          className="flex h-full w-full max-w-lg flex-col bg-card shadow-modal"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="flex items-center gap-2 border-b px-card py-3">
            {stage === "check" && (
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2"
                disabled={busy}
                onClick={() => setStage("write")}
              >
                <ChevronLeft className="mr-1 h-4 w-4" /> Back
              </Button>
            )}
            <h2 className="text-section-title">{title}</h2>
            <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </header>

          <div className="flex-1 space-y-4 overflow-y-auto px-card py-4">
            {stage === "done" ? (
              <Surface>
                <p className="text-body">
                  {finishedAs === "send"
                    ? `Sent to ${sent} ${sent === 1 ? "person" : "people"}`
                    : `${sent} draft${sent === 1 ? "" : "s"} waiting in your mailbox`}
                  {failed > 0 ? `, ${failed} failed` : ""}.
                </p>
                <p className="mt-1 text-meta text-muted-foreground">
                  {finishedAs === "send"
                    ? "Every message is recorded against the client it went to."
                    : "Each one is addressed to the client and nothing has gone out. " +
                      "Open your drafts to read them and send. They are recorded as done here, " +
                      "so this will not draft them a second time."}
                </p>
              </Surface>
            ) : stage === "check" ? (
              <>
                <Surface>
                  <p className="text-body">{recipients.length} ready to send.</p>
                  <p className="mt-1 text-meta text-muted-foreground">
                    Nothing has gone out yet, and nothing is written down until you send or
                    draft. Draft one to yourself first — it renders exactly as the first
                    client will see it.
                  </p>
                </Surface>

                {rehearsed && (
                  <p className="text-body text-muted-foreground">
                    A copy is waiting in your drafts. Read it, then send.
                  </p>
                )}

                {busy && (
                  <p className="text-body tabular-nums">
                    {sent} {finishedAs === "send" ? "sent" : "drafted"}
                    {failed > 0 ? `, ${failed} failed` : ""} of {recipients.length}…
                  </p>
                )}

                <section className="space-y-2">
                  <h3 className="text-section-title">Going to</h3>
                  <Surface pad="none">
                    <ul className="max-h-80 divide-y overflow-y-auto">
                      {recipients.map((r) => (
                        <li
                          key={r.email}
                          className="flex items-baseline justify-between gap-2 px-3 py-1.5"
                        >
                          <span className="truncate text-body">{r.clientName}</span>
                          <span className="shrink-0 text-meta text-muted-foreground">{r.email}</span>
                        </li>
                      ))}
                    </ul>
                  </Surface>
                </section>

                {unreachable.length > 0 && (
                  <p className="text-meta text-muted-foreground">
                    {unreachable.length} of the clients picked have no address on file and will
                    not get this.
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
                    ref={subjectRef}
                    value={subject}
                    onFocus={() => setLastUsed("subject")}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="A change to your reporting in October"
                  />
                </Field>

                <Field label="Message" error={problem ?? undefined}>
                  <textarea
                    ref={bodyRef}
                    rows={10}
                    value={body}
                    onFocus={() => setLastUsed("body")}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={"Hi {{first_name}},\n\n...\n\n{{sender}}"}
                    className={control({ multiline: true, className: "w-full" })}
                  />
                </Field>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-meta text-muted-foreground">
                    Insert into the {lastUsed === "subject" ? "subject" : "message"}:
                  </span>
                  {MERGE_TAGS.map((m) => (
                    <button
                      key={m.tag}
                      type="button"
                      /* Keeps the cursor where it was: the click would otherwise
                         blur the box before the tag could be placed in it. */
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => insertTag(m.tag)}
                      title={m.tag}
                      className="rounded-md border px-2 py-0.5 text-meta transition-colors duration-fast ease-out hover:bg-card-hover"
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

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

          <footer className="flex flex-wrap items-center gap-2 border-t px-card py-3">
            {stage === "check" ? (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setStage("write")}>
                <ChevronLeft className="mr-1 h-4 w-4" /> Back
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={onClose}>
                {stage === "done" ? "Close" : "Cancel"}
              </Button>
            )}

            {stage === "write" && (
              <Button
                className="ml-auto"
                size="sm"
                disabled={busy || loading || !ready}
                onClick={() => { setProblem(null); setStage("check"); }}
              >
                Check {recipients.length} recipient{recipients.length === 1 ? "" : "s"}
              </Button>
            )}

            {stage === "check" && (
              <>
                <Button variant="outline" size="sm" disabled={busy} onClick={rehearse}>
                  Draft one to me
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  disabled={busy}
                  onClick={() => deliverAll("draft")}
                  title="Writes one draft per client into your mailbox. Nothing is sent."
                >
                  Draft {recipients.length} to them
                </Button>
                <Button size="sm" disabled={busy} onClick={() => deliverAll("send")}>
                  Send to {recipients.length}
                </Button>
              </>
            )}
          </footer>
        </aside>
      </div>
    </Portal>
  );
}
