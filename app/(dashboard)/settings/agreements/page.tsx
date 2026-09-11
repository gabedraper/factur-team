import { redirect } from "next/navigation";
import { myPermissions } from "@/lib/org";
import { agreementCounts } from "@/actions/pandadoc";
import { AgreementImport } from "@/components/settings/AgreementImport";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function AgreementsPage() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) redirect("/settings");

  const counts = await agreementCounts();

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Signed agreements" />
      <AgreementImport counts={counts} />
    </div>
  );
}
