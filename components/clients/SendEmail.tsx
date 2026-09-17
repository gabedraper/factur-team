"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Portal } from "@/components/ui/portal";
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
 * The second stage names every recipient rather than counting them. A number is
 * not checkable -- "194 ready" could be the right 194 or the wrong ones, and
 * the only way to know is to look. The list it shows is the one the server
 * enrolled, not the preview from a minute earlier.
 *
 * Between the stages sits the rehearsal: one copy, rendered exactly as the
 * first client will see it, drafted into your own mailbox. It is not recorded,
 * so the real send is untouched by it.
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
  const [queued, setQueued] = useState<{ clientName: string; email: string }[]>([]);
  const [sent, setSent] = useState(0);
  const [failed, setFailed] = useState(0);
  const [rehearsed, setRehearsed] = useState(false);
  const [finished, setFinished] = useState(false);

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
    setQueued(res.queued ?? []);
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
    <Portal>
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
                  <p className="text-body">
                    {queued.length} ready to send.
                  </p>
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
                    {sent} sent{failed > 0 ? `, ${failed} failed` : ""} of {queued.length}.
                  </p>
                )}

                <section className="space-y-2">
                  <h3 className="text-section-title">Going to</h3>
                  <Surface pad="none">
                    <ul className="max-h-80 divide-y overflow-y-auto">
                      {queued.map((q) => (
                        <li
                          key={q.email}
                          className="flex items-baseline justify-between gap-2 px-3 py-1.5"
                        >
                          <span className="truncate text-body">{q.clientName}</span>
                          <span className="shrink-0 text-meta text-muted-foreground">{q.email}</span>
                        </li>
                      ))}
                    </ul>
                  </Surface>
                </section>

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
                  {recipients.length > 0 && (
                    <Surface pad="none">
                      <ul className="max-h-48 divide-y overflow-y-auto">
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
                  )}
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
                  Send to {queued.length}
                </Button>
              </>
            )}
          </footer>
          </aside>
      </div>
    </Portal>
  );
}
