import { NextRequest } from "next/server";
import { sendBugReportEmail } from "@/lib/bug-report";
import { corsJson, corsPreflight } from "@/app/api/extension/_cors";
import { getUserFromBearer } from "@/app/api/extension/_auth";

export async function OPTIONS(request: NextRequest) {
  return corsPreflight(request.headers.get("origin"));
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const user = await getUserFromBearer(request);

  if (!user) {
    return corsJson(origin, { error: "Not authenticated" }, { status: 401 });
  }

  const { description, pageUrl, screenshot } = await request.json().catch(() => ({}));

  if (typeof description !== "string" || typeof pageUrl !== "string") {
    return corsJson(origin, { error: "Missing description or pageUrl." }, { status: 400 });
  }

  const result = await sendBugReportEmail(user, description, pageUrl, screenshot ?? null);

  return corsJson(origin, result, { status: result.success ? 200 : 400 });
}
