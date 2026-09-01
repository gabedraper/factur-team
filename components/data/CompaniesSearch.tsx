"use client";

import { useEffect, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Panel, Empty } from "@/components/pipeline/bits";
import { searchCrmAccounts, type AccountMatch } from "@/actions/pipeline";

export function CompaniesSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AccountMatch[]>([]);
  const [searching, start] = useTransition();

  function run(q: string) {
    start(async () => setResults(await searchCrmAccounts(q)));
  }

  useEffect(() => { run(""); }, []);

  return (
    <div className="space-y-3">
      <Input
        value={query}
        onChange={(e) => { setQuery(e.target.value); run(e.target.value); }}
        placeholder="Search companies by name or domain…"
        className="max-w-sm"
      />
      <Panel>
        {results.length === 0 ? (
          <Empty>{searching ? "Searching…" : "No companies match."}</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 font-medium">Domain</th>
                <th className="px-4 py-2 font-medium">Industry</th>
                <th className="px-4 py-2 font-medium">Location</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {results.map((r) => (
                <tr key={r.id} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5 font-medium">{r.name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{r.domain ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{r.industry ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{[r.city, r.state].filter(Boolean).join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
