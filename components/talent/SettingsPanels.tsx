"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Plug, Plus, Trash2 } from "lucide-react";
import {
  bulkCreateEmailTemplates, deleteStage, deleteTemplate, saveActivityType,
  saveEmailTemplate, saveNoteTemplate, saveSettings, saveStage, saveWorkflow,
  setIntegrationStatus,
} from "@/actions/talent-admin";
import { saveMailAccounts, syncMailNow } from "@/actions/talent-mail";
import { Button } from "@/components/ui/button";
import { Chip, Empty, Panel } from "@/components/talent/bits";
import { FIELD } from "@/lib/field-class";
import { STAGE_COLOURS, STAGE_KIND, TONE, type Integration, type TalentSettings } from "@/lib/talent/types";
import { cn } from "@/lib/utils";

const input = `w-full px-2 py-1.5 text-sm ${FIELD}`;

type Stage = {
  id: string; workflow_id: string; name: string; kind: string;
  position: number; color: string; is_terminal: boolean;
};
type Workflow = {
  id: string; name: string; slug: string; description: string | null;
  is_default: boolean; active: boolean; stages: Stage[];
};

/** Pipelines and their stages. Renaming one moves every board that uses it. */
export function WorkflowSettings({ workflows }: { workflows: Workflow[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("other");
  const [colour, setColour] = useState("slate");
  const [newFlow, setNewFlow] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {workflows.map((w) => (
        <Panel
          key={w.id}
          title={
            <span className="flex items-center gap-2">
              {w.name}
              {w.is_default && <Chip colour="emerald">Default</Chip>}
            </span>
          }
          action={
            <Button size="sm" variant="ghost" onClick={() => setAdding(adding === w.id ? null : w.id)}>
              <Plus className="h-4 w-4" />
            </Button>
          }
        >
          {adding === w.id && (
            <div className="flex flex-wrap gap-2 border-b bg-muted/30 px-4 py-3">
              <input className={`w-40 px-2 py-1.5 text-sm ${FIELD}`} placeholder="Stage name"
                value={name} autoFocus onChange={(e) => setName(e.target.value)} />
              <select className="rounded-md border bg-background px-2 py-1.5 text-sm"
                value={kind} onChange={(e) => setKind(e.target.value)}>
                {Object.entries(STAGE_KIND).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <select className="rounded-md border bg-background px-2 py-1.5 text-sm"
                value={colour} onChange={(e) => setColour(e.target.value)}>
                {STAGE_COLOURS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <Button size="sm" disabled={pending || !name.trim()}
                onClick={() => start(async () => {
                  await saveStage({ workflow_id: w.id, name, kind, color: colour });
                  setName(""); setAdding(null); router.refresh();
                })}
              >Add</Button>
            </div>
          )}

          {w.stages.length === 0 ? <Empty>No stages</Empty> : (
            <ul className="divide-y">
              {w.stages.map((s) => (
                <li key={s.id} className="group flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {s.position + 1}
                  </span>
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", TONE[s.color]?.dot ?? TONE.slate.dot)} />
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {STAGE_KIND[s.kind as keyof typeof STAGE_KIND] ?? s.kind}
                  </span>
                  {s.is_terminal && <Chip colour="slate">end</Chip>}
                  <button
                    type="button"
                    className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label={`Remove ${s.name}`}
                    onClick={() => start(async () => {
                      try {
                        await deleteStage(s.id);
                        router.refresh();
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "Could not remove that stage");
                      }
                    })}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-600" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ))}

      <div className="flex gap-2">
        <input className={`w-56 px-2 py-1.5 text-sm ${FIELD}`} placeholder="New pipeline"
          value={newFlow} onChange={(e) => setNewFlow(e.target.value)} />
        <Button size="sm" disabled={pending || !newFlow.trim()}
          onClick={() => start(async () => {
            await saveWorkflow({ name: newFlow });
            setNewFlow(""); router.refresh();
          })}
        >Add pipeline</Button>
      </div>
    </div>
  );
}

/** The public careers page: whether it exists and what it says. */
export function CareersSettings({ settings }: { settings: TalentSettings }) {
  const router = useRouter();
  const [form, setForm] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  return (
    <Panel title="Careers page">
      <div className="space-y-3 px-4 py-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.careers_page_enabled}
            onChange={(e) => setForm({ ...form, careers_page_enabled: e.target.checked })}
          />
          Enabled
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Heading</span>
          <input className={input} value={form.careers_page_heading}
            onChange={(e) => setForm({ ...form, careers_page_heading: e.target.value })} />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Intro</span>
          <textarea className={`${input} min-h-20`} value={form.careers_page_intro ?? ""}
            onChange={(e) => setForm({ ...form, careers_page_intro: e.target.value })} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Reply-to</span>
            <input className={input} value={form.careers_apply_email ?? ""}
              onChange={(e) => setForm({ ...form, careers_apply_email: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Guarantee days</span>
            <input className={input} type="number" value={form.default_guarantee_days}
              onChange={(e) => setForm({ ...form, default_guarantee_days: Number(e.target.value) })} />
          </label>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" disabled={pending}
            onClick={() => start(async () => {
              await saveSettings(form);
              setSaved(true);
              router.refresh();
            })}
          >Save</Button>
          {saved && <Check className="h-4 w-4 text-emerald-600" />}
          <a href="/careers" target="_blank" rel="noreferrer"
            className="text-sm text-primary hover:underline">/careers</a>
        </div>
      </div>
    </Panel>
  );
}

/**
 * The integration register.
 *
 * Marking something connected does not connect it -- the credential lives in an
 * environment variable and the deployment is what makes it real. This switch is
 * what the features read, so it is set once the wiring is genuinely done.
 */
export function IntegrationSettings({ integrations }: { integrations: Integration[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const groups = new Map<string, Integration[]>();
  for (const i of integrations) groups.set(i.category, [...(groups.get(i.category) ?? []), i]);

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {[...groups.entries()].map(([category, items]) => (
        <Panel key={category} title={category}>
          <ul className="divide-y">
            {items.map((i) => (
              <li key={i.slug} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Plug className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm font-medium">{i.name}</span>
                  <Chip colour={
                    i.status === "connected" ? "emerald"
                      : i.status === "error" ? "rose"
                      : i.status === "disabled" ? "slate" : "amber"
                  }>
                    {i.status.replace("_", " ")}
                  </Chip>
                  <select
                    className="ml-auto rounded-md border bg-background px-2 py-1 text-sm"
                    value={i.status}
                    disabled={pending}
                    onChange={(e) => start(async () => {
                      try {
                        await setIntegrationStatus(
                          i.slug,
                          e.target.value as Integration["status"],
                          i.config
                        );
                        router.refresh();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Could not update that");
                      }
                    })}
                  >
                    <option value="not_connected">Not connected</option>
                    <option value="connected">Connected</option>
                    <option value="error">Error</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>
                <p className="text-sm text-muted-foreground">{i.powers}</p>
                {i.requires && (
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium">Needs:</span> {i.requires}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  );
}

type NoteTemplate = { id: string; name: string; scope: string; body: string };
type EmailTemplate = { id: string; name: string; audience: string; subject: string; body: string };

export function TemplateSettings({
  notes, emails,
}: {
  notes: NoteTemplate[];
  emails: EmailTemplate[];
}) {
  const router = useRouter();
  const [noteName, setNoteName] = useState("");
  const [emailName, setEmailName] = useState("");
  const [pasting, setPasting] = useState(false);
  const [paste, setPaste] = useState("");
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const [, start] = useTransition();

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Note templates">
        {notes.length === 0 ? <Empty>None</Empty> : (
          <ul className="divide-y text-sm">
            {notes.map((t) => (
              <li key={t.id} className="group flex items-center gap-2 px-4 py-2">
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                <Chip>{t.scope}</Chip>
                <button type="button" aria-label="Remove"
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => start(async () => {
                    await deleteTemplate("note", t.id);
                    router.refresh();
                  })}
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-600" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2 border-t px-4 py-3">
          <input className={`flex-1 px-2 py-1.5 text-sm ${FIELD}`} placeholder="Name"
            value={noteName} onChange={(e) => setNoteName(e.target.value)} />
          <Button size="sm" disabled={!noteName.trim()}
            onClick={() => start(async () => {
              await saveNoteTemplate({ name: noteName });
              setNoteName(""); router.refresh();
            })}
          >Add</Button>
        </div>
      </Panel>

      <Panel title="Email templates">
        {emails.length === 0 ? <Empty>None</Empty> : (
          <ul className="divide-y text-sm">
            {emails.map((t) => (
              <li key={t.id} className="group flex items-center gap-2 px-4 py-2">
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                <Chip>{t.audience}</Chip>
                <button type="button" aria-label="Remove"
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => start(async () => {
                    await deleteTemplate("email", t.id);
                    router.refresh();
                  })}
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-600" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2 border-t px-4 py-3">
          <input className={`flex-1 px-2 py-1.5 text-sm ${FIELD}`} placeholder="Name"
            value={emailName} onChange={(e) => setEmailName(e.target.value)} />
          <Button size="sm" disabled={!emailName.trim()}
            onClick={() => start(async () => {
              await saveEmailTemplate({ name: emailName });
              setEmailName(""); router.refresh();
            })}
          >Add</Button>
        </div>

        <div className="space-y-2 border-t px-4 py-3">
          {!pasting ? (
            <Button size="sm" variant="outline" onClick={() => setPasting(true)}>
              Paste several
            </Button>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Name on the first line, <code>Subject:</code> on the second, body under it.
                Separate each with <code>---</code>.
              </p>
              <textarea
                className={`${input} min-h-48 font-mono text-xs`}
                value={paste}
                placeholder={"Interview invite\nSubject: Next step at {{company}}\nHi {{first_name}},\n\n...\n---\nRejection\nSubject: Update on your application\n..."}
                onChange={(e) => setPaste(e.target.value)}
              />
              <div className="flex items-center gap-2">
                <Button size="sm" disabled={!paste.trim()}
                  onClick={() => start(async () => {
                    const res = await bulkCreateEmailTemplates(paste);
                    setPasteNote(`${res.added} of ${res.found} added`);
                    setPaste("");
                    router.refresh();
                  })}
                >Import</Button>
                <Button size="sm" variant="ghost" onClick={() => setPasting(false)}>Cancel</Button>
                {pasteNote && <span className="text-sm text-muted-foreground">{pasteNote}</span>}
              </div>
            </>
          )}
        </div>
      </Panel>
    </div>
  );
}

type ActType = {
  id: string; name: string; slug: string; category: string;
  counts_as_progression: boolean; color: string; active: boolean;
};

/** Which logged actions count towards somebody's activity numbers. */
export function ActivityTypeSettings({ types }: { types: ActType[] }) {
  const router = useRouter();
  const [, start] = useTransition();

  return (
    <Panel title="Activity types">
      <ul className="divide-y text-sm">
        {types.map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-4 py-2">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", TONE[t.color]?.dot ?? TONE.slate.dot)} />
            <span className="min-w-0 flex-1 truncate">{t.name}</span>
            <Chip>{t.category}</Chip>
            <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={t.counts_as_progression}
                onChange={(e) => start(async () => {
                  await saveActivityType({
                    id: t.id, name: t.name, category: t.category,
                    color: t.color, active: t.active,
                    counts_as_progression: e.target.checked,
                  });
                  router.refresh();
                })}
              />
              counts
            </label>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

type MailConfig = {
  mail_accounts: string[];
  mail_sync_days: number;
  mail_last_sync_at: string | null;
  mail_last_sync_note: string | null;
};

/**
 * Which mailboxes the candidate timelines are built from.
 *
 * Empty by default and it stays empty until somebody types an address in.
 * Google's domain-wide delegation will hand this app a token for anyone in the
 * domain, so this list is the only thing standing between "reads the
 * recruiters' mail" and "reads everyone's mail" -- which is why it is a
 * deliberate list rather than "everyone with the recruit permission".
 */
export function MailSettings({
  config, gmailConnected,
}: {
  config: MailConfig;
  gmailConnected: boolean;
}) {
  const router = useRouter();
  const [accounts, setAccounts] = useState(config.mail_accounts.join("\n"));
  const [days, setDays] = useState(config.mail_sync_days);
  const [reports, setReports] = useState<
    { account: string; matching: number; attached: number; alreadyHad: number; problem: string | null }[]
  >([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const list = accounts.split(/[\n,;]/).map((a) => a.trim()).filter(Boolean);

  return (
    <div className="space-y-4">
      {!gmailConnected && (
        <div className="rounded-lg border border-dashed bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground">
            Mark Gmail connected under Integrations before syncing.
          </p>
        </div>
      )}

      <Panel title="Mailboxes read">
        <div className="space-y-3 px-4 py-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              One Factur address per line
            </span>
            <textarea
              className={`${input} min-h-28 font-mono`}
              value={accounts}
              placeholder="recruiter@facturmfg.com"
              onChange={(e) => setAccounts(e.target.value)}
            />
          </label>

          <label className="block max-w-40">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Days back</span>
            <input
              className={input}
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </label>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() => start(async () => {
                setError(null);
                try {
                  await saveMailAccounts(list, days);
                  setNote("Saved");
                  router.refresh();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Could not save that");
                }
              })}
            >
              Save
            </Button>

            <Button
              size="sm"
              variant="outline"
              disabled={pending || !list.length || !gmailConnected}
              onClick={() => start(async () => {
                setError(null);
                setReports([]);
                try {
                  const res = await syncMailNow();
                  setReports(res.reports);
                  setNote(
                    res.repliesStopped
                      ? `${res.repliesStopped} campaign${res.repliesStopped === 1 ? "" : "s"} stopped on a reply`
                      : "Sync finished"
                  );
                  router.refresh();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Sync failed");
                }
              })}
            >
              {pending ? "Syncing…" : "Sync now"}
            </Button>

            {note && <span className="text-sm text-muted-foreground">{note}</span>}
          </div>

          {config.mail_last_sync_at && (
            <p className="text-xs text-muted-foreground">
              Last run {new Date(config.mail_last_sync_at).toLocaleString("en-US")}
              {config.mail_last_sync_note ? ` · ${config.mail_last_sync_note}` : ""}
            </p>
          )}
        </div>
      </Panel>

      {reports.length > 0 && (
        <Panel title="Last run">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Mailbox</th>
                <th className="px-4 py-2 text-right font-medium">Matched search</th>
                <th className="px-4 py-2 text-right font-medium">Attached</th>
                <th className="px-4 py-2 text-right font-medium">Already had</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {reports.map((r) => (
                <tr key={r.account}>
                  <td className="px-4 py-2">
                    {r.account}
                    {r.problem && (
                      <p className="text-xs text-red-600 dark:text-red-400">{r.problem}</p>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{r.matching}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.attached}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{r.alreadyHad}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
