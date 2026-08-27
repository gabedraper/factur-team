import { requireTalent } from "@/lib/talent/access";
import {
  getSettings, listActivityTypes, listEmailTemplates, listIntegrations,
  listNoteTemplates, listWorkflows,
} from "@/lib/talent/queries";
import {
  ActivityTypeSettings, CareersSettings, IntegrationSettings,
  TemplateSettings, WorkflowSettings,
} from "@/components/talent/SettingsPanels";
import { PageHeader, Tabs } from "@/components/talent/bits";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "workflows", label: "Pipelines" },
  { key: "templates", label: "Templates" },
  { key: "activity", label: "Activity types" },
  { key: "careers", label: "Careers page" },
  { key: "integrations", label: "Integrations" },
];

export default async function TalentSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireTalent("admin");
  const tab = (await searchParams).tab ?? "workflows";

  const [workflows, settings, integrations, notes, emails, types] = await Promise.all([
    listWorkflows(), getSettings(), listIntegrations(),
    listNoteTemplates(), listEmailTemplates(), listActivityTypes(),
  ]);

  const notConnected = integrations.filter((i) => i.status !== "connected").length;

  return (
    <div className="max-w-4xl space-y-4 p-6">
      <PageHeader title="Talent" />
      <Tabs
        tabs={TABS.map((t) =>
          t.key === "integrations" ? { ...t, count: notConnected } : t
        )}
        active={tab}
        base="/settings/talent"
      />

      {tab === "workflows" && <WorkflowSettings workflows={workflows} />}
      {tab === "templates" && <TemplateSettings notes={notes} emails={emails} />}
      {tab === "activity" && <ActivityTypeSettings types={types} />}
      {tab === "careers" && <CareersSettings settings={settings} />}
      {tab === "integrations" && <IntegrationSettings integrations={integrations} />}
    </div>
  );
}
