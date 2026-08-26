// The five counted lines on the leaderboard blurb, and which raw effort source
// feeds each. Shared by the board and the activities screen so the aggregate at
// the top of that screen is the same arithmetic, not a second version of it.
//
// Anything not listed here (internal meetings, no-effort rows) is deliberately
// absent: it scores nothing. The activities screen still shows those rows --
// they are the ones people come to correct.
export const BUCKETS = [
  "Calls",
  "Manual Emails",
  "Automated Emails",
  "Client Meetings",
  "Prospect Meetings",
] as const;

export type Bucket = (typeof BUCKETS)[number];

export const BUCKET_FOR_SOURCE: Record<string, Bucket> = {
  "Manual Call": "Calls",
  "Automated Call (Power Dialer)": "Calls",
  "Automated Call (Parallel Dialer)": "Calls",
  "Manual SMS": "Calls",
  "Sequence Email (Automated Send)": "Automated Emails",
  "Manual Email": "Manual Emails",
  "Client Meeting (Check-In)": "Client Meetings",
  "Prospect Meeting": "Prospect Meetings",
};

export function emptyCounts(): Record<Bucket, number> {
  return {
    Calls: 0,
    "Manual Emails": 0,
    "Automated Emails": 0,
    "Client Meetings": 0,
    "Prospect Meetings": 0,
  };
}
