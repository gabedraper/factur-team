import { redirect } from "next/navigation";
import { myPermissions } from "@/lib/org";

/**
 * What the viewer may do in the talent system.
 *
 * Read through `myPermissions()` rather than by asking the database directly,
 * because that one honours the role-preview cookie -- previewing a recruiter
 * has to actually narrow the screens or it is not a preview. The policies on
 * the tables are the real guard; this decides what to draw.
 */
export type TalentAccess = { view: boolean; recruit: boolean; admin: boolean };

export async function talentAccess(): Promise<TalentAccess> {
  const perms = await myPermissions();
  const admin = perms.has("talent.admin") || perms.has("org.manage");
  const recruit = admin || perms.has("talent.recruit");
  const view = recruit || perms.has("talent.view");
  return { view, recruit, admin };
}

/**
 * For pages. Sends somebody without the right home rather than showing them an
 * error, which is the app's habit everywhere else.
 */
export async function requireTalent(level: keyof TalentAccess = "view"): Promise<TalentAccess> {
  const access = await talentAccess();
  if (!access[level]) redirect("/");
  return access;
}

/** For server actions, where a redirect would be swallowed. */
export async function assertTalent(level: keyof TalentAccess = "recruit") {
  const access = await talentAccess();
  if (!access[level]) throw new Error(`Forbidden: talent.${level === "view" ? "view" : level} required`);
  return access;
}
