import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/ui/page-header";
import { ViewSwitcher } from "@/components/list/ViewSwitcher";
import { ListEmpty } from "@/components/list/EmptyState";
import { ClientsList, type ClientRow } from "@/components/clients/ClientsList";
import { resolveViews, clientIdsForScope } from "@/lib/list-views/resolve";
import { LIVE_CLIENT_STATUSES } from "@/lib/list-views/catalogue";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/*
 * The clients list -- and the reference for how every list in the app is
 * built: title, view chips, filters, rows, with every filter held in the URL.
 *
 * Nothing here is component state. The view, the status filter and the search
 * are all query parameters, so this page survives a reload, the back button
 * undoes a filter, and the address bar is exactly what somebody would paste to
 * a colleague. When in doubt about how to build a new list, copy this one.
 */

type Search = { scope?: string; status?: string; q?: string };

const STATUS_FILTERS = [
  { key: "live", label: "Live" },
  { key: "Active", label: "Active" },
  { key: "Onboarding", label: "Onboarding" },
  { key: "Inactive", label: "Inactive" },
  { key: "all", label: "Every status" },
] as const;

export default async function ClientsIndexPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const perms = await myPermissions();
  if (!perms.has("clients.health") && !perms.has("org.manage")) {
    return <NoAccess section="Clients" need="View client health" />;
  }

  const sp = await searchParams;
  const scope = sp.scope === "mine" || sp.scope === "team" ? sp.scope : null;
  const status = sp.status ?? "live";
  const q = (sp.q ?? "").trim();

  const views = await resolveViews("clients");
  const { rows, error } = await loadClients({ scope, status, q });

  /* Describe the active narrowing in the words on screen, so an empty result
     can say exactly which filter emptied it. */
  const active: string[] = [];
  if (status !== "live") active.push(`Status: ${STATUS_FILTERS.find((s) => s.key === status)?.label ?? status}`);
  if (q) active.push(`“${q}”`);

  const href = (patch: Partial<Search>) => {
    const next = new URLSearchParams();
    const merged = { scope: scope ?? undefined, status, q: q || undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) {
      // "live" is the default, so it stays out of the URL rather than
      // cluttering every shared link with the one thing that is assumed.
      if (v && !(k === "status" && v === "live")) next.set(k, v);
    }
    const s = next.toString();
    return `/clients${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-4 p-section">
      <PageHeader title="Clients" />

      <Suspense fallback={<div className="h-7" />}>
        <ViewSwitcher entity="clients" pinned={views.pinned} rest={views.rest} />
      </Suspense>

      <div className="flex flex-wrap items-center gap-3">
        {/* A plain GET form, so search is a query parameter like every other
            filter and works without JavaScript at all. */}
        <form action="/clients" className="flex-1 min-w-[12rem] max-w-sm">
          {scope && <input type="hidden" name="scope" value={scope} />}
          {status !== "live" && <input type="hidden" name="status" value={status} />}
          <input
            name="q"
            defaultValue={q}
            placeholder="Search clients"
            aria-label="Search clients"
            className="w-full rounded-md bg-card px-3 py-1.5 text-body outline-none ring-ring focus-visible:ring-2"
          />
        </form>
        <nav aria-label="Status" className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((s) => (
            <Link
              key={s.key}
              href={href({ status: s.key })}
              aria-current={status === s.key ? "true" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1 text-meta transition-colors duration-fast ease-out",
                status === s.key
                  ? "bg-card text-foreground shadow-raised"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s.label}
            </Link>
          ))}
        </nav>
      </div>

      {rows.length === 0 ? (
        <ListEmpty
          noun="clients"
          error={error}
          activeFilters={active}
          clearHref={href({ status: "live", q: undefined })}
        />
      ) : (
        <>
          <p className="text-meta text-muted-foreground tabular-nums">
            {rows.length} client{rows.length === 1 ? "" : "s"}
          </p>
          <ClientsList rows={rows} />
        </>
      )}
    </div>
  );
}

async function loadClients({
  scope,
  status,
  q,
}: {
  scope: "mine" | "team" | null;
  status: string;
  q: string;
}): Promise<{ rows: ClientRow[]; error: string | null }> {
  try {
    const db = await createClient();

    let ids: string[] | null = null;
    if (scope) {
      ids = await clientIdsForScope(scope);
      // Staffed on nothing means nothing to show -- never "everything".
      if (ids.length === 0) return { rows: [], error: null };
    }

    let query = db
      .from("org_clients")
      .select("id,name,status,email_domain,account_manager_id")
      .order("name");

    if (status === "live") query = query.in("status", LIVE_CLIENT_STATUSES as unknown as string[]);
    else if (status !== "all") query = query.eq("status", status);
    if (q) query = query.ilike("name", `%${q.replace(/[%_]/g, "\\$&")}%`);

    const { data, error } = await query;
    if (error) return { rows: [], error: error.message };

    type Raw = {
      id: string; name: string; status: string | null;
      email_domain: string | null; account_manager_id: string | null;
    };
    /*
     * Scope is applied here, not in the query. The ids would have to travel in
     * the query string, and a manager at the top of the reporting line has
     * close to a thousand -- past what the API gateway accepts, so "My team's
     * clients" failed for them. There are only ~1,000 clients to filter.
     */
    const inScope = ids ? new Set(ids) : null;
    const raw = ((data ?? []) as Raw[]).filter((r) => !inScope || inScope.has(r.id));

    /*
     * Two reads rather than an embedded join. org_clients and org_members are
     * not joined by a foreign key PostgREST can follow -- org_clients is
     * rebuilt by the Coupler sync, which would drop one -- and an embed with no
     * relationship returns empty rather than failing, which reads as "no
     * account manager" on every row.
     */
    const managerIds = [...new Set(raw.map((r) => r.account_manager_id).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (managerIds.length) {
      const { data: ms } = await db
        .from("org_members").select("id,full_name,email").in("id", managerIds);
      for (const m of (ms ?? []) as { id: string; full_name: string | null; email: string }[]) {
        names.set(m.id, m.full_name ?? m.email);
      }
    }

    return {
      rows: raw.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        domain: r.email_domain,
        manager: r.account_manager_id ? names.get(r.account_manager_id) ?? null : null,
      })),
      error: null,
    };
  } catch (e) {
    /* Returned, not thrown. A thrown error here would take the whole page
       down; returned, it becomes the "Couldn't load clients" state, which is
       what the person actually needs to see. */
    return { rows: [], error: e instanceof Error ? e.message : "Unknown error" };
  }
}
