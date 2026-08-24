import type { RoleDrift } from "@/lib/org";
import Link from "next/link";

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
    <div className="overflow-x-auto rounded-md border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">Client</th>
            <th className="px-3 py-2 font-medium">Role</th>
            <th className="px-3 py-2 font-medium">In the app</th>
            <th className="px-3 py-2 font-medium">In Salesforce</th>
            <th className="px-3 py-2 font-medium">Why it&apos;s listed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.client_id}-${r.role_label}`} className="border-b last:border-0">
              <td className="px-3 py-2">
                <Link href={`/settings/clients/${r.client_id}`} className="font-medium hover:underline">
                  {r.client_name}
                </Link>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{r.role_label}</td>
              <td className="px-3 py-2">{r.in_app ?? <span className="text-muted-foreground">— none —</span>}</td>
              <td className="px-3 py-2">{r.in_salesforce}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{r.kind}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
