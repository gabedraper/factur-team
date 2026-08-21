"use server";

import { createClient } from "@/lib/supabase/server";

export async function issueCertificate(userId: string, courseId: string) {
  const supabase = await createClient();

  // Check if already issued
  const { data: existing } = await supabase
    .from("certificates")
    .select("id")
    .eq("user_id", userId)
    .eq("course_id", courseId)
    .single();

  if (existing) return { success: true, alreadyExisted: true };

  const certNumber = `CERT-${Date.now()}-${userId.slice(0, 6).toUpperCase()}`;
  const issuerName =
    process.env.NEXT_PUBLIC_ISSUER_NAME || "Training Department";

  const { error } = await supabase.from("certificates").insert({
    user_id: userId,
    course_id: courseId,
    cert_number: certNumber,
    issuer_name: issuerName,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, certNumber };
}
