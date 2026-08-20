"use client";

import { useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>{process.env.NEXT_PUBLIC_SITE_NAME || "Factur Team"}</CardTitle>
          <CardDescription>Sign in with your Factur Google account</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={signInWithGoogle} disabled={loading} className="w-full">
            {loading ? "Redirecting..." : "Sign in with Google"}
          </Button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
