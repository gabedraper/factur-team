/**
 * Shared by the server actions and the screens, so "which roles are a job?" is
 * answered the same way in both. It lives apart from lib/org.ts because that
 * module reaches for the database, and the People table is a client component.
 *
 * Manager and App Administrator describe what someone may *see*, not what they
 * *do*. They sit beside the job role as their own checkboxes. Every other role
 * defined in Settings is a job -- whether or not it belongs to a service.
 */
export const STANDALONE_ROLE_SLUGS = ["manager", "app-admin"] as const;

export type StandaloneRoleSlug = (typeof STANDALONE_ROLE_SLUGS)[number];

export function isStandaloneRole(slug: string): slug is StandaloneRoleSlug {
  return (STANDALONE_ROLE_SLUGS as readonly string[]).includes(slug);
}

export function isJobRole(role: { slug: string }): boolean {
  return !isStandaloneRole(role.slug);
}
