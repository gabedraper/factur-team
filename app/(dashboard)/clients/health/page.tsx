import Link from "next/link";
import { getClientHealth } from "@/lib/clients/health";
import { clientScope } from "@/lib/clients/scope";
import { HealthTable } from "@/components/clients/HealthTable";
import { terciles } from "@/lib/clients/health-score";
import { myPermissions } from "@/lib/org";
import { NoAccess } from "@/components/no-access";

export const dynamic = "force-dynamic";

export default async function ClientHealthPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const perms = await myPermissions();
  if (!perms.has("clients.health") && !perms.has("org.manage")) {
    return <NoAccess section="Client health" need="View client health" />;
  }

  const [clients, scope, params] = await Promise.all([
    getClientHealth(),
    clientScope(),
    searchParams,
  ]);

  /*
   * Whose clients are on the page.
   *
   * The choice is only honoured for someone entitled to make it, so a link to
   * ?scope=all shared with an account manager still shows them their own.
   */
  const asked = params.scope === "all" ? true : params.scope === "mine" ? false : null;
  const showAll = scope.canSeeAll && (asked ?? scope.defaultAll);
  const shown = showAll ? clients : clients.filter((c) => scope.mine.has(c.clientId));

  /*
   * Over every client, before either filter. A client's Client Performance
   * rank is a fact about the whole book, so it must not move because someone
   * switched to My Clients or typed in the search box.
   */
  const bandsFor = (key: string) =>
    terciles(clients.map((c) => c.inputs.find((i) => i.key === key)?.score ?? null));
  const perfBands = bandsFor("engagement");
  const actBands = bandsFor("activity");

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold">Client Health</h1>
        {scope.canSeeAll && (
          <div className="flex overflow-hidden rounded-md border text-sm">
            {([
              ["mine", "My Clients", false],
              ["all", "All Clients", true],
            ] as const).map(([value, label, isAll]) => (
              <Link
                key={value}
                href={`/clients/health?scope=${value}`}
                className={`px-3 py-1 ${
                  showAll === isAll
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
        )}
      </div>
      <HealthTable clients={shown} perfBands={perfBands} actBands={actBands} />
    </div>
  );
}
