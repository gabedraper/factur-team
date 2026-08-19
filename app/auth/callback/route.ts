import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const redirectTo = searchParams.get("redirectTo");

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

  if (redirectTo?.startsWith("/")) {
    return NextResponse.redirect(`${origin}${redirectTo}`);
  }

  const home: Record<string, string> = {
    admin: "/admin",
    manager: "/manager",
    instructor: "/instructor",
    learner: "/learner",
  };

  return NextResponse.redirect(`${origin}${home[profile.role] ?? "/learner"}`);
}
