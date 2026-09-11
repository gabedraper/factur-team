import { getInvoiceRegister } from "@/actions/ar-register";
import { InvoiceRegister } from "@/components/collections/InvoiceRegister";
import { myPermissions } from "@/lib/org";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function InvoiceRegisterPage() {
  const perms = await myPermissions();
  if (!perms.has("finance.collections") && !perms.has("org.manage")) {
    return <NoAccess section="Invoices" need="Run collections" />;
  }

  const rows = await getInvoiceRegister(180);

  return (
    <div className="p-6 space-y-4 max-w-7xl">
      <PageHeader back={{ href: "/collections", label: "Collections" }} title="Invoices" />
      <InvoiceRegister rows={rows} />
    </div>
  );
}
