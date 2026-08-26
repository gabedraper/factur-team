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
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ score?: string }>;
}) {
  const { token } = await params;
  const { score } = await searchParams;

  const supabase = await createClient();
  const { data } = await supabase.rpc("nps_invitation", { p_token: token });

  // One row means the token is good, none means it is not. A 404 either way:
  // an expired-vs-invalid distinction would only help someone guessing.
  const invitation = data?.[0];
  if (!invitation) notFound();

  /*
   * The eleven numbers are buttons in the email itself, each linking here with
   * its own ?score= -- one click to answer, which is the whole reason the
   * existing WordPress form gets replies.
   *
   * It is only a prefill. Recording it here, during the GET, would let a mail
   * scanner answer the survey: Outlook and Gmail follow every link in a message
   * to check it, all eleven of them, and the last one visited would win. The
   * form submits it from the browser instead, which a scanner does not run.
   */
  const parsed = Number(score);
  const prefill =
    Number.isInteger(parsed) && parsed >= 0 && parsed <= 10 ? parsed : null;

  return (
    <NpsResponseForm
      token={token}
      initialScore={invitation.score ?? null}
      initialComment={invitation.comment ?? null}
      initialFollowUp={invitation.follow_up_requested ?? null}
      prefillScore={prefill}
    />
  );
}
