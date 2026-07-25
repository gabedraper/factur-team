import { NextRequest } from "next/server";
import { createAnonClient } from "@/lib/supabase/server";

export async function getUserFromBearer(request: NextRequest) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;

  const supabase = createAnonClient();
  const {
    data: { user },
  } = await supabase.auth.getUser(token);
  return user;
}
