"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setDealStage } from "@/actions/talent-jobs";
import { Empty } from "@/components/talent/bits";
import { money, onDay } from "@/lib/talent/format";
import { DEAL_STAGE } from "@/lib/talent/types";
import { cn } from "@/lib/utils";

type Deal = {
  id: string; name: string; stage: string; value: number | null;
  probability: number | null; expected_close_on: string | null;
  tal_companies: { id: string; name: string } | null;
  org_members: { full_name: string | null } | null;
};

const ORDER = ["new", "qualifying", "proposal", "negotiation", "won", "lost"] as const;
const TONE: Record<string, string> = {
  new: "border-slate-300", qualifying: "border-sky-300", proposal: "border-indigo-300",
  negotiation: "border-amber-300", won: "border-emerald-300", lost: "border-rose-300",
};

/** The business-development pipeline, dragged the same way the candidate board is. */
export function DealsBoard({ deals, canEdit }: { deals: Deal[]; canEdit: boolean }) {
  const router = useRouter();
  const [board, setBoard] = useState(deals);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  function drop(stage: string) {
    setOver(null);
    const id = dragging;
    setDragging(null);
    if (!id) return;
    const before = board;
    if (board.find((d) => d.id === id)?.stage === stage) return;

    setBoard((rows) => rows.map((d) => (d.id === id ? { ...d, stage } : d)));
    setError(null);
    start(async () => {
      const result = await setDealStage(id, stage);
      if (!result.ok) {
        setBoard(before);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (!board.length) return <Empty>No deals</Empty>;

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex gap-3 overflow-x-auto pb-4">
        {ORDER.map((stage) => {
          const cards = board.filter((d) => d.stage === stage);
          const total = cards.reduce((s, d) => s + (d.value ?? 0), 0);
          return (
            <div
              key={stage}
              onDragOver={(e) => { if (canEdit) { e.preventDefault(); setOver(stage); } }}
              onDragLeave={() => setOver((s) => (s === stage ? null : s))}
              onDrop={() => canEdit && drop(stage)}
              className={cn(
                "flex w-64 shrink-0 flex-col rounded-lg border bg-muted/30",
                over === stage && "border-primary bg-primary/5"
              )}
            >
              <header className="flex items-center gap-2 border-b px-3 py-2">
                <span className="text-sm font-medium">{DEAL_STAGE[stage]}</span>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {cards.length} · {money(total)}
                </span>
              </header>
              <div className="flex-1 space-y-2 p-2">
                {cards.map((d) => (
                  <article
                    key={d.id}
                    draggable={canEdit}
                    onDragStart={() => setDragging(d.id)}
                    onDragEnd={() => { setDragging(null); setOver(null); }}
                    className={cn(
                      "rounded-md border-l-4 border bg-card p-2.5 text-sm shadow-sm",
                      TONE[stage],
                      canEdit && "cursor-grab active:cursor-grabbing",
                      dragging === d.id && "opacity-40"
                    )}
                  >
                    <p className="truncate font-medium">{d.name}</p>
                    {d.tal_companies && (
                      <Link
                        href={`/talent/companies/${d.tal_companies.id}`}
                        className="block truncate text-xs text-muted-foreground hover:underline"
                      >
                        {d.tal_companies.name}
                      </Link>
                    )}
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="tabular-nums">{money(d.value)}</span>
                      {d.probability != null && <span className="tabular-nums">{d.probability}%</span>}
                      <span className="ml-auto">{onDay(d.expected_close_on)}</span>
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
