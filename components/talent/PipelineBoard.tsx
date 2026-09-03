"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GripVertical, Mail, Phone } from "lucide-react";
import { moveCandidate, rateCandidate, setCandidateStatus } from "@/actions/talent-jobs";
import { Avatar, Chip, Stars } from "@/components/talent/bits";
import { tone } from "@/lib/talent/types";
import type { PipelineRow, WorkflowStage } from "@/lib/talent/types";
import { cn } from "@/lib/utils";

/**
 * The board a search is worked on: one column per stage, candidates dragged
 * between them.
 *
 * The move is applied to the local copy first and the server call follows, so
 * a card lands where it was dropped instead of snapping back for half a second.
 * If the call fails the card returns to where it was and the reason is shown --
 * silently reverting would look like the drag simply did not take.
 */
export function PipelineBoard({
  jobId, stages, candidates, canEdit,
}: {
  jobId: string;
  stages: WorkflowStage[];
  candidates: PipelineRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [board, setBoard] = useState(candidates);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  const byStage = (stageId: string) =>
    board
      .filter((c) => c.stage_id === stageId)
      .sort((a, b) => Number(b.days_in_stage) - Number(a.days_in_stage));

  const unstaged = board.filter((c) => !c.stage_id);

  function drop(stageId: string) {
    setOver(null);
    const id = dragging;
    setDragging(null);
    if (!id) return;

    const card = board.find((c) => c.candidate_id === id);
    if (!card || card.stage_id === stageId) return;

    const stage = stages.find((s) => s.id === stageId);
    const before = board;
    setBoard((rows) =>
      rows.map((c) =>
        c.candidate_id === id
          ? {
              ...c,
              stage_id: stageId,
              stage_name: stage?.name ?? null,
              stage_kind: stage?.kind ?? null,
              stage_color: stage?.color ?? null,
              days_in_stage: 0,
              stage_changed_at: new Date().toISOString(),
              status:
                stage?.kind === "placed" ? "hired" :
                stage?.kind === "rejected" ? "rejected" : "active",
            }
          : c
      )
    );

    setError(null);
    start(async () => {
      const result = await moveCandidate(id, stageId);
      if (!result.ok) {
        setBoard(before);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function rate(candidateId: string, value: number | null) {
    setBoard((rows) =>
      rows.map((c) => (c.candidate_id === candidateId ? { ...c, rating: value } : c)));
    start(async () => {
      try {
        await rateCandidate(candidateId, value, jobId);
      } catch {
        router.refresh();
      }
    });
  }

  function reject(candidateId: string) {
    const before = board;
    setBoard((rows) =>
      rows.map((c) => (c.candidate_id === candidateId ? { ...c, status: "rejected" } : c)));
    start(async () => {
      const result = await setCandidateStatus(candidateId, "rejected");
      if (!result.ok) {
        setBoard(before);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      {unstaged.length > 0 && (
        <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          {unstaged.length} not in a stage
        </div>
      )}

      <div className="flex gap-3 overflow-x-auto pb-4">
        {stages.map((stage) => {
          const cards = byStage(stage.id);
          return (
            <div
              key={stage.id}
              onDragOver={(e) => {
                if (!canEdit) return;
                e.preventDefault();
                setOver(stage.id);
              }}
              onDragLeave={() => setOver((s) => (s === stage.id ? null : s))}
              onDrop={() => canEdit && drop(stage.id)}
              className={cn(
                "flex w-72 shrink-0 flex-col rounded-lg border bg-muted/30 transition-colors",
                over === stage.id && "border-primary bg-primary/5"
              )}
            >
              <header className="flex items-center gap-2 border-b px-3 py-2">
                <span className={cn("h-2 w-2 rounded-full", tone(stage.color).dot)} />
                <span className="truncate text-sm font-medium">{stage.name}</span>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {cards.length}
                </span>
              </header>

              <div className="flex-1 space-y-2 p-2">
                {cards.map((c) => (
                  <article
                    key={c.candidate_id}
                    draggable={canEdit}
                    onDragStart={() => setDragging(c.candidate_id)}
                    onDragEnd={() => { setDragging(null); setOver(null); }}
                    className={cn(
                      "group rounded-md border bg-card p-2.5 text-sm shadow-sm",
                      canEdit && "cursor-grab active:cursor-grabbing",
                      dragging === c.candidate_id && "opacity-40",
                      c.status === "rejected" && "opacity-60"
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {canEdit && (
                        <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                      )}
                      <Avatar name={c.person_name} size={8} />
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/talent/people/${c.person_id}`}
                          className="block truncate font-medium hover:underline"
                        >
                          {c.person_name}
                        </Link>
                        {(c.person_title || c.person_company) && (
                          <p className="truncate text-xs text-muted-foreground">
                            {[c.person_title, c.person_company].filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      <Stars value={c.rating} size={3} onPick={canEdit ? (n) => rate(c.candidate_id, n) : undefined} />
                      <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
                        {c.primary_email && <Mail className="h-3 w-3" aria-label="Has an email address" />}
                        {c.primary_phone && <Phone className="h-3 w-3" aria-label="Has a phone number" />}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <span
                        className={cn(
                          "tabular-nums",
                          c.days_in_stage >= 21 ? "text-red-600 dark:text-red-400"
                            : c.days_in_stage >= 10 ? "text-amber-600 dark:text-amber-400"
                            : "text-muted-foreground"
                        )}
                      >
                        {c.days_in_stage}d
                      </span>
                      {c.status !== "active" && <Chip colour={c.status === "hired" ? "emerald" : "rose"}>{c.status}</Chip>}
                      {canEdit && c.status === "active" && (
                        <button
                          type="button"
                          onClick={() => reject(c.candidate_id)}
                          className="ml-auto text-muted-foreground opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
                        >
                          Reject
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
