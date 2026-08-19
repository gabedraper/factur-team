// Zero-effort "no rep action" categories -- nothing meaningful to show/tune,
// so they're filtered out of both the admin editor and the points-per-activity
// legend (the underlying effort_weights rows and classification are untouched).
export const HIDDEN_EFFORT_SOURCES = new Set([
  "Auto-Responder (No Rep Effort)",
  "Bounced (No Rep Effort)",
  "Calendar Invite (No Rep Effort)",
  "Excluded Meeting (No Rep Effort)",
  "Inbound Call (No Rep Effort)",
  "Other/Unclassified",
]);

// Grouped Calls / Emails / Meetings, in that order, so the admin list and the
// points-per-activity legend read as clusters instead of an alphabetical or
// points-sorted shuffle. Anything not listed here sorts to the end.
const EFFORT_SOURCE_ORDER = [
  // Calls
  "Manual Call",
  "Automated Call (Power Dialer)",
  "Automated Call (Parallel Dialer)",
  "Manual SMS",
  "Inbound Call (No Rep Effort)",
  // Emails
  "Sequence Email (Automated Send)",
  "Manual Email",
  "Calendar Invite (No Rep Effort)",
  "Inbound Reply (No Rep Effort)",
  "Auto-Responder (No Rep Effort)",
  "Bounced (No Rep Effort)",
  // Meetings
  "Internal Meeting",
  "Client Meeting (Check-In)",
  "Prospect Meeting",
  // Other
  "Other/Unclassified",
];

export function sortByEffortCategory<T extends { effort_source: string }>(
  rows: T[]
): T[] {
  return [...rows].sort((a, b) => {
    const ai = EFFORT_SOURCE_ORDER.indexOf(a.effort_source);
    const bi = EFFORT_SOURCE_ORDER.indexOf(b.effort_source);
    return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
  });
}
