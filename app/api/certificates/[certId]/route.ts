import { NextRequest, NextResponse } from "next/server";
import { renderToStream } from "@react-pdf/renderer";
import { createElement } from "react";
import { createServiceClient } from "@/lib/supabase/server";
import { CertificateDocument } from "@/lib/certificate";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ certId: string }> }
) {
  const supabase = createServiceClient();

  // Fetch certificate with user and course info
  const { data: cert, error } = await supabase
    .from("certificates")
    .select(
      `
      *,
      profiles(full_name),
      courses(title)
    `
    )
    .eq("id", (await params).certId)
    .single();

  if (error || !cert) {
    return NextResponse.json({ error: "Certificate not found" }, { status: 404 });
  }

  const profile = cert.profiles as { full_name: string } | null;
  const course = cert.courses as { title: string } | null;
  const lmsName =
    process.env.NEXT_PUBLIC_LMS_NAME || "Team Learning Academy";

  try {
    const element = createElement(CertificateDocument, {
      learnerName: profile?.full_name || "Learner",
      courseTitle: course?.title || "Course",
      issuerName: cert.issuer_name,
      certNumber: cert.cert_number,
      issuedAt: cert.issued_at,
      lmsName,
    });

    const stream = await renderToStream(element as any);

    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      chunks.push(Buffer.from(chunk));
    }
    const pdfBuffer = Buffer.concat(chunks);

    const safeCourseTitle = (course?.title || "certificate")
      .replace(/[^a-z0-9]/gi, "_")
      .toLowerCase();

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="certificate_${safeCourseTitle}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      },
    });
  } catch (err) {
    console.error("PDF generation error:", err);
    return NextResponse.json(
      { error: "Failed to generate PDF" },
      { status: 500 }
    );
  }
}
