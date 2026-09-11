import { redirect } from "next/navigation";
import { myPermissions } from "@/lib/org";
import { GoogleCheck } from "@/components/settings/GoogleCheck";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function GoogleSettingsPage() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) redirect("/settings");

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Google Workspace" />
      <GoogleCheck />
    </div>
  );
}
