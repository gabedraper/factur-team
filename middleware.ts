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

  // getUser() verifies the token against Supabase, which is a network call on
  // every request from a signed-in person. On 31 Aug a bulk Loxo import starved
  // the project and that call reached 28 seconds, so Vercel killed the whole
  // middleware invocation and every signed-in user got a 504 on every page.
  //
  // The verification is worth keeping, so it is bounded rather than removed. If
  // it does not answer in time we do not know whether the visitor is signed in
  // -- and "don't know" must not mean "turn them away", or a slow Supabase
  // would bounce the whole company to the login page. The request goes through
  // instead and the page does its own check, which is where the profile and
  // permission checks already live.
  const AUTH_TIMEOUT_MS = 2000;
  const authResult = await Promise.race([
    supabase.auth.getUser(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), AUTH_TIMEOUT_MS)),
  ]);
  const user = authResult?.data?.user ?? null;
  const authUnknown = authResult === null;

  const { pathname } = request.nextUrl;

  // "/careers" and "/portal" are deliberately absent: they are the public
  // careers page and the hiring-manager share links, and adding them here would
  // ask a candidate to sign in to apply.
  const protectedPrefixes = ["/admin", "/instructor", "/learner", "/manager", "/leaderboard", "/scoreboard", "/timelines", "/settings", "/talent"];
  const isProtected = protectedPrefixes.some((prefix) =>
    pathname.startsWith(prefix)
  );

  if (isProtected && !user && !authUnknown) {
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
