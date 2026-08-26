import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NpsResponseForm } from "@/components/nps/NpsResponseForm";

/*
 * The client-facing survey. No account, no sidebar, no Factur chrome.
 *
 * This sits outside the (dashboard) route group so it gets the bare root
 * layout, and outside `protectedPrefixes` in middleware.ts so nobody is asked
 * to sign in. Adding "/nps" to that list would break every survey link.
 */
export const dynamic = "force-dynamic";

export default async function NpsRespondPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const supabase = await createClient();
  const { data } = await supabase.rpc("nps_invitation", { p_token: token });

  // One row means the token is good, none means it is not. A 404 either way:
  // an expired-vs-invalid distinction would only help someone guessing.
  const invitation = data?.[0];
  if (!invitation) notFound();

  return (
    <NpsResponseForm
      token={token}
      initialScore={invitation.score ?? null}
      initialComment={invitation.comment ?? null}
    />
  );
}
