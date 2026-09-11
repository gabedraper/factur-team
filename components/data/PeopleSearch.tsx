"use client";

import { useEffect, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { UserPlus } from "lucide-react";
import { Panel, Empty, AlphaFilter } from "@/components/pipeline/bits";
import { NewOpportunityDialog } from "@/components/pipeline/NewOpportunityDialog";
import { searchCrmContacts, type ContactMatch } from "@/actions/pipeline";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

type ClientOption = { id: string; name: string; heldBy: string | null; mine: boolean };

/** Browse-or-search directory over crm_contacts, with a shortcut into creating an opportunity against whoever's found. */
export function PeopleSearch({ clients }: { clients: ClientOption[] }) {
  const [query, setQuery] = useState("");
  const [letter, setLetter] = useState<string | null>(null);
  const [results, setResults] = useState<ContactMatch[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [searching, start] = useTransition();

  function run(q: string, l: string | null) {
    start(async () => {
      const { results, total } = await searchCrmContacts(q, l);
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
        placeholder="Search people by name or email…"
        className="max-w-sm"
      />
      <AlphaFilter active={letter} onSelect={(l) => { setLetter(l); setQuery(""); run("", l); }} />
      {total !== null && !searching && (
        <p className="text-xs text-muted-foreground">{total} {total === 1 ? "person" : "people"} match</p>
      )}
      <Panel>
        {results.length === 0 ? (
          <Empty>{searching ? "Searching…" : "No one matches."}</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Title</TH>
                <TH>Company</TH>
                <TH>Email</TH>
                <TH  />
              </TR>
            </THead>
            <TBody>
              {results.map((r) => (
                <TR key={r.id} >
                  <TD className="font-medium">{[r.first_name, r.last_name].filter(Boolean).join(" ") || "—"}</TD>
                  <TD className="text-muted-foreground">{r.title ?? "—"}</TD>
                  <TD className="text-muted-foreground">{r.account_name ?? "—"}</TD>
                  <TD className="text-muted-foreground">{r.email ?? "—"}</TD>
                  <TD numeric>
                    <NewOpportunityDialog
                      clients={clients}
                      initialContact={r}
                      trigger={<Button size="sm" variant="outline" className="gap-1"><UserPlus className="h-3.5 w-3.5" /> Create opportunity</Button>}
                    />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
