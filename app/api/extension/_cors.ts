import { NextResponse } from "next/server";

// The extension is installed unpacked in development, so its
// chrome-extension:// origin ID differs per machine. There are no cookies
// involved (auth is a bearer token the extension attaches explicitly), so
// echoing back any chrome-extension:// origin is safe.
export function corsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
  if (origin?.startsWith("chrome-extension://")) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  return headers;
}

export function corsJson(
  origin: string | null,
  body: unknown,
  init?: { status?: number }
) {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: corsHeaders(origin),
  });
}

export function corsPreflight(origin: string | null) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}
