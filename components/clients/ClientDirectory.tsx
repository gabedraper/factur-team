"use client";

import { useState } from "react";
import Link from "next/link";
import { Table, TableScroll, THead, TBody, TR, TH, TD, TDIdentity } from "@/components/ui/table";
import { Surface } from "@/components/ui/surface";
import { CompanyLogo } from "@/components/ui/thumbnail";
import { BulkBar, BulkAction, SelectAllBox } from "@/components/list/BulkBar";
import { SortHeader, useSort } from "@/components/ui/sortable";
import { ViewTools, type ViewEditorSetup } from "@/components/list/ViewEditor";
import { AddToSequence } from "@/components/clients/AddToSequence";
import { SendEmail } from "@/components/clients/SendEmail";
import {
  CLIENT_FIELDS, CLIENT_FIELD_BY_KEY, DEFAULT_CLIENT_COLUMNS,
  type ClientField, type ClientRecord,
} from "@/lib/list-views/clients";
import { saveClientView, deleteClientView } from "@/actions/client-views";
import type { ListView } from "@/lib/list-views/fields";

/*
 * The clients table: whichever columns the view asks for, over rows the page
 * has already filtered.
 *
 * Columns arrive as keys rather than as field objects because a field carries a
 * read function and a function cannot cross from a server component to a client
 * one. The catalogue is imported here instead and the keys looked up in it,
 * which has the pleasant side effect that a saved view naming a column that has
 * since been removed simply loses that column.
 *
 * Sorting is click-to-sort over rows already in memory, seeded from the view's
 * own sort. That is the house pattern for a list that loads in full, and it is
 * what lets somebody re-sort a shared view without editing it.
 */

const money = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});

function onDay(value: string) {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    day: "numeric", month: "short", year: "numeric",
  });
}

/** What a cell shows. Blank where there is nothing, never a dash in a wide table. */
function cellText(field: ClientField, row: ClientRecord): string {
  const v = field.read(row);
  if (v === null || v === undefined || v === "") return "";
  if (field.render === "money") return money.format(Number(v));
  if (field.render === "date") return onDay(String(v));
  return String(v);
}

export function ClientDirectory({
  rows,
  columnKeys,
  sortField,
  sortDir,
  currentView,
  canShare,
  canEnrol,
  picklists,
  afterDeleteHref,
}: {
  rows: ClientRecord[];
  columnKeys: string[];
  sortField: string | null;
  sortDir: "asc" | "desc";
  /** The saved view on screen, when there is one. */
  currentView: ListView | null;
  canShare: boolean;
  /** Whether this person may put clients onto a sequence. */
  canEnrol: boolean;
  picklists: Record<string, string[]>;
  afterDeleteHref: string;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [addingToSequence, setAddingToSequence] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);

  const columns = columnKeys
    .map((k) => CLIENT_FIELD_BY_KEY.get(k))
    .filter((f): f is ClientField => Boolean(f));
  const shown = columns.length > 0 ? columns : [CLIENT_FIELD_BY_KEY.get("name")!];

  /* Every column is sortable by whatever it reads, so a column added to a view
     is sortable the moment it appears. */
  const readers = Object.fromEntries(CLIENT_FIELDS.map((f) => [f.key, f.read]));
  const { sorted, sortProps } = useSort<ClientRecord, string>(
    rows,
    readers,
    sortField ? { key: sortField, dir: sortDir } : { key: "name", dir: "asc" },
  );

  const all = sorted.length > 0 && selected.length === sorted.length;
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const setup: ViewEditorSetup = {
    fields: CLIENT_FIELDS.map(({ key, label, type, picklist }) => ({ key, label, type, picklist })),
    picklists,
    defaultColumns: DEFAULT_CLIENT_COLUMNS,
    unfilteredNote: "Every client you can see.",
    canShare,
    save: saveClientView,
    remove: deleteClientView,
    afterDeleteHref,
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-meta text-muted-foreground tabular-nums">
          {rows.length} client{rows.length === 1 ? "" : "s"}
          <span className="ml-2">
            {shown.length} column{shown.length === 1 ? "" : "s"}
          </span>
        </p>
        <span className="ml-auto flex items-center gap-1">
          <ViewTools current={currentView} setup={setup} />
        </span>
      </div>

      <BulkBar count={selected.length} noun="client" onClear={() => setSelected([])}>
        {canEnrol && (
          <>
            <BulkAction onClick={() => setAddingToSequence(true)}>Add to sequence</BulkAction>
            <BulkAction onClick={() => setSendingEmail(true)}>Send an email</BulkAction>
          </>
        )}
      </BulkBar>

      {addingToSequence && (
        <AddToSequence
          clientIds={selected}
          onClose={() => setAddingToSequence(false)}
          onDone={() => setSelected([])}
        />
      )}

      {sendingEmail && (
        <SendEmail
          clientIds={selected}
          onClose={() => setSendingEmail(false)}
          onDone={() => setSelected([])}
        />
      )}

      <Surface pad="none">
        <TableScroll>
          <Table>
            <THead>
              <TR>
                <TH className="w-8">
                  <SelectAllBox
                    checked={all}
                    indeterminate={selected.length > 0 && !all}
                    onChange={(on) => setSelected(on ? sorted.map((r) => r.id) : [])}
                  />
                </TH>
                {shown.map((f) => (
                  <TH key={f.key} numeric={f.numeric}>
                    <SortHeader align={f.numeric ? "right" : "left"} {...sortProps(f.key)}>
                      {f.label}
                    </SortHeader>
                  </TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {sorted.map((r) => (
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
                  {shown.map((f) =>
                    f.render === "identity" ? (
                      <TDIdentity
                        key={f.key}
                        thumb={<CompanyLogo name={r.name} domain={r.domain} size={24} />}
                        /* A real link, so middle-click and cmd-click open the
                           client the way every other link on the web does. */
                        name={
                          <Link href={`/clients/${r.id}`} className="hover:underline underline-offset-2">
                            {r.name}
                          </Link>
                        }
                        sub={r.domain ?? undefined}
                      />
                    ) : (
                      <TD key={f.key} numeric={f.numeric} className="text-muted-foreground">
                        {cellText(f, r)}
                      </TD>
                    ),
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        </TableScroll>
      </Surface>
    </div>
  );
}
