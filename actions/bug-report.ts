"use server";

import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";

const BUG_REPORT_RECIPIENT = "gabe@bethefactur.com";
const MAX_SCREENSHOT_BYTES = 6 * 1024 * 1024;

export async function submitBugReport(
  description: string,
  pageUrl: string,
  screenshot?: { dataUrl: string; filename: string } | null
) {
  if (!description.trim()) {
    return { success: false, error: "Please describe the bug before sending." };
  }

  let attachments: { filename: string; content: string }[] | undefined;
  if (screenshot) {
    const match = screenshot.dataUrl.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
    if (!match) {
      return { success: false, error: "Invalid screenshot format." };
    }
    const base64Content = match[1];
    if (base64Content.length * 0.75 > MAX_SCREENSHOT_BYTES) {
      return { success: false, error: "Screenshot is too large (max 6MB)." };
    }
    attachments = [{ filename: screenshot.filename, content: base64Content }];
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();

  const resend = new Resend(process.env.RESEND_API_KEY);

  const { error } = await resend.emails.send({
    from: "Factur LMS Bug Reports <onboarding@resend.dev>",
    to: BUG_REPORT_RECIPIENT,
    replyTo: user.email,
    subject: `Bug report from ${profile?.full_name || user.email}`,
    text: [
      `Reporter: ${profile?.full_name || "Unknown"} (${user.email})`,
      `Page: ${pageUrl}`,
      "",
      description,
    ].join("\n"),
    attachments,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
