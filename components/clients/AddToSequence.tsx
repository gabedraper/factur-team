"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Surface } from "@/components/ui/surface";
import { control } from "@/components/ui/control";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/client-contacts";
import {
  addClientsToSequence, outreachSequences, previewClientRecipients,
  type Recipient, type Unreachable,
} from "@/actions/client-outreach";

/*
 * Putting the people at the selected clients onto a sequence.
 *
 * The panel exists to answer one question before anybody presses anything: who
 * is this actually going to. A client is a company and a sequence sends to
 * people, so picking forty clients is not picking forty recipients -- some have
 * three addresses on file and some have none, and the ones with none are
 * invisible everywhere else in the app.
 *
 * So the list of who would be missed is shown as prominently as the count of
 * who would be reached. A person sending an announcement to their book should
 * find out about the gap here, not when a client rings up asking why they were
 * not told.
 *
 * No address is ever posted from this screen. It sends the client ids and the
 * kind of contact wanted; the server resolves the addresses, and resolves them
 * again when the button is pressed.
 */

type Sequence = { slug: string; name: string; activeSteps: number };

export function AddToSequence({
  clientIds,
  onClose,
  onDone,
}: {
  clientIds: string[];
  onClose: () => void;
  /** Clears the selection behind the panel once people are on their way. */
  onDone: () => void;
}) {
  const router = useRouter();
  const [sequences, setSequences] = useState<Sequence[] | null>(null);
  const [slug, setSlug] = useState("");
  const [roles, setRoles] = useState<Role[]>(["primary"]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [unreachable, setUnreachable] = useState<Unreachable[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [saving, startSave] = useTransition();

  useEffect(() => {
    let live = true;
    outreachSequences().then((rows) => {
      if (!live) return;
      const list = rows.map((r) => ({ slug: r.slug, name: r.name, activeSteps: r.activeSteps }));
      setSequences(list);
      setSlug((s) => s || list[0]?.slug || "");
    });
    return () => { live = false; };
  }, []);

  /* The preview follows the roles, because changing them changes who is in it. */
  useEffect(() => {
    startLoad(async () => {
      const res = await previewClientRecipients(clientIds, roles);
      setProblem(res.error ?? null);
      setRecipients(res.recipients);
      setUnreachable(res.unreachable);
    });
  }, [clientIds, roles]);

  const toggleRole = (role: Role) =>
    setRoles((rs) => (rs.includes(role) ? rs.filter((r) => r !== role) : [...rs, role]));

  const chosen = sequences?.find((s) => s.slug === slug) ?? null;

  const add = () => {
    setProblem(null);
    startSave(async () => {
      const res = await addClientsToSequence(slug, clientIds, roles);
      if (!res.success) { setProblem(res.error ?? "Could not add them."); return; }
      const bits = [`${res.added} added`];
      if (res.alreadyIn) bits.push(`${res.alreadyIn} already on it`);
      if (res.missed) bits.push(`${res.missed} with no address`);
      setDone(bits.join(", "));
      onDone();
      router.refresh();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        role="dialog"
        aria-label="Add to sequence"
        className="flex h-full w-full max-w-lg flex-col bg-card shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b px-card py-3">
          <h2 className="text-section-title">Add to sequence</h2>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-card py-4">
          {done ? (
            <Surface>
              <p className="text-body">{done}.</p>
              <p className="mt-1 text-meta text-muted-foreground">
                They are on the sequence. Nothing is sent until somebody opens it and sends
                the step that is due.
              </p>
            </Surface>
          ) : (
            <>
              {sequences !== null && sequences.length === 0 && (
                <Surface>
                  <p className="text-body">There are no sequences yet.</p>
                  <p className="mt-1 text-meta text-muted-foreground">
                    One gets built under Settings, then clients can be added to it here.
                  </p>
                </Surface>
              )}

              <Field label="Sequence" error={problem ?? undefined}>
                <select
                  className={control({ className: "w-full" })}
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  disabled={!sequences || sequences.length === 0}
                >
                  {(sequences ?? []).map((s) => (
                    <option key={s.slug} value={s.slug}>{s.name}</option>
                  ))}
                </select>
              </Field>

              {chosen && chosen.activeSteps === 0 && (
                <p className="text-meta text-muted-foreground">
                  That sequence has no active steps, so nobody on it has anything to be sent
                  yet. Adding them now is still fine — they will be waiting when a step is
                  turned on.
                </p>
              )}

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
                  {loading ? "Working out who…" : `${recipients.length} recipient${recipients.length === 1 ? "" : "s"}`}
                </h3>
                {recipients.length > 0 && (
                  <Surface pad="none">
                    <ul className="max-h-56 divide-y overflow-y-auto">
                      {recipients.map((r) => (
                        <li key={r.email} className="flex items-baseline justify-between gap-2 px-3 py-1.5">
                          <span className="truncate text-body">{r.clientName}</span>
                          <span className="shrink-0 text-meta text-muted-foreground">{r.email}</span>
                        </li>
                      ))}
                    </ul>
                  </Surface>
                )}
              </section>

              {unreachable.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-section-title">
                    {unreachable.length} will be missed
                  </h3>
                  <p className="text-meta text-muted-foreground">
                    No address on file for the kind of contact chosen. Adding one on the
                    client&rsquo;s own page brings them in.
                  </p>
                  <Surface pad="none">
                    <ul className="max-h-40 divide-y overflow-y-auto">
                      {unreachable.map((u) => (
                        <li key={u.clientId} className="truncate px-3 py-1.5 text-body">
                          {u.clientName}
                        </li>
                      ))}
                    </ul>
                  </Surface>
                </section>
              )}
            </>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t px-card py-3">
          <Button variant="outline" size="sm" onClick={onClose}>
            {done ? "Close" : "Cancel"}
          </Button>
          {!done && (
            <Button
              className="ml-auto"
              size="sm"
              disabled={saving || loading || recipients.length === 0 || !slug}
              onClick={add}
            >
              Add {recipients.length} to sequence
            </Button>
          )}
        </footer>
      </aside>
    </div>
  );
}
