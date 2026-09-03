"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function signInWithGoogle() {
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
     * brand black underneath simply shows through, where a broken <img> would
     * put a torn-page icon in the middle of the sign-in screen.
     */
    <div
      className="relative min-h-screen overflow-hidden bg-[#000807] bg-cover bg-center p-4"
      style={{ backgroundImage: "url('/login-background.jpg')" }}
    >
      {/* Sitting on the three-quarter line, so the artwork keeps the middle. */}
      <div className="absolute left-1/2 top-3/4 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3">
        {/*
          * Black at the button's edge, gone half an inch out.
          *
          * A blurred shape fades from solid to nothing over roughly one and a
          * half times its blur radius either side of its own edge. To be
          * opaque where the button starts and clear 48px later, the black
          * begins 24px outside the button and blurs by 16: the 24 covers the
          * button edge, and 24 + 24 lands the falloff at 48.
          *
          * Twice the quarter inch it started at, because on artwork this dark
          * a tight halo has almost nothing to separate itself from -- the
          * shape only reads once it is wide enough to darken ground the
          * photograph had left bright.
          *
          * Solid black rather than a translucent wash: the point is to give
          * the button its own ground, not to tint the picture.
          */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bg-black"
          style={{ inset: "-24px", borderRadius: 30, filter: "blur(16px)" }}
        />

        {/*
          * White, and stated outright rather than taken from the theme.
          *
          * This screen is the photograph in both themes -- there is no light
          * version of it -- so a button coloured by the theme would be picked
          * for a background that is never behind it. Signed out, there is no
          * preference to read anyway.
          */}
        <Button
          onClick={signInWithGoogle}
          disabled={loading}
          size="lg"
          className="relative bg-white px-8 text-black hover:bg-white/90 focus-visible:ring-white/60"
        >
          {/* One word, whatever it is doing. The disabled state carries the
              waiting, so the label never changes under the cursor. */}
          Enter
        </Button>

        {/* Kept: it only appears when sign-in has failed, and a screen that
            fails silently gives somebody nothing to act on. */}
        {error && (
          <p className="relative max-w-xs text-center text-sm text-red-300">{error}</p>
        )}
      </div>
    </div>
  );
}
