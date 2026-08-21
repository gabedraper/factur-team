// Kept out of lib/org.ts because that imports next/headers, and a client
// component reading these constants would drag server-only code into the
// browser bundle.
export const CLIENT_ROLE_FIELDS = [
  { key: "account_manager_id", label: "Account Manager" },
  { key: "sdr_id", label: "SDR" },
  { key: "marketing_strategist_id", label: "Marketing Strategist" },
  { key: "data_analyst_id", label: "Data Analyst" },
  { key: "data_engineer_id", label: "Data Engineer" },
] as const;

export type ClientRoleField = (typeof CLIENT_ROLE_FIELDS)[number]["key"];
