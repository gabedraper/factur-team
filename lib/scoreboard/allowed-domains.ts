export const ALLOWED_EMAIL_DOMAINS = ["facturmfg.com", "bethefactur.com"];

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const domain = email.split("@")[1]?.toLowerCase();
  return ALLOWED_EMAIL_DOMAINS.includes(domain);
}
