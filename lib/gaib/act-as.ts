import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";

/*
 * Giving a message from outside the app the permissions of the person who sent
 * it.
 *
 * Inside the app this is free: the browser carries a session and every query
 * runs under it. A message arriving from Google Chat carries no session at all,
 * and the whole permission model rests on there being one -- who may see which
 * client's invoices, whose mailbox may be read, all of it.
 *
 * So a session is minted for them: a one-time token is issued with the service
 * key and immediately exchanged for a real one. No email is sent and nothing is
 * emailed to anybody. What comes back is an ordinary session, indistinguishable
 * from one produced by signing in, which means row level security treats the
 * request exactly as it would if the person were sitting in front of the app.
 * That equivalence is the point: there is no second set of rules to keep in
 * step with the first.
 *
 * THE ENTIRE SAFETY OF THIS RESTS ON ONE THING -- that the email handed in was
 * proved to belong to the sender. This will mint a session for anybody in the
 * domain, so a caller that takes an address from an unverified place is handing
 * out other people's accounts. The only acceptable source is an identity that
 * Google itself signed and that has been checked; never a form field, never
 * something read out of a message body, never a header the caller controls.
 */

const ALLOWED_DOMAINS = ["bethefactur.com", "facturmfg.com"];

export type ActingSession = {
  userId: string;
  email: string;
  /** Scoped to that person. Hand this to the agent's tools and nothing else. */
  db: SupabaseClient;
  /** Always call. A session left alive is one somebody else could be handed. */
  release: () => Promise<void>;
};

export type ActAsFailure =
  | "not-a-factur-address"
  | "no-such-account"
  | "could-not-mint";

/**
 * A session for somebody whose identity has already been proved.
 *
 * Returns a reason rather than throwing, because every caller has to tell the
 * sender something useful and "an error occurred" is not that.
 */
export async function actAs(
  verifiedEmail: string
): Promise<{ ok: true; session: ActingSession } | { ok: false; reason: ActAsFailure }> {
  const email = verifiedEmail.trim().toLowerCase();

  /*
   * The domain is checked here as well as by the database.
   *
   * is_factur_user() would refuse anything else anyway, so this is belt and
   * braces -- but it means a mistake upstream produces a refusal before a
   * session exists, rather than a live session that merely cannot read
   * anything. A session that should never have been created is worth not
   * creating.
   */
  const domain = email.split("@")[1] ?? "";
  if (!ALLOWED_DOMAINS.includes(domain)) return { ok: false, reason: "not-a-factur-address" };

  const admin = createServiceClient();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return { ok: false, reason: "could-not-mint" };

  // generateLink issues the token and returns it. It does not send anything --
  // which is the only reason this is usable for somebody who is mid-sentence in
  // a chat window rather than waiting on an inbox.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (linkError || !link?.properties?.hashed_token) {
    /*
     * Somebody who has never signed in has no account to act as, and this must
     * not quietly create one -- an agent would then answer a stranger with
     * whatever the empty-permission set happens to allow. Told apart from a
     * genuine failure so the sender can be told to sign in once.
     */
    const missing = /user not found|not found/i.test(linkError?.message ?? "");
    return { ok: false, reason: missing ? "no-such-account" : "could-not-mint" };
  }

  const gate = createClient(url, anon, { auth: { persistSession: false } });
  const { data: verified, error: otpError } = await gate.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });

  if (otpError || !verified?.session || !verified.user) {
    return { ok: false, reason: "could-not-mint" };
  }

  const db = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${verified.session.access_token}` },
    },
  });

  return {
    ok: true,
    session: {
      userId: verified.user.id,
      email: verified.user.email ?? email,
      db,
      release: async () => {
        // Best effort. A session that outlives the request expires on its own;
        // failing to tidy up is not worth losing the answer over.
        try {
          await db.auth.signOut();
        } catch {
          /* nothing useful to do */
        }
      },
    },
  };
}

/**
 * Who signs in with this address, if anybody.
 *
 * Goes through a database function rather than listing accounts and searching
 * them: the list grows, the page size does not, and a lookup that quietly stops
 * finding the forty-first person is the kind of bug that only shows up once
 * somebody new complains that the assistant does not know them.
 */
export async function findMemberByEmail(email: string): Promise<{
  userId: string;
  fullName: string | null;
} | null> {
  const admin = createServiceClient();
  const { data, error } = await admin.rpc("user_for_email", { p_email: email });
  if (error) return null;

  const row = (data as { user_id: string; full_name: string | null }[] | null)?.[0];
  return row ? { userId: row.user_id, fullName: row.full_name } : null;
}
