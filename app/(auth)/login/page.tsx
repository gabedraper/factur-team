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
     * A background image rather than an <img>: if the file is not there the
     * brand black underneath simply shows through, where a broken <img> would
     * put a torn-page icon in the middle of the sign-in screen.
     */
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#000807] p-4 bg-cover bg-center"
      style={{ backgroundImage: "url('/login-background.jpg')" }}
    >
      <div className="relative flex flex-col items-center gap-3">
        {/*
          * A pool of dark behind the button.
          *
          * Blurred and inset well past the button's own edges so it reads as
          * shadow on the photograph rather than a second shape sitting on it.
          * Without it the button has to survive whatever is behind it, and a
          * light patch of sky would swallow it.
          */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-x-24 -inset-y-16 rounded-[50%] bg-black/75 blur-3xl"
        />

        <Button
          onClick={signInWithGoogle}
          disabled={loading}
          size="lg"
          className="relative px-8"
        >
          {loading ? "Redirecting…" : "Sign in with Google"}
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
