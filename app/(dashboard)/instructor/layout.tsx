import { redirect } from "next/navigation";
import { myPermissions } from "@/lib/org";

/**
 * Guards every /instructor page.
 *
 * There was no guard here at all: any signed-in person who followed a link to a
 * course editor reached it, and the only thing stopping them was the database
 * refusing to hand over the row -- which the page then rendered as a permanent
 * "Loading course...". Refusing here says what actually happened.
 */
export default async function InstructorLayout({ children }: { children: React.ReactNode }) {
  const perms = await myPermissions();
  if (!perms.has("lms.instruct") && !perms.has("lms.admin") && !perms.has("org.manage")) {
    redirect("/unauthorized");
  }
  return <>{children}</>;
}
