import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_LANDING } from "@/lib/landing";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  // No profile means the sign-in was not a Factur address: handle_new_user()
  // only creates one for the allowed domains.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();

  /*
   * A failed read is not a missing profile. Treating it as one signed a real
   * Factur employee out whenever the database was slow -- the next line is a
   * signOut(). Send them back to sign in with an honest error instead, and
   * leave the session alone so a retry can succeed.
   */
  if (profileError) {
    return NextResponse.redirect(`${origin}/login?error=profile`);
  }

  if (!profile) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/unauthorized`);
  }

  // Set by the login page before handing off to Google; see the note there on
  // why this cannot travel on the callback URL.
  const jar = await cookies();
  const wanted = jar.get("post_login_redirect")?.value;
  if (wanted) {
    const path = decodeURIComponent(wanted);
    // Only same-site paths, and never "//host" which browsers treat as absolute.
    if (path.startsWith("/") && !path.startsWith("//")) {
      const res = NextResponse.redirect(`${origin}${path}`);
      res.cookies.delete("post_login_redirect");
      return res;
    }
  }

  return NextResponse.redirect(`${origin}${DEFAULT_LANDING}`);
}
