import { redirect } from "next/navigation";
import { myPermissions } from "@/lib/org";

/**
 * Guards every /admin page. This was in middleware, where it cost two database
 * round trips on every request in the app and timed the site out; here it runs
 * once, only for the pages it protects.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const perms = await myPermissions();
  if (!perms.has("lms.admin") && !perms.has("org.manage")) {
    redirect("/learner");
  }
  return <>{children}</>;
}
