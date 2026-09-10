"use client";

import { useState } from "react";
import { ViewSwitcher } from "@/components/list/ViewSwitcher";
import { BulkBar, BulkAction, SelectAllBox } from "@/components/list/BulkBar";
import { Table, TableScroll, THead, TBody, TR, TH, TD, TDIdentity } from "@/components/ui/table";
import { Surface } from "@/components/ui/surface";
import { CompanyLogo } from "@/components/ui/thumbnail";
import type { ResolvedView } from "@/lib/list-views/catalogue";

/*
 * The interactive half of the reference page. Kept client-side and fed made-up
 * data, so the page shows how the pieces behave without depending on whatever
 * happens to be in the database today.
 */

const ROWS = [
  { id: "1", name: "Acme Industrial", domain: "acme-industrial.com", stage: "Quote sent", value: 48210 },
  { id: "2", name: "Northside Machine", domain: "northside-machine.com", stage: "Prospecting", value: 12400 },
  { id: "3", name: "Volk Corp", domain: "volk-corp.com", stage: "Closed won", value: 96500 },
  { id: "4", name: "Girotti Machine", domain: "girotti-machine.com", stage: "Lead generated", value: 7300 },
];

const view = (key: string, label: string, params: Record<string, string>, pinned: boolean): ResolvedView => ({
  key, label, params, pinned, kind: key.startsWith("scoped") ? "scoped" : "system",
  hidden: false, position: 0,
});

export function ListDemo() {
  const [selected, setSelected] = useState<string[]>([]);
  const allOn = selected.length === ROWS.length;

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="space-y-3">
      <ViewSwitcher
        entity="accounts"
        pinned={[
          view("system:mine", "My target companies", { scope: "mine" }, true),
          view("system:team", "My team's target companies", { scope: "team" }, true),
        ]}
        rest={[
          view("scoped:client:a", "Acme Industrial", { client: "a" }, false),
          view("scoped:client:b", "Northside Machine", { client: "b" }, false),
          view("scoped:client:c", "Volk Corp", { client: "c" }, false),
          view("scoped:client:d", "Girotti Machine", { client: "d" }, false),
        ]}
        canSave
        onSave={() => {}}
      />

      <BulkBar count={selected.length} noun="company" onClear={() => setSelected([])}>
        <BulkAction onClick={() => {}}>Add to sequence</BulkAction>
        <BulkAction onClick={() => {}}>Add to list</BulkAction>
        <BulkAction onClick={() => {}}>Export</BulkAction>
        <BulkAction danger onClick={() => {}}>Delete</BulkAction>
      </BulkBar>

      <Surface pad="none">
        <TableScroll>
          <Table>
            <THead>
              <TR>
                <TH className="w-8">
                  <SelectAllBox
                    checked={allOn}
                    indeterminate={selected.length > 0 && !allOn}
                    onChange={(on) => setSelected(on ? ROWS.map((r) => r.id) : [])}
                  />
                </TH>
                <TH>Company</TH>
                <TH>Stage</TH>
                <TH numeric>Value</TH>
              </TR>
            </THead>
            <TBody>
              {ROWS.map((r) => (
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
                  {/* Companies carry a logo; people lists do not. */}
                  <TDIdentity
                    thumb={<CompanyLogo name={r.name} domain={r.domain} size={24} />}
                    name={r.name}
                    sub={r.domain}
                  />
                  <TD className="text-muted-foreground">{r.stage}</TD>
                  <TD numeric>${r.value.toLocaleString("en-US")}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableScroll>
      </Surface>
    </div>
  );
}
