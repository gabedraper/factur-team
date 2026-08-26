"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { checkNpsSenders, type Coverage, type SenderCheck } from "@/actions/nps-readiness";

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${warn ? "text-amber-600 dark:text-amber-400" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function ClientList({ title, clients }: { title: string; clients: { id: string; name: string }[] }) {
  if (clients.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">
        {title} <span className="text-muted-foreground">({clients.length})</span>
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {clients.map((c) => (
          <Link
            key={c.id}
            href={`/settings/clients/${c.id}`}
            className="rounded-md border bg-card px-2 py-1 text-xs hover:bg-muted"
          >
            {c.name}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function NpsReadiness({ coverage }: { coverage: Coverage }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] =
    useState<Awaited<ReturnType<typeof checkNpsSenders>> | null>(null);

  function run() {
    startTransition(async () => setResult(await checkNpsSenders()));
  }

  const blocked = result?.senders.filter((s) => !s.ok) ?? [];

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Sending permission
        </h2>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={run}
            disabled={pending}
            className="h-9 rounded-md border px-4 text-sm disabled:opacity-50"
          >
            {pending ? "Checking…" : "Check senders"}
          </button>
          {result?.serviceAccount && (
            <span className="text-xs text-muted-foreground">{result.serviceAccount}</span>
          )}
        </div>

        {result?.problem && (
          <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {result.problem}
          </p>
        )}

        {result && result.senders.length > 0 && (
          <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Sender</th>
                  <th className="px-3 py-2 text-right font-medium">Clients</th>
                  <th className="px-3 py-2 font-medium">Can send as</th>
                </tr>
              </thead>
              <tbody>
                {result.senders.map((s: SenderCheck) => (
                  <tr key={s.email} className="border-b last:border-0 align-top">
                    <td className="px-3 py-2">
                      <div>{s.name ?? s.email}</div>
                      {s.name && (
                        <div className="text-xs text-muted-foreground">{s.email}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.clients}</td>
                    <td className="px-3 py-2">
                      {s.ok ? (
                        <span className="text-emerald-600 dark:text-emerald-400">Yes</span>
                      ) : (
                        <span className="text-red-600 dark:text-red-400">{s.problem}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {result && blocked.length === 0 && result.senders.length > 0 && (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">
            All {result.senders.length} senders cleared.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Coverage
        </h2>

        <div className="grid grid-cols-3 gap-2">
          <Stat label="Active clients" value={String(coverage.activeClients)} />
          <Stat
            label="With a contact"
            value={`${coverage.withContactEmail} / ${coverage.activeClients}`}
            warn={coverage.withContactEmail < coverage.activeClients}
          />
          <Stat
            label="With an owner"
            value={`${coverage.withOwner} / ${coverage.activeClients}`}
            warn={coverage.withOwner < coverage.activeClients}
          />
        </div>

        <ClientList title="No owner" clients={coverage.noOwner} />
        <ClientList title="No contact address" clients={coverage.noContactEmail} />
      </section>
    </div>
  );
}
