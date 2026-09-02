import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
import { pdf } from "@/lib/pandadoc/client";

/**
 * The signed PDF, streamed from PandaDoc rather than copied into storage.
 *
 * Copying 1,275 contracts would mean holding a second, ageing copy of every
 * agreement the company has signed, and keeping it in step. This fetches the
 * live one, and the key never leaves the server.
 *
 * Inline rather than attachment: the client screen shows the first page in a
 * frame, and a download header would make the browser save it instead.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const perms = await myPermissions();
  if (!perms.has("clients.health") && !perms.has("org.manage")) {
    return new NextResponse("Not permitted.", { status: 403 });
  }

  const { id } = await params;

  const { data } = await createServiceClient()
    .from("client_agreements")
    .select("external_id,name")
    .eq("id", id)
    .maybeSingle();

  const row = data as { external_id: string | null; name: string } | null;
  if (!row?.external_id) {
    return new NextResponse("No document for that agreement.", { status: 404 });
  }

  try {
    const upstream = await pdf(row.external_id);
    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${row.name.replace(/"/g, "")}.pdf"`,
        // Signed agreements do not change, but they are not public either.
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return new NextResponse(
      e instanceof Error ? e.message : "Could not fetch the document.",
      { status: 502 }
    );
  }
}
