import { NextResponse } from "next/server";
import { buildStatement } from "@/lib/ar/statement-pdf";
import { myPermissions } from "@/lib/org";

/**
 * A client's statement of account, drawn on demand.
 *
 * Nothing is stored. The statement is only ever true as at the moment it is
 * asked for, and a saved copy would start disagreeing with the ledger the
 * moment the next payment landed.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const perms = await myPermissions();
  if (!perms.has("clients.health") && !perms.has("finance.collections") && !perms.has("org.manage")) {
    return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  }

  const { clientId } = await params;

  let statement;
  try {
    statement = await buildStatement(clientId);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not draw the statement" },
      { status: 500 }
    );
  }

  if (!statement) {
    return NextResponse.json({ error: "Nothing outstanding" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(statement.pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${statement.filename.replace(/"/g, "")}"`,
      "Content-Length": String(statement.pdf.length),
      "Cache-Control": "no-store",
    },
  });
}
