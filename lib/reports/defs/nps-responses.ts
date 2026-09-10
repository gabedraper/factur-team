import { getNpsResponses, npsOf, type ResponseDetail } from "@/lib/nps/reporting";
import { clientDomains } from "@/lib/org";
import type { Report } from "../types";

type Row = ResponseDetail & { domain: string | null };

const nf = new Intl.NumberFormat("en-US");

/**
 * Every survey answer, one row each, from nps_response_detail. The NPS page
 * shows the campaign roll-ups; this is the place to read the answers
 * themselves, filtered to a period or a band, and to take them away as a file.
 */
export const npsResponses: Report<Row> = {
  key: "nps-responses",
  label: "NPS responses",
  description: "Every survey answer, with who gave it, who sent it and who leads the account.",
  group: "Clients",
  noun: "responses",
  permissions: ["clients.health"],
  params: [
    { key: "from", label: "Collected from", type: "date" },
    { key: "to", label: "Collected to", type: "date" },
    {
      key: "band",
      label: "Band",
      type: "picklist",
      options: [
        { value: "promoter", label: "Promoters (9–10)" },
        { value: "passive", label: "Passives (7–8)" },
        { value: "detractor", label: "Detractors (0–6)" },
      ],
    },
    {
      key: "follow",
      label: "Follow-up",
      type: "picklist",
      options: [
        { value: "yes", label: "Requested" },
        { value: "no", label: "Not requested" },
      ],
    },
  ],
  search: (r) => `${r.clientName} ${r.respondent ?? ""} ${r.teamLead ?? ""} ${r.comment ?? ""}`,
  columns: [
    {
      key: "client", label: "Client", type: "identity", read: (r) => r.clientName,
      domain: (r) => r.domain, sub: (r) => r.campaignName, href: (r) => `/clients/${r.clientId}`,
    },
    { key: "score", label: "Score", type: "number", read: (r) => r.score, total: "avg" },
    { key: "band", label: "Band", type: "text", read: (r) => r.band },
    { key: "respondent", label: "Respondent", type: "text", read: (r) => r.respondent },
    { key: "collected", label: "Collected", type: "date", read: (r) => r.collectedOn },
    { key: "lead", label: "Team lead", type: "text", read: (r) => r.teamLead, muted: true },
    { key: "sender", label: "Sent by", type: "text", read: (r) => r.senderEmail, muted: true },
    { key: "follow", label: "Follow-up", type: "text", read: (r) => r.followUpRequested },
    { key: "comment", label: "Comment", type: "text", read: (r) => r.comment },
  ],
  rowKey: (r) => r.id,
  defaultSort: { key: "collected", dir: "desc" },
  run: async () => {
    const [responses, domains] = await Promise.all([getNpsResponses(), clientDomains()]);
    return responses.map((r) => ({ ...r, domain: domains[r.clientId] ?? null }));
  },
  filter: (r, v) => {
    // ISO days compare as strings, which is the point of storing them that way.
    const day = r.collectedOn.slice(0, 10);
    if (v.from && day < v.from) return false;
    if (v.to && day > v.to) return false;
    if (v.band && r.band !== v.band) return false;
    if (v.follow === "yes" && !r.followUpRequested) return false;
    if (v.follow === "no" && r.followUpRequested) return false;
    return true;
  },
  stats: (rows) => {
    const nps = npsOf(rows);
    return [
      { label: "Responses", value: nf.format(rows.length) },
      { label: "NPS", value: nps === null ? "—" : nf.format(nps) },
      { label: "Promoters", value: nf.format(rows.filter((r) => r.band === "promoter").length) },
      { label: "Detractors", value: nf.format(rows.filter((r) => r.band === "detractor").length) },
    ];
  },
};
