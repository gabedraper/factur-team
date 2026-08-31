import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { myPermissions, listServices } from "@/lib/org";
import { ServicesScreen } from "@/components/settings/ServicesScreen";

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) redirect("/settings");

  const services = await listServices();

  return (
    <div className="max-w-5xl space-y-4 p-6">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Settings
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Services</h1>
      </div>

      <ServicesScreen services={services} />
    </div>
  );
}
