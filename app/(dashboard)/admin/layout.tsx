import { myPermissions } from "@/lib/org";
import { NoAccess } from "@/components/no-access";

/**
 * Guards every /admin page. This was in middleware, where it cost two database
 * round trips on every request in the app and timed the site out; here it runs
 * once, only for the pages it protects.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const perms = await myPermissions();
  if (!perms.has("lms.admin") && !perms.has("org.manage")) {
    // Says what happened, rather than bouncing to /learner and leaving the
    // person to guess why the page they clicked turned into a different one.
    return <NoAccess section="Training administration" need="Administer training" />;
  }
  return <>{children}</>;
}
