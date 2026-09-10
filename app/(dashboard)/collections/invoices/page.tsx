import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getInvoiceRegister } from "@/actions/ar-register";
import { InvoiceRegister } from "@/components/collections/InvoiceRegister";
import { myPermissions } from "@/lib/org";
import { NoAccess } from "@/components/no-access";

export const dynamic = "force-dynamic";

export default async function InvoiceRegisterPage() {
  const perms = await myPermissions();
  if (!perms.has("finance.collections") && !perms.has("org.manage")) {
    return <NoAccess section="Invoices" need="Run collections" />;
  }

  const rows = await getInvoiceRegister(180);

  return (
    <div className="p-6 space-y-4 max-w-7xl">
      <div>
        <Link href="/collections" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Collections
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Invoices</h1>
      </div>
      <InvoiceRegister rows={rows} />
    </div>
  );
}
