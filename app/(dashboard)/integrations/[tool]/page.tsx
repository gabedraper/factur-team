import { notFound, redirect } from "next/navigation";
import { myPermissions, listMembers } from "@/lib/org";
import { integrationsReport } from "@/actions/integrations";
import { TOOL_BY_KEY } from "@/lib/integrations/catalogue";
import { PageHeader } from "@/components/ui/page-header";
import { CompanyLogo } from "@/components/ui/thumbnail";
import { Chip } from "@/components/pipeline/bits";
import { TableScroll, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Connection, ago } from "@/components/integrations/Connection";
import {
  SalesforceAccounts, SalesforceSync, SalesforceWriteback, SectionTitle,
} from "@/components/integrations/SalesforceSections";
import { GoogleSections } from "@/components/integrations/GoogleSections";
import { QuickbooksLinks } from "@/components/settings/QuickbooksLinks";
import { listUnmatchedQuickbooks, listClientsForLinking } from "@/actions/quickbooks-links";
import { VoiceNumbers } from "@/components/settings/VoiceNumbers";
import { listVoiceNumbers } from "@/actions/dialer";
import { AgreementImport } from "@/components/settings/AgreementImport";
import { agreementCounts } from "@/actions/pandadoc";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/*
 * One tool: its connections as the catalogue describes them, then every
 * setting that belongs to it. Sections carry ids, so a link can land on
 * "#sync" or "#writeback" the way the old settings pages could be linked.
 */

export default async function ToolPage({
  params, searchParams,
}: {
  params: Promise<{ tool: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) redirect("/");

  const [{ tool: key }, sp] = await Promise.all([params, searchParams]);
  const tool = TOOL_BY_KEY.get(key);
  if (!tool) notFound();

  const report = await integrationsReport();
  const connections = report.integrations.filter((i) => i.tool === key);
  const failing = key === "google" ? report.failing : [];

  return (
    <div className="space-y-8 p-section">
      <PageHeader
        back={{ href: "/integrations", label: "Integrations" }}
        title={tool.name}
        description={tool.what}
        actions={<CompanyLogo name={tool.name} domain={tool.domain} size={40} />}
      />

      {failing.length > 0 && (
        <section className="space-y-3">
          <SectionTitle id="attention">Needs attention</SectionTitle>
          <TableScroll className="rounded-md border border-destructive/40">
            <Table>
              <THead className="bg-destructive/10"><TR><TH>Account</TH><TH>Read</TH><TH>When</TH><TH>Problem</TH></TR></THead>
              <TBody>
                {failing.map((r) => (
                  <TR key={`${r.kind}-${r.account}`} className="border-t">
                    <TD>{r.account}</TD>
                    <TD className="text-muted-foreground">{r.kind}</TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{ago(r.ranAt)}</TD>
                    <TD className="text-destructive">{r.problem}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        </section>
      )}

      {connections.map((i) => <Connection key={i.key} i={i} />)}

      {key === "salesforce" && (
        <>
          <SalesforceSync />
          <SalesforceWriteback status={sp.status ?? "all"} canShare={perms.has("org.manage")} />
          <SalesforceAccounts />
        </>
      )}

      {key === "google" && <GoogleSections report={report} />}

      {key === "quickbooks" && <QuickbooksSection canDecide={perms.has("org.manage")} />}

      {key === "dialpad" && <DialpadSection />}

      {key === "pandadoc" && <PandadocSection />}
    </div>
  );
}

async function QuickbooksSection({ canDecide }: { canDecide: boolean }) {
  const [rows, clients] = await Promise.all([listUnmatchedQuickbooks(), listClientsForLinking()]);
  return (
    <section className="space-y-3">
      <SectionTitle id="customers">Customers</SectionTitle>
      <p className="max-w-3xl text-body text-muted-foreground">
        Tie customers who owe money to the right client, where the names differ.
      </p>
      <QuickbooksLinks rows={rows} clients={clients} canDecide={canDecide} />
    </section>
  );
}

async function DialpadSection() {
  const [numbers, { members }] = await Promise.all([listVoiceNumbers(), listMembers()]);
  const ctiConfigured = Boolean(process.env.NEXT_PUBLIC_DIALPAD_CTI_CLIENT_ID);
  return (
    <section className="space-y-3">
      <SectionTitle id="dialer">Dialer</SectionTitle>
      <div className="flex flex-wrap items-center gap-2 text-body">
        <span>Dialpad Mini Dialer (CTI Client ID)</span>
        <Chip colour={ctiConfigured ? "emerald" : "amber"}>{ctiConfigured ? "Configured" : "Not set"}</Chip>
        {!ctiConfigured && (
          <span className="text-muted-foreground">
            Set <code className="rounded bg-muted px-1">NEXT_PUBLIC_DIALPAD_CTI_CLIENT_ID</code> once Dialpad issues one.
          </span>
        )}
      </div>
      <h3 className="text-body font-medium">Outbound number pool</h3>
      <VoiceNumbers numbers={numbers} members={members as { id: string; full_name: string | null; email: string }[]} />
    </section>
  );
}

async function PandadocSection() {
  const counts = await agreementCounts();
  return (
    <section className="space-y-3">
      <SectionTitle id="agreements">Signed agreements</SectionTitle>
      <AgreementImport counts={counts} />
    </section>
  );
}
