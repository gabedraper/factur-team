"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Check, Plus, Trash2, X } from "lucide-react";
import {
  createService, updateService, deleteService, moveService,
} from "@/actions/org";
import type { ServiceRow } from "@/lib/org";

function Field({
  value, onChange, placeholder, className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`rounded-md border bg-background px-2 py-1 text-sm ${className}`}
    />
  );
}

export function ServicesScreen({ services }: { services: ServiceRow[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", description: "" });
  const [adding, setAdding] = useState(false);
  const [fresh, setFresh] = useState({ name: "", description: "" });

  const run = (fn: () => Promise<{ success: boolean; error?: string }>, done?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.success) done?.();
      else setError(r.error ?? "That did not work.");
    });

  const beginEdit = (s: ServiceRow) => {
    setEditing(s.id);
    setDraft({ name: s.name, description: s.description ?? "" });
  };

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="w-8 px-2 py-2" />
              <th className="px-3 py-2 font-medium">Service</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 font-medium">Clients</th>
              <th className="px-3 py-2 font-medium">Roles</th>
              <th className="px-3 py-2 font-medium">Pods</th>
              <th className="px-3 py-2 font-medium">In dropdown</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {services.map((s, i) => {
              const inUse = s.clients + s.roles + s.pods > 0;
              const isEditing = editing === s.id;
              return (
                <tr key={s.id} className="border-t align-middle">
                  <td className="px-2 py-1.5">
                    <div className="flex flex-col">
                      <button
                        aria-label="Move up"
                        disabled={i === 0 || pending}
                        onClick={() => run(() => moveService(s.id, "up"))}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-25"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        aria-label="Move down"
                        disabled={i === services.length - 1 || pending}
                        onClick={() => run(() => moveService(s.id, "down"))}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-25"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                    </div>
                  </td>

                  {isEditing ? (
                    <>
                      <td className="px-3 py-1.5">
                        <Field
                          value={draft.name}
                          onChange={(v) => setDraft({ ...draft, name: v })}
                          placeholder="Name"
                          className="w-48"
                        />
                      </td>
                      <td className="px-3 py-1.5" colSpan={5}>
                        <Field
                          value={draft.description}
                          onChange={(v) => setDraft({ ...draft, description: v })}
                          placeholder="Description"
                          className="w-full"
                        />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-1.5">
                        <button onClick={() => beginEdit(s)} className="hover:underline">
                          {s.name}
                        </button>
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">{s.description ?? "—"}</td>
                      <td className="px-3 py-1.5 tabular-nums">{s.clients || "—"}</td>
                      <td className="px-3 py-1.5 tabular-nums">{s.roles || "—"}</td>
                      <td className="px-3 py-1.5 tabular-nums">{s.pods || "—"}</td>
                      <td className="px-3 py-1.5">
                        <input
                          type="checkbox"
                          checked={s.active}
                          disabled={pending}
                          onChange={(e) =>
                            run(() => updateService(s.id, { active: e.target.checked }))
                          }
                        />
                      </td>
                    </>
                  )}

                  <td className="px-3 py-1.5">
                    <div className="flex items-center justify-end gap-2">
                      {isEditing ? (
                        <>
                          <button
                            aria-label="Save"
                            disabled={pending}
                            onClick={() =>
                              run(
                                () =>
                                  updateService(s.id, {
                                    name: draft.name,
                                    description: draft.description,
                                  }),
                                () => setEditing(null),
                              )
                            }
                            className="text-emerald-600 hover:text-emerald-500"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            aria-label="Cancel"
                            onClick={() => { setEditing(null); setError(null); }}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </>
                      ) : (
                        <button
                          aria-label="Delete"
                          disabled={pending || inUse}
                          title={inUse ? "In use — turn it off instead" : "Delete"}
                          onClick={() => run(() => deleteService(s.id))}
                          className="text-muted-foreground hover:text-red-500 disabled:opacity-25 disabled:hover:text-muted-foreground"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}

            {adding && (
              <tr className="border-t bg-muted/20">
                <td className="px-2 py-1.5" />
                <td className="px-3 py-1.5">
                  <Field
                    value={fresh.name}
                    onChange={(v) => setFresh({ ...fresh, name: v })}
                    placeholder="Name"
                    className="w-48"
                  />
                </td>
                <td className="px-3 py-1.5" colSpan={5}>
                  <Field
                    value={fresh.description}
                    onChange={(v) => setFresh({ ...fresh, description: v })}
                    placeholder="Description"
                    className="w-full"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      aria-label="Save"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () => createService(fresh.name, fresh.description),
                          () => { setAdding(false); setFresh({ name: "", description: "" }); },
                        )
                      }
                      className="text-emerald-600 hover:text-emerald-500"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      aria-label="Cancel"
                      onClick={() => { setAdding(false); setError(null); }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!adding && (
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
        >
          <Plus className="h-4 w-4" /> Add service
        </button>
      )}
    </div>
  );
}
