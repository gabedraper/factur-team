"use client";

import { useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { BrandMesh } from "@/components/BrandMesh";

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
    /* Brand black (#000807), not the slate it borrowed before. The
       supergraphic rising out of the bottom-left corner and running off the
       edges, the way the artwork does. This is the one screen that is pure
       brand -- nothing on it competes with the graphic. */
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#000807] p-4">
      {/* A band along the bottom rather than a full-bleed fill. The artwork is
          wide and rises out of one corner; stretched over a tall viewport it
          crops to its own left edge and the shape disappears. */}
      <BrandMesh className="pointer-events-none absolute inset-x-0 bottom-0 h-[62%] w-full opacity-40" />
      {/* One white circle holding everything. A circle wastes its corners, so
          the content sits in a narrower column than the width suggests --
          hence the heavy horizontal padding. Capped against the viewport so it
          cannot overflow a short window. */}
      <div className="on-light relative flex aspect-square w-[26rem] max-w-[min(90vw,80vh)] flex-col items-center justify-center gap-5 rounded-full bg-white px-14 text-center shadow-2xl">
        <Image
          src="https://facturmfg.com/wp-content/uploads/2022/11/Factur-Logo-300x94.png"
          alt="Factur"
          width={180}
          height={56}
          priority
          className="h-auto w-40 object-contain"
        />

        <div>
          <h1 className="text-xl font-semibold text-foreground">Factur Team</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in with your Factur Google account
          </p>
        </div>

        <Button onClick={signInWithGoogle} disabled={loading} className="w-full">
          {loading ? "Redirecting…" : "Sign in with Google"}
        </Button>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
