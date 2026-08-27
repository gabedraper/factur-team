"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { completeTask, deleteTask, saveTask } from "@/actions/talent-engage";
import { Button } from "@/components/ui/button";
import { Empty, Panel } from "@/components/talent/bits";
import { FIELD } from "@/lib/field-class";
import { onDay } from "@/lib/talent/format";
import type { Member } from "@/lib/talent/types";

type Row = {
  id: string; title: string; notes: string | null; due_at: string | null;
  priority: string; done_at: string | null; assigned_member_id: string | null;
  tal_people: { id: string; name: string } | null;
  tal_jobs: { id: string; title: string } | null;
  tal_companies: { id: string; name: string } | null;
};

/** A flat to-do list. Ticking a box is the only interaction that matters here. */
export function TaskList({
  tasks, members, canEdit, owner, showingDone,
}: {
  tasks: Row[];
  members: Member[];
  canEdit: boolean;
  owner: string;
  showingDone: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [, start] = useTransition();

  function go(next: Record<string, string>) {
    const q = new URLSearchParams({ owner, done: showingDone ? "1" : "", ...next });
    for (const [k, v] of [...q.entries()]) if (!v) q.delete(k);
    router.push(`/talent/tasks?${q}`);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
          value={owner}
          onChange={(e) => go({ owner: e.target.value })}
        >
          <option value="all">Everyone</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={showingDone}
            onChange={(e) => go({ done: e.target.checked ? "1" : "" })}
          />
          Include done
        </label>
        {canEdit && (
          <Button size="sm" className="ml-auto" onClick={() => setAdding((v) => !v)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Task
          </Button>
        )}
      </div>

      <Panel>
        {adding && (
          <div className="flex flex-wrap gap-2 border-b bg-muted/30 px-4 py-3">
            <input
              className={`flex-1 px-2 py-1.5 text-sm ${FIELD}`}
              placeholder="Task"
              value={title}
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
            />
            <input
              className={`px-2 py-1.5 text-sm ${FIELD}`}
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
            <Button
              size="sm"
              disabled={!title.trim()}
              onClick={() => start(async () => {
                await saveTask({ title, due_at: due ? `${due}T09:00:00Z` : null });
                setTitle(""); setDue(""); setAdding(false);
                router.refresh();
              })}
            >
              Add
            </Button>
          </div>
        )}

        {tasks.length === 0 ? <Empty>Nothing to do</Empty> : (
          <ul className="divide-y">
            {tasks.map((t) => {
              const late = !t.done_at && t.due_at && new Date(t.due_at) < new Date();
              return (
                <li key={t.id} className="group flex items-start gap-3 px-4 py-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!t.done_at}
                    disabled={!canEdit}
                    onChange={(e) => start(async () => {
                      await completeTask(t.id, e.target.checked);
                      router.refresh();
                    })}
                  />
                  <div className="min-w-0 flex-1">
                    <p className={t.done_at ? "text-muted-foreground line-through" : ""}>{t.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.tal_people && (
                        <Link href={`/talent/people/${t.tal_people.id}`} className="hover:underline">
                          {t.tal_people.name}
                        </Link>
                      )}
                      {t.tal_people && t.tal_jobs ? " · " : ""}
                      {t.tal_jobs && (
                        <Link href={`/talent/jobs/${t.tal_jobs.id}`} className="hover:underline">
                          {t.tal_jobs.title}
                        </Link>
                      )}
                      {t.notes ? ` · ${t.notes}` : ""}
                    </p>
                  </div>
                  <span className={`shrink-0 text-xs tabular-nums ${late ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                    {onDay(t.due_at)}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label="Remove"
                      onClick={() => start(async () => {
                        await deleteTask(t.id);
                        router.refresh();
                      })}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-600" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
