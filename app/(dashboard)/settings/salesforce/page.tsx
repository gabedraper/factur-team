import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { myPermissions, listSalesforceSuggestions } from "@/lib/org";
import { SalesforceMatchScreen } from "@/components/settings/SalesforceMatchScreen";

export const dynamic = "force-dynamic";

export default async function SalesforceMatchPage() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) redirect("/settings");

  const suggestions = await listSalesforceSuggestions();

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Settings
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Salesforce accounts</h1>
        <p className="text-sm text-muted-foreground">
          Tying each person to their Salesforce user, so opportunities and activity are attributed
          to the right person. Exact email fails often here — staff appear under one domain in
          Salesforce and another in the directory — so these are scored suggestions, not answers.
        </p>
      </div>
      <SalesforceMatchScreen suggestions={suggestions} />
    </div>
  );
}
