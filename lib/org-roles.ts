/**
 * Shared by the server actions and the screens, so "which roles are a job?" is
 * answered the same way in both. It lives apart from lib/org.ts because that
 * module reaches for the database, and the People table is a client component.
 *
 * Manager, App Administrator and Beta Tester describe what someone may *see*,
 * not what they *do*. They sit beside the job role as their own checkboxes.
 * Every other role defined in Settings is a job -- whether or not it belongs
 * to a service.
 *
 * Beta Tester carries whatever is being tried out before it goes to everyone.
 * Its permissions are set in Settings > Roles like any other role; listing it
 * here is what keeps it out of the job-role picker and off the self-service
 * panel, so nobody can give it to themselves.
 */
export const STANDALONE_ROLE_SLUGS = ["manager", "app-admin", "beta-tester"] as const;

export type StandaloneRoleSlug = (typeof STANDALONE_ROLE_SLUGS)[number];

export function isStandaloneRole(slug: string): slug is StandaloneRoleSlug {
  return (STANDALONE_ROLE_SLUGS as readonly string[]).includes(slug);
}

export function isJobRole(role: { slug: string }): boolean {
  return !isStandaloneRole(role.slug);
}
