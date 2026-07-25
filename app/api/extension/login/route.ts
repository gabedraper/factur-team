import { NextRequest } from "next/server";
import { createAnonClient, createServiceClient } from "@/lib/supabase/server";
import { corsJson, corsPreflight } from "@/app/api/extension/_cors";

export async function OPTIONS(request: NextRequest) {
  return corsPreflight(request.headers.get("origin"));
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const { email, password } = await request.json().catch(() => ({}));

  if (!email || !password) {
    return corsJson(origin, { error: "Email and password are required." }, { status: 400 });
  }

  const supabase = createAnonClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.session || !data.user) {
    return corsJson(origin, { error: error?.message || "Invalid credentials." }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  const { data: profile } = await serviceClient
    .from("profiles")
    .select("full_name, role")
    .eq("id", data.user.id)
    .single();

  return corsJson(origin, {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
    user: {
      id: data.user.id,
      email: data.user.email,
      full_name: profile?.full_name ?? null,
      role: profile?.role ?? null,
    },
  });
}
