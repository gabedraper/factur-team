import { redirect } from "next/navigation";

/*
 * The client record and the client's activity used to be two screens, which
 * made "the client record" an ambiguous phrase and left people editing one
 * while reading the other. They are one screen now; this URL is kept because
 * the Settings list and older links still point at it.
 */
export default async function SettingsClientRedirect({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  redirect(`/clients/${(await params).clientId}`);
}
