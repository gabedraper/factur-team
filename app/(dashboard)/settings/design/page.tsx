import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { Table, TableScroll, THead, TBody, TR, TH, TD, TDIdentity } from "@/components/ui/table";
import { Skeleton, TableSkeleton, SurfaceSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { CompanyLogo, Avatar } from "@/components/ui/thumbnail";
import { myPermissions } from "@/lib/org";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/*
 * The living reference. A design system that only exists as documentation
 * drifts from the code within a month; this page imports the real components,
 * so it cannot describe something the app does not do.
 *
 * It is also where to check dark mode. Every decision here behaves differently
 * per theme -- separation is surface colour, and depth on a dark ground is
 * light rather than shadow -- so both need looking at, not just reasoning
 * about.
 */

const ROWS = [
  { name: "Acme Industrial", domain: "acme-industrial.com", stage: "Quote sent", open: 6, value: 48210 },
  { name: "Northside Machine", domain: "northside-machine.com", stage: "Prospecting", open: 2, value: 12400 },
  { name: "Volk Corp", domain: "volk-corp.com", stage: "Closed won", open: 0, value: 96500 },
  { name: "Girotti Machine", domain: "girotti-machine.com", stage: "Lead generated", open: 1, value: 7300 },
];

export default async function DesignPage() {
  if (!(await myPermissions()).has("org.manage")) redirect("/");

  return (
    <div className="space-y-section p-section">
      <PageHeader
        title="Design reference"
        description="The real components, so this page cannot drift from the app. Switch theme to check both."
        eyebrow="Settings"
        actions={<Button size="sm">Primary action</Button>}
      />

      <Surface title="Surface">
        <p className="text-body text-muted-foreground">
          No border. Separation is the surface colour against the page — white on
          faint grey in light, a step lighter than the page in dark.
        </p>
      </Surface>

      <div className="grid gap-3 sm:grid-cols-2">
        <Surface title="Flat, at rest">
          <p className="text-body text-muted-foreground">The default. No shadow.</p>
        </Surface>
        <Surface interactive title="Interactive">
          <p className="text-body text-muted-foreground">
            Hover me. Lift is the only resting-state use of shadow.
          </p>
        </Surface>
      </div>

      <Surface pad="none">
        <div className="p-card pb-0">
          <h2 className="text-section-title">Table</h2>
        </div>
        <TableScroll className="mt-3">
          <Table>
            <THead>
              <TR>
                <TH>Client</TH>
                <TH>Stage</TH>
                <TH numeric>Open</TH>
                <TH numeric>Value</TH>
              </TR>
            </THead>
            <TBody>
              {ROWS.map((r) => (
                <TR key={r.domain} interactive>
                  <TDIdentity
                    thumb={<CompanyLogo name={r.name} domain={r.domain} size={24} />}
                    name={r.name}
                    sub={r.domain}
                  />
                  <TD className="text-muted-foreground">{r.stage}</TD>
                  <TD numeric>{r.open}</TD>
                  <TD numeric>${r.value.toLocaleString("en-US")}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableScroll>
      </Surface>

      <Surface title="People">
        <div className="flex flex-wrap items-center gap-4">
          {["Darryl Mechell", "Eli Garcia", "Josh Hobson", "Meghan Mooney"].map((n) => (
            <span key={n} className="flex items-center gap-2 text-body">
              <Avatar name={n} size={24} />
              {n}
            </span>
          ))}
        </div>
      </Surface>

      <Surface pad="none">
        <div className="p-card pb-0">
          <h2 className="text-section-title">Loading</h2>
          <p className="mt-1 text-meta text-muted-foreground">
            Same row height as the real table, so nothing jumps when data lands.
          </p>
        </div>
        <div className="mt-3">
          <TableSkeleton rows={4} cols={4} />
        </div>
      </Surface>

      <div className="grid gap-3 sm:grid-cols-2">
        <SurfaceSkeleton />
        <Surface title="Type scale">
          <div className="space-y-1">
            <p className="text-2xl font-semibold">Page title · 24px</p>
            <p className="text-section-title">Section title · 14px</p>
            <p className="text-body">Body · 14px</p>
            <p className="text-meta text-muted-foreground">Meta · 12px</p>
          </div>
        </Surface>
      </div>

      <Surface title="Depth">
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ["shadow-raised", "Raised"],
              ["shadow-overlay", "Overlay — menus, hover"],
              ["shadow-modal", "Modal"],
            ] as const
          ).map(([cls, label]) => (
            <div key={cls} className={`rounded-md bg-card p-card-tight text-meta ${cls}`}>
              {label}
              <span className="mt-1 block text-muted-foreground">{cls}</span>
            </div>
          ))}
        </div>
      </Surface>

      <Surface title="Skeleton shapes">
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="h-6 w-6 rounded-md" />
        </div>
      </Surface>
    </div>
  );
}
