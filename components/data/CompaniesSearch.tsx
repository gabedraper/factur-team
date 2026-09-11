"use client";

import { useEffect, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Panel, Empty, AlphaFilter } from "@/components/pipeline/bits";
import { searchCrmAccounts, type AccountMatch } from "@/actions/pipeline";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

export function CompaniesSearch() {
  const [query, setQuery] = useState("");
  const [letter, setLetter] = useState<string | null>(null);
  const [results, setResults] = useState<AccountMatch[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [searching, start] = useTransition();

  function run(q: string, l: string | null) {
    start(async () => {
      const { results, total } = await searchCrmAccounts(q, l);
      setResults(results);
      setTotal(total);
    });
  }

  useEffect(() => { run("", null); }, []);

  return (
    <div className="space-y-3">
      <Input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setLetter(null); run(e.target.value, null); }}
        placeholder="Search companies by name or domain…"
        className="max-w-sm"
      />
      <AlphaFilter active={letter} onSelect={(l) => { setLetter(l); setQuery(""); run("", l); }} />
      {total !== null && !searching && (
        <p className="text-xs text-muted-foreground">{total} {total === 1 ? "company" : "companies"} match</p>
      )}
      <Panel>
        {results.length === 0 ? (
          <Empty>{searching ? "Searching…" : "No companies match."}</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Company</TH>
                <TH>Domain</TH>
                <TH>Industry</TH>
                <TH>Location</TH>
              </TR>
            </THead>
            <TBody>
              {results.map((r) => (
                <TR key={r.id} >
                  <TD className="font-medium">{r.name}</TD>
                  <TD className="text-muted-foreground">{r.domain ?? "—"}</TD>
                  <TD className="text-muted-foreground">{r.industry ?? "—"}</TD>
                  <TD className="text-muted-foreground">{[r.city, r.state].filter(Boolean).join(", ") || "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
