import { redirect } from "next/navigation";

/**
 * Team Progress used to have two pages: this one, showing only your direct
 * reports, and an admin-only one showing everyone. Progress is open to the
 * whole company now, so there is one page and this is a link to it.
 */
export default function ManagerRedirect() {
  redirect("/progress");
}
