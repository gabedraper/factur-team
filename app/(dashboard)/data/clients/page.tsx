import { Suspense } from "react";
import { myPermissions } from "@/lib/org";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/ui/page-header";
import { ViewSwitcher } from "@/components/list/ViewSwitcher";
import { ListEmpty } from "@/components/list/EmptyState";
import { control } from "@/components/ui/control";
import { FilterSelect } from "@/components/list/FilterSelect";
import { resolveViews } from "@/lib/list-views/resolve";
import { LIVE_CLIENT_STATUSES } from "@/lib/list-views/catalogue";
import { clientDirectory, clientPicklists } from "@/lib/clients/directory";
import { getClientView } from "@/actions/client-views";
import { ClientDirectory } from "@/components/clients/ClientDirectory";
import {
  CLIENT_FIELD_BY_KEY, CLIENT_SORT_DEFAULT, DEFAULT_CLIENT_COLUMNS,
  type ClientRecord,
} from "@/lib/list-views/clients";
import { columnsKnownTo, filtersKnownTo, matches } from "@/lib/list-views/fields";

export const dynamic = "force-dynamic";

/*
 * Every client as a table, with the columns and filters a person chose.
 *
 * The clients screen under Clients answers "how is this account doing"; this
 * one answers "which clients are these" -- the record browser, in the Data
 * section beside People and Companies, and the first table to get the saved
 * views the opportunities list already has.
 *
 * Two kinds of narrowing meet here and they are deliberately different. A saved
 * view carries structured filters over any field in the catalogue and is stored
 * in the database. The row of dropdowns carries the three questions people ask
 * every day -- whose account, whose team, which service -- and lives in the URL
 * so it survives a reload and pastes into Slack as the thing you were looking
 * at. Both apply: a view is a starting point, not a cage.
 */

type Search = {
  view?: string;
  scope?: string;
  am?: string;
  lead?: string;
  service?: string;
  status?: string;
  q?: string;
};

const STATUS_ANY = "all";
const STATUS_LIVE = "live";

export default async function ClientsDataPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const perms = await myPermissions();
  if (!perms.has("clients.health") && !perms.has("clients.results") && !perms.has("org.manage")) {
    return <NoAccess section="Clients" need="View client health" />;
  }

  const sp = await searchParams;
  const scope = sp.scope === "mine" || sp.scope === "team" ? sp.scope : null;
  const status = sp.status ?? STATUS_LIVE;
  const q = (sp.q ?? "").trim();
  const am = (sp.am ?? "").trim();
  const lead = (sp.lead ?? "").trim();
  const service = (sp.service ?? "").trim();

  const [views, loaded, view] = await Promise.all([
    resolveViews("clients"),
    clientDirectory({ scope }),
    sp.view ? getClientView(sp.view) : Promise.resolve(null),
  ]);

  const picklists = clientPicklists(loaded.rows);

  /* A view names its columns and its sort; without one, the default five. */
  const columnKeys = view
    ? columnsKnownTo(CLIENT_FIELD_BY_KEY, view.columns).map((f) => f.key)
    : DEFAULT_CLIENT_COLUMNS;
  const sortField = view?.sort_field ?? CLIENT_SORT_DEFAULT;
  const sortDir = view?.sort_dir ?? "asc";

  const rows = narrow(loaded.rows, { view, status, q, am, lead, service });

  /* Describe the narrowing in the words on screen, so an empty result can say
     which filter emptied it. */
  const active: string[] = [];
  if (view) active.push(`View: ${view.name}`);
  if (status === STATUS_LIVE) active.push("Status: Live");
  else if (status !== STATUS_ANY) active.push(`Status: ${status}`);
  if (am) active.push(`Account manager: ${am}`);
  if (lead) active.push(`Team lead: ${lead}`);
  if (service) active.push(`Service: ${service}`);
  if (q) active.push(`“${q}”`);

  const base = "/data/clients";
  const keep = new URLSearchParams();
  if (view) keep.set("view", view.id);
  if (scope) keep.set("scope", scope);
  const clearHref = `${base}${keep.toString() ? `?${keep}` : ""}`;

  return (
    <div className="space-y-4 p-section">
      <PageHeader title="Clients" />

      <Suspense fallback={<div className="h-7" />}>
        <ViewSwitcher entity="clients" pinned={views.pinned} rest={views.rest} clearHref={base} />
      </Suspense>

      {/*
        * A plain GET form, so every filter is a query parameter and the page
        * works with the back button, a reload and no JavaScript at all. The
        * dropdowns submit themselves when JavaScript is there, and the button
        * below is how they submit when it is not.
        */}
      <form action={base} className="flex flex-wrap items-center gap-2">
        {view && <input type="hidden" name="view" value={view.id} />}
        {scope && <input type="hidden" name="scope" value={scope} />}
        <input
          name="q"
          defaultValue={q}
          placeholder="Search clients"
          aria-label="Search clients"
          className={control({ size: "sm", plain: true, className: "min-w-[12rem] flex-1 max-w-sm" })}
        />
        <FilterSelect name="am" label="Account manager" value={am} options={picklists.account_manager} any="Any account manager" />
        <FilterSelect name="lead" label="Team lead" value={lead} options={picklists.team_lead} any="Any team lead" />
        <FilterSelect name="service" label="Service" value={service} options={picklists.service} any="Any service" />
        <FilterSelect
          name="status"
          label="Status"
          value={status}
          options={picklists.status}
          any="Every status"
          anyValue={STATUS_ANY}
          extra={[{ value: STATUS_LIVE, label: "Live" }]}
        />
        <button type="submit" className="sr-only">
          Apply filters
        </button>
      </form>

      {rows.length === 0 ? (
        <ListEmpty
          noun="clients"
          error={loaded.error}
          activeFilters={active}
          clearHref={clearHref}
        />
      ) : (
        <ClientDirectory
          rows={rows}
          columnKeys={columnKeys}
          sortField={sortField}
          sortDir={sortDir}
          currentView={view}
          canShare={perms.has("org.manage")}
          canEnrol={perms.has("sequences.send") || perms.has("org.manage")}
          picklists={picklists}
          afterDeleteHref={base}
        />
      )}
    </div>
  );
}

/** The view's own filters, then the dropdowns, then the search box. */
function narrow(
  rows: ClientRecord[],
  {
    view, status, q, am, lead, service,
  }: {
    view: { filters: Parameters<typeof filtersKnownTo>[1] } | null;
    status: string;
    q: string;
    am: string;
    lead: string;
    service: string;
  },
): ClientRecord[] {
  const saved = view ? filtersKnownTo(CLIENT_FIELD_BY_KEY, view.filters) : [];
  const needle = q.toLowerCase();

  return rows.filter((r) => {
    for (const f of saved) {
      const field = CLIENT_FIELD_BY_KEY.get(f.field)!;
      if (!matches(field.read(r), f, field.type)) return false;
    }
    if (status === STATUS_LIVE) {
      if (!(LIVE_CLIENT_STATUSES as readonly string[]).includes(r.status ?? "")) return false;
    } else if (status !== STATUS_ANY && (r.status ?? "") !== status) {
      return false;
    }
    if (am && r.account_manager !== am) return false;
    if (lead && r.team_lead !== lead) return false;
    if (service && r.service !== service) return false;
    if (needle) {
      const hay = `${r.name} ${r.domain ?? ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}
