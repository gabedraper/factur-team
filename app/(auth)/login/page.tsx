"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  /*
   * Each pill signs in and sets the theme it stands for.
   *
   * Written as a cookie because that is what the app reads: the root layout
   * puts the dark class on the html element from it, on the server, before
   * the browser paints. Its first-visit fallback to the operating system is
   * guarded on the cookie being absent, so a choice made here is not
   * overwritten on the way back from Google.
   */
  async function signInWithGoogle(theme: "light" | "dark") {
    document.cookie = `factur-theme=${theme}; path=/; max-age=31536000; samesite=lax`;
    setLoading(true);
    setError("");

    const supabase = createClient();

    // Where the user was heading rides in a cookie, not on the callback URL.
    // Supabase matches redirect URLs exactly, so a query string here fails to
    // match the allow-list entry and silently falls back to the project's Site
    // URL -- which on a local dev server means being thrown to production.
    const redirectTo = new URLSearchParams(window.location.search).get("redirectTo");
    if (redirectTo?.startsWith("/")) {
      document.cookie = `post_login_redirect=${encodeURIComponent(redirectTo)}; path=/; max-age=600; samesite=lax`;
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    }
  }

  return (
    /*
     * The photograph is the page. No card, no heading, no explanation -- there
     * is one thing to do here and the button says what it is.
     *
     * Dark always. Every colour here is written down rather than read from a
     * theme token: the artwork is dark in both themes, so a light palette
     * would be choosing colours for a background that is never behind them --
     * and signed out there is no preference to read in the first place.
     *
     * A background image rather than an <img>: if the file is not there the
     * flat colour underneath simply shows through, where a broken <img> would
     * put a torn-page icon in the middle of the sign-in screen. That colour
     * is the artwork's own navy, so a failure looks plain rather than wrong.
     */
    <div
      className="relative min-h-screen overflow-hidden bg-[#0b1020] bg-cover bg-center p-4"
      style={{ backgroundImage: "url('/login-background.jpg')" }}
    >
      {/* Sitting on the three-quarter line, so the artwork keeps the middle. */}
      <div className="absolute left-1/2 top-3/4 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-6">
        {/* One pool of dark under both, so they read as a pair on one ground
            rather than two objects each carrying their own shadow. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bg-black"
          style={{ inset: "-28px -32px", borderRadius: 40, filter: "blur(18px)" }}
        />

        <div className="relative flex items-center gap-8">
          {[
            /*
             * The pills now do different things, which is the point of them.
             * Two buttons with one behaviour was the joke wearing thin: a
             * screen reader announced the same option twice and neither
             * answered why there were two.
             */
            {
              key: "red",
              theme: "light" as const,
              label: "Sign in with Google, in the light theme",
              face: "linear-gradient(160deg,#ff5a5f 0%,#e11d2e 45%,#8c0d18 100%)",
              glow: "rgba(225,29,46,0.55)",
            },
            {
              key: "blue",
              theme: "dark" as const,
              label: "Sign in with Google, in the dark theme",
              face: "linear-gradient(160deg,#6f7bff 0%,#323cd0 45%,#161c78 100%)",
              glow: "rgba(50,60,208,0.55)",
            },
          ].map((pill) => (
            <button
              key={pill.key}
              onClick={() => signInWithGoogle(pill.theme)}
              disabled={loading}
              aria-label={pill.label}
              // Hovering says what it does, without printing it on the page.
              title={pill.label}
              className="group relative h-14 w-28 rounded-full transition-transform duration-200 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-60"
              style={{
                background: pill.face,
                boxShadow: `0 0 28px ${pill.glow}, inset 0 1px 0 rgba(255,255,255,0.45)`,
              }}
            >
              {/* The gloss along the top edge is what makes a capsule read as
                  a pill rather than a lozenge of flat colour. */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-3 top-1.5 h-3 rounded-full bg-white/35 blur-[2px]"
              />
            </button>
          ))}
        </div>

        {/* Kept: it only appears when sign-in has failed, and a screen that
            fails silently gives somebody nothing to act on. */}
        {error && (
          <p className="relative max-w-xs text-center text-sm text-red-300">{error}</p>
        )}
      </div>
    </div>
  );
}
