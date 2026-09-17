import { GoogleCheck } from "@/components/settings/GoogleCheck";
import { TableScroll, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { ago } from "@/components/integrations/Connection";
import { SectionTitle } from "@/components/integrations/SalesforceSections";
import type { IntegrationsReport } from "@/actions/integrations";

/* The Google-specific parts of the old Integrations page, on Google's card. */

export function GoogleSections({ report }: { report: IntegrationsReport }) {
  return (
    <>
      <section className="space-y-3">
        <SectionTitle id="connection">Connection</SectionTitle>
        <GoogleCheck />
      </section>

      <section className="space-y-3">
        <SectionTitle id="scopes">What Google is allowed to do</SectionTitle>
        <TableScroll className="rounded-md border">
          <Table>
            <THead><TR><TH>Purpose</TH><TH>Scope granted</TH></TR></THead>
            <TBody>
              {report.googleScopes.map((g) => (
                <TR key={g.service} className="border-t align-top">
                  <TD>{g.service}</TD>
                  <TD className="font-mono text-meta text-muted-foreground">
                    {g.scopes.map((s) => <span key={s} className="block">{s.replace("https://www.googleapis.com/auth/", "")}</span>)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableScroll>
      </section>

      <section className="space-y-3">
        <SectionTitle id="mail">Which mail is read</SectionTitle>
        <p className="max-w-3xl text-body text-muted-foreground">
          The exact search sent to Gmail. Subjects only — Gmail&apos;s default searches whole messages, which pulled in
          sales threads that merely mentioned money.
        </p>
        <pre className="overflow-x-auto rounded-md border bg-muted/30 p-3 text-meta">{report.billingQuery}</pre>
      </section>

      {report.recentRuns.length > 0 && (
        <section className="space-y-3">
          <SectionTitle id="reads">Recent reads</SectionTitle>
          <TableScroll className="rounded-md border">
            <Table>
              <THead><TR><TH>Account</TH><TH>Source</TH><TH numeric>Found</TH><TH numeric>Attached</TH><TH>When</TH></TR></THead>
              <TBody>
                {report.recentRuns.map((r) => (
                  <TR key={`${r.kind}-${r.account}-${r.ranAt}`} className="border-t">
                    <TD>{r.account}</TD>
                    <TD className="text-muted-foreground">{r.kind}</TD>
                    <TD numeric>{r.found}</TD>
                    <TD numeric>{r.attached}</TD>
                    <TD className="text-muted-foreground">{ago(r.ranAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        </section>
      )}
    </>
  );
}
