"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import {
  deleteCampaignStep, enrolInCampaign, prepareCampaignSends,
  saveCampaignStep, setCampaignStatus,
} from "@/actions/talent-engage";
import { placeAllCampaignSends } from "@/actions/talent-mail";
import { PersonPicker, type PickedPerson } from "@/components/talent/PersonPicker";
import { Button } from "@/components/ui/button";
import { Chip, Empty, Panel } from "@/components/talent/bits";
import { FIELD } from "@/lib/field-class";
import { CAMPAIGN_CHANNEL, label } from "@/lib/talent/types";

const input = `w-full px-2 py-1.5 text-sm ${FIELD}`;

type Step = {
  id: string; position: number; channel: string; delay_days: number;
  subject: string | null; body: string; active: boolean;
};

/**
 * The steps of an outreach sequence, and who is in it.
 *
 * `delay_days` is measured from the step before, not from enrolment, so
 * inserting a step in the middle does not silently move every later one.
 */
export function CampaignEditor({
  campaignId, status, mode, steps, canEdit, emailConnected, queued,
}: {
  campaignId: string;
  status: string;
  mode: string;
  steps: Step[];
  canEdit: boolean;
  emailConnected: boolean;
  /** Messages prepared and not yet placed in a mailbox. */
  queued: number;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, Partial<Step>>>({});
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const value = (s: Step) => ({ ...s, ...draft[s.id] });

  function persist(s: Step) {
    const v = value(s);
    start(async () => {
      const result = await saveCampaignStep({
        id: s.id, campaign_id: campaignId, position: v.position ?? s.position,
        channel: v.channel, delay_days: v.delay_days, subject: v.subject, body: v.body,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDraft((d) => { const next = { ...d }; delete next[s.id]; return next; });
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {note && <p className="text-sm text-muted-foreground">{note}</p>}

      <Panel
        title="Steps"
        action={canEdit && (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => start(async () => {
              const result = await saveCampaignStep({
                campaign_id: campaignId,
                position: (steps.at(-1)?.position ?? -1) + 1,
                delay_days: steps.length ? 3 : 0,
                body: "",
              });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setAdding(false);
              router.refresh();
            })}
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      >
        {steps.length === 0 ? <Empty>No steps</Empty> : (
          <ul className="divide-y">
            {steps.map((s) => {
              const v = value(s);
              const dirty = !!draft[s.id];
              return (
                <li key={s.id} className="space-y-2 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip>{s.position + 1}</Chip>
                    <select
                      className="rounded-md border bg-background px-2 py-1 text-sm"
                      value={v.channel}
                      disabled={!canEdit}
                      onChange={(e) => setDraft((d) => ({ ...d, [s.id]: { ...d[s.id], channel: e.target.value } }))}
                    >
                      {Object.entries(CAMPAIGN_CHANNEL).map(([k, val]) => (
                        <option key={k} value={k}>{val}</option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1 text-sm text-muted-foreground">
                      <input
                        className={`w-16 px-2 py-1 text-sm ${FIELD}`}
                        type="number"
                        min={0}
                        value={v.delay_days}
                        disabled={!canEdit}
                        onChange={(e) => setDraft((d) => ({ ...d, [s.id]: { ...d[s.id], delay_days: Number(e.target.value) } }))}
                      />
                      days after previous
                    </label>
                    {canEdit && (
                      <button
                        type="button"
                        className="ml-auto"
                        aria-label="Remove step"
                        onClick={() => start(async () => {
                          await deleteCampaignStep(s.id, campaignId);
                          router.refresh();
                        })}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-600" />
                      </button>
                    )}
                  </div>

                  {v.channel === "email" && (
                    <input
                      className={input}
                      placeholder="Subject"
                      value={v.subject ?? ""}
                      disabled={!canEdit}
                      onChange={(e) => setDraft((d) => ({ ...d, [s.id]: { ...d[s.id], subject: e.target.value } }))}
                    />
                  )}
                  <textarea
                    className={`${input} min-h-24`}
                    placeholder="{{first_name}}, …"
                    value={v.body}
                    disabled={!canEdit}
                    onChange={(e) => setDraft((d) => ({ ...d, [s.id]: { ...d[s.id], body: e.target.value } }))}
                  />

                  {dirty && canEdit && (
                    <Button size="sm" onClick={() => persist(s)} disabled={pending}>Save step</Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {canEdit && (
        <Panel title="Enrol">
          <div className="space-y-2 px-4 py-3">
            <PersonPicker
              placeholder="Add someone"
              onPick={(p: PickedPerson) => start(async () => {
                const res = await enrolInCampaign(campaignId, [p.id]);
                setNote(res.enrolled ? `${p.name} enrolled` : `${p.name} skipped`);
                router.refresh();
              })}
            />
          </div>
        </Panel>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={pending || !steps.length}
            onClick={() => start(async () => {
              const n = await prepareCampaignSends(campaignId);
              setNote(`${n} message${n === 1 ? "" : "s"} drafted`);
              router.refresh();
            })}
          >
            Prepare due messages
          </Button>

          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => start(async () => {
              await setCampaignStatus(campaignId, status === "active" ? "paused" : "active");
              router.refresh();
            })}
          >
            {status === "active" ? "Pause" : "Activate"}
          </Button>

          {emailConnected && queued > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => start(async () => {
                const res = await placeAllCampaignSends(campaignId);
                setNote(
                  `${res.placed} ${mode === "full" ? "sent" : "drafted in your Gmail"}` +
                  (res.failed.length ? ` · ${res.failed.length} failed: ${res.failed[0]}` : "")
                );
                router.refresh();
              })}
            >
              {mode === "full" ? `Send ${queued}` : `Draft ${queued} in my Gmail`}
            </Button>
          )}

          {!emailConnected && (
            <span className="text-sm text-muted-foreground">
              Sending needs a mailbox connected · drafts only
            </span>
          )}
          {emailConnected && mode === "semi" && (
            <span className="text-sm text-muted-foreground">
              Semi-automatic · each message lands in your Drafts
            </span>
          )}
        </div>
      )}
    </div>
  );
}
