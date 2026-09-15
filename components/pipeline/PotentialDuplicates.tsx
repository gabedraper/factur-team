import Link from "next/link";
import { Panel, Empty, Chip } from "@/components/pipeline/bits";
import { progressTone } from "@/lib/pipeline/targets";
import { readsField, type Ladder } from "@/lib/pipeline/ladder";

/*
 * The other opportunities this client has against this contact.
 *
 * Nothing here merges or deletes. Every Salesforce record is a row, and one
 * per (client, contact) group is named the main one by
 * refresh_opportunity_duplicates(): the main record lists the rest, and a
 * record that is not the main one says so and points at it.
 *
 * Client + contact is the association. The owner is the second signal: when
 * an account manager changes, the client and contact stay and a new record
 * appears under the new owner, so "owner changed" is more likely a handover
 * than a mistake. Each row says which, and the person reading decides.
 */

export type Duplicate = {
  id: string;
  name: string;
  stage: string;
  lead_status: string | null;
  is_main: boolean;
  active: boolean;
  owner_member_id: string | null;
  owner_name: string | null;
  owner_active: boolean;
  same_owner: boolean;
  activity_count: number;
  created_at: string;
  updated_at: string;
};

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}

export function PotentialDuplicates({
  rows, isMain, ladder,
}: {
  rows: Duplicate[];
  /** Whether the record on screen is its group's main one. */
  isMain: boolean;
  ladder: Ladder;
}) {
  if (rows.length === 0) return null;
  const main = rows.find((r) => r.is_main) ?? null;
  const title = isMain ? `Potential duplicates (${rows.length})` : "Potential duplicate";

  return (
    <Panel title={title}>
      {!isMain && (
        <p className="border-b px-card py-3 text-body text-muted-foreground">
          This looks like a duplicate of the main record for this contact.{" "}
          {main ? (
            <Link href={`/opportunities/${main.id}`} className="text-primary underline-offset-2 hover:underline">
              Open the main record
            </Link>
          ) : (
            <span>The main record is not one you can see.</span>
          )}
        </p>
      )}
      {rows.length === 0 ? (
        <Empty>No other records for this contact.</Empty>
      ) : (
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.id} className="px-card py-2.5">
              <div className="flex items-center gap-2">
                <Link
                  href={`/opportunities/${r.id}`}
                  className="min-w-0 flex-1 truncate text-body font-medium underline-offset-2 hover:underline"
                >
                  {r.owner_name ?? "No owner"}
                  {r.is_main && <span className="font-normal text-muted-foreground"> · main record</span>}
                </Link>
                {/* Same owner reads as a repeat; a different owner reads as a
                    handover. Neither is a verdict. */}
                <Chip colour={r.same_owner ? "amber" : "blue"}>
                  {r.same_owner ? "Same owner" : "Owner changed"}
                </Chip>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-meta text-muted-foreground">
                {readsField(ladder, "stage") && <Chip colour={progressTone(r.stage)}>{r.stage}</Chip>}
                {readsField(ladder, "lead_status") && r.lead_status && (
                  <Chip colour={progressTone(r.lead_status)}>{r.lead_status}</Chip>
                )}
                {!r.active && <span>finished</span>}
                {!r.owner_active && r.owner_name && <span>owner has left</span>}
                <span className="tabular-nums">
                  {r.activity_count} {r.activity_count === 1 ? "activity" : "activities"}
                </span>
                <span className="ml-auto tabular-nums">
                  opened {shortDate(r.created_at)} · changed {shortDate(r.updated_at)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
