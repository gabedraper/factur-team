import { redirect } from "next/navigation";
import { myPermissions, listServices } from "@/lib/org";
import { ServicesScreen } from "@/components/settings/ServicesScreen";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) redirect("/settings");

  const services = await listServices();

  return (
    <div className="max-w-5xl space-y-4 p-6">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Services" />

      <ServicesScreen services={services} />
    </div>
  );
}
