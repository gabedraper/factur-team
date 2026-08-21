import { redirect } from "next/navigation";

/**
 * People and their roles are managed in one place now -- Settings -> People,
 * against the roles defined in Settings. This screen had its own vocabulary of
 * admin/manager/instructor/learner, which was the second source of truth the
 * org model exists to remove.
 */
export default function AdminUsersPage() {
  redirect("/settings/people");
}
