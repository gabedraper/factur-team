"use client";

import { useState } from "react";
import Link from "next/link";
import { Table, TableScroll, THead, TBody, TR, TH, TD, TDIdentity } from "@/components/ui/table";
import { Surface } from "@/components/ui/surface";
import { CompanyLogo } from "@/components/ui/thumbnail";
import { BulkBar, BulkAction, SelectAllBox } from "@/components/list/BulkBar";

/**
 * The rows of the clients list, and the selection over them.
 *
 * The reference implementation of the list shell: view chips above (rendered
 * by the page), rows with the company's logo, bulk selection as the way to act
 * on several at once, and the record itself as the way to act on one. There is
 * no Edit button in a row -- clicking the name opens the client, where the
 * actions are.
 */

export type ClientRow = {
  id: string;
  name: string;
  status: string | null;
  domain: string | null;
  manager: string | null;
};

export function ClientsList({ rows }: { rows: ClientRow[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const all = rows.length > 0 && selected.length === rows.length;

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  /*
   * Export is built from rows already on the page rather than a fresh query.
   * It is exactly what was selected, with no second request that could
   * disagree with what the person was looking at.
   */
  const exportCsv = () => {
    const chosen = rows.filter((r) => selected.includes(r.id));
    const cell = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const csv = [
      ["Client", "Status", "Domain", "Account manager"].map(cell).join(","),
      ...chosen.map((r) => [r.name, r.status, r.domain, r.manager].map(cell).join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `clients-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <BulkBar count={selected.length} noun="client" onClear={() => setSelected([])}>
        <BulkAction onClick={exportCsv}>Export</BulkAction>
      </BulkBar>

      <Surface pad="none">
        <TableScroll>
          <Table>
            <THead>
              <TR>
                <TH className="w-8">
                  <SelectAllBox
                    checked={all}
                    indeterminate={selected.length > 0 && !all}
                    onChange={(on) => setSelected(on ? rows.map((r) => r.id) : [])}
                  />
                </TH>
                <TH>Client</TH>
                <TH>Status</TH>
                <TH>Account manager</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id} interactive>
                  <TD>
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.name}`}
                      checked={selected.includes(r.id)}
                      onChange={() => toggle(r.id)}
                      className="h-3.5 w-3.5 cursor-pointer accent-[hsl(var(--primary))]"
                    />
                  </TD>
                  <TDIdentity
                    thumb={<CompanyLogo name={r.name} domain={r.domain} size={24} />}
                    /* A real link, so middle-click and cmd-click open the client
                       in a new tab the way every other link on the web does. */
                    name={
                      <Link href={`/clients/${r.id}`} className="hover:underline underline-offset-2">
                        {r.name}
                      </Link>
                    }
                    sub={r.domain ?? undefined}
                  />
                  <TD className="text-muted-foreground">{r.status ?? "—"}</TD>
                  <TD className="text-muted-foreground">{r.manager ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableScroll>
      </Surface>
    </div>
  );
}
