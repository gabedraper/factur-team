"use server";

import { createClient } from "@/lib/supabase/server";
import { sendBugReportEmail, type BugReportScreenshot } from "@/lib/bug-report";

export async function submitBugReport(
  description: string,
  pageUrl: string,
  screenshot?: BugReportScreenshot | null
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  return sendBugReportEmail(user, description, pageUrl, screenshot);
}
