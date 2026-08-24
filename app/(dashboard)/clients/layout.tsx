import { myPermissions } from "@/lib/org";
import { NoAccess } from "@/components/no-access";

export default async function ClientsLayout({ children }: { children: React.ReactNode }) {
  const perms = await myPermissions();
  if (!perms.has("clients.health") && !perms.has("org.manage")) {
    return <NoAccess section="Client health" need="View client health" />;
  }
  return <>{children}</>;
}
