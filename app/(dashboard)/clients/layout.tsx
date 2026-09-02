import { myPermissions } from "@/lib/org";
import { NoAccess } from "@/components/no-access";

/*
 * The gate for the section, not for any page in it.
 *
 * Health and Results are separate grants -- one is the operational view of live
 * accounts, the other the historical record of every client that ever was -- so
 * this only asks whether someone belongs in the section at all. Each page
 * checks its own permission, or holding either would open both.
 */
export default async function ClientsLayout({ children }: { children: React.ReactNode }) {
  const perms = await myPermissions();
  const mayEnter =
    perms.has("clients.health") || perms.has("clients.results") || perms.has("org.manage");
  if (!mayEnter) {
    return <NoAccess section="Clients" need="View client health or client results" />;
  }
  return <>{children}</>;
}
