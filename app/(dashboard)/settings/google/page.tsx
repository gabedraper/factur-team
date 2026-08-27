import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { myPermissions } from "@/lib/org";
import { GoogleCheck } from "@/components/settings/GoogleCheck";
import { ChatAdoption } from "@/components/settings/ChatAdoption";

export const dynamic = "force-dynamic";

export default async function GoogleSettingsPage() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) redirect("/settings");

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Settings
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Google Workspace</h1>
      </div>
      <GoogleCheck />
      <ChatAdoption />
    </div>
  );
}
