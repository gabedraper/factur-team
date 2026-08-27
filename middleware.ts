import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LANDING } from "@/lib/landing";

/**
 * Refreshes the session and turns signed-out visitors away. Nothing else.
 *
 * This runs on every request, so each database call is paid on all of them. It
 * previously also looked up a profile and made two permission calls, which
 * together timed out on the live site. Those checks live in the pages now,
 * where they run once per render and can use the service client.
 */
export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options as any)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // "/careers" and "/portal" are deliberately absent: they are the public
  // careers page and the hiring-manager share links, and adding them here would
  // ask a candidate to sign in to apply.
  const protectedPrefixes = ["/admin", "/instructor", "/learner", "/manager", "/leaderboard", "/scoreboard", "/timelines", "/settings", "/talent"];
  const isProtected = protectedPrefixes.some((prefix) =>
    pathname.startsWith(prefix)
  );

  if (isProtected && !user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // If logged in and hitting auth pages, redirect to appropriate dashboard
  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL(DEFAULT_LANDING, request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
