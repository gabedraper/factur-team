import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  const supabase = createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  // No profile means the sign-in was not a Factur address: handle_new_user()
  // only creates one for the allowed domains.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .single();

  if (!profile) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/unauthorized`);
  }

  // Set by the login page before handing off to Google; see the note there on
  // why this cannot travel on the callback URL.
  const jar = cookies();
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

  const home: Record<string, string> = {
    admin: "/admin",
    manager: "/manager",
    instructor: "/instructor",
    learner: "/learner",
  };

  return NextResponse.redirect(`${origin}${home[profile.role] ?? "/learner"}`);
}
