import { myPermissions } from "@/lib/org";
import { NoAccess } from "@/components/no-access";

/**
 * Guards every /instructor page.
 *
 * There was no guard here at all, unlike /admin: anyone following a link
 * reached the course editor, and the only thing stopping them was the database
 * declining to return the row -- which the editor rendered as a permanent
 * "Loading course...".
 */
export default async function InstructorLayout({ children }: { children: React.ReactNode }) {
  const perms = await myPermissions();
  const allowed =
    perms.has("lms.instruct") || perms.has("lms.admin") || perms.has("org.manage");

  if (!allowed) {
    return <NoAccess section="Course authoring" need="Author training" />;
  }
  return <>{children}</>;
}
