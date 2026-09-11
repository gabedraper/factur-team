import type { RoleDrift } from "@/lib/org";
import Link from "next/link";
import { Surface } from "@/components/ui/surface";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

/**
 * The app is the source of truth for who covers a client, so this reports
 * rather than reconciles: which side is right is a judgement about who actually
 * works the account, not something to guess at automatically.
 */
export function ClientRoleDrift({ rows }: { rows: RoleDrift[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Every client&apos;s cover matches Salesforce.
      </p>
    );
  }

  return (
    <Surface pad="none" className="overflow-x-auto">
      <Table>
        <THead>
          <TR>
            <TH>Client</TH>
            <TH>Role</TH>
            <TH>In the app</TH>
            <TH>In Salesforce</TH>
            <TH>Why it&apos;s listed</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={`${r.client_id}-${r.role_label}`} >
              <TD>
                <Link href={`/settings/clients/${r.client_id}`} className="font-medium hover:underline">
                  {r.client_name}
                </Link>
              </TD>
              <TD className="text-muted-foreground">{r.role_label}</TD>
              <TD>{r.in_app ?? <span className="text-muted-foreground">— none —</span>}</TD>
              <TD>{r.in_salesforce}</TD>
              <TD className="text-xs text-muted-foreground">{r.kind}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Surface>
  );
}
