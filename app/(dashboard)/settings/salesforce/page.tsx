import { redirect } from "next/navigation";
import { myPermissions, listSalesforceSuggestions, listClientRoleDrift } from "@/lib/org";
import { SalesforceMatchScreen } from "@/components/settings/SalesforceMatchScreen";
import { ClientRoleDrift } from "@/components/settings/ClientRoleDrift";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function SalesforceMatchPage() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) redirect("/settings");

  const [suggestions, drift] = await Promise.all([
    listSalesforceSuggestions(),
    listClientRoleDrift(),
  ]);

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Salesforce accounts"
        description="Tying each person to their Salesforce user, so opportunities and activity are attributed to the right person. Exact email fails often here — staff appear under one domain in Salesforce and another in the directory — so these are scored suggestions, not answers."
      />
      <SalesforceMatchScreen suggestions={suggestions} />

      <section className="pt-4">
        <h2 className="text-lg font-semibold">Client cover</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Who covers a client is set here, in the app. These are the clients
          where Salesforce still says someone else — nothing is changed
          automatically, because which side is right depends on who actually
          works the account.
        </p>
        <ClientRoleDrift rows={drift} />
      </section>
    </div>
  );
}
