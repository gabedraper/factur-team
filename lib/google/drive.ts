import { tokenFor } from "./auth";

export type Transcript = {
  /** The Drive file id, which is stable and the same for everyone. */
  id: string;
  title: string;
  createdAt: Date;
  /** Everyone Google listed as a participant, by email where it has one. */
  attendees: string[];
  text: string;
  url: string;
};

async function call<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

/**
 * Meet transcripts one person can see.
 *
 * Google writes a recorded meeting's transcript into the organiser's Drive as
 * a Doc named "<meeting> - Transcript", inside a "Meet Recordings" folder. The
 * Meet API itself only reaches conferences the caller organised, so Drive is
 * the surface that actually holds them all -- anyone the transcript was shared
 * with can read it, which is usually everyone who was in the room.
 *
 * The text is exported rather than parsed: a transcript Doc is plain speaker
 * lines, so plain text is the whole content.
 */
export async function fetchTranscripts(
  actAs: string,
  sinceDays: number,
  cap = 120
): Promise<{ transcripts: Transcript[]; matching: number; hitCap: boolean }> {
  const token = await tokenFor("drive", actAs);
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString();

  const q =
    `name contains '- Transcript' and ` +
    `mimeType = 'application/vnd.google-apps.document' and ` +
    `createdTime > '${since}' and trashed = false`;

  const files: { id: string; name: string; createdTime: string }[] = [];
  let pageToken: string | undefined;
  do {
    const page = await call<{
      files?: { id: string; name: string; createdTime: string }[];
      nextPageToken?: string;
    }>(
      "https://www.googleapis.com/drive/v3/files?pageSize=100" +
        "&fields=nextPageToken,files(id,name,createdTime)" +
        "&includeItemsFromAllDrives=true&supportsAllDrives=true" +
        `&q=${encodeURIComponent(q)}` +
        (pageToken ? `&pageToken=${pageToken}` : ""),
      token
    );
    files.push(...(page.files ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);

  const matching = files.length;
  const wanted = files.slice(0, cap);
  const transcripts: Transcript[] = [];

  // Eight at a time: an export is a whole document, not a header read.
  const width = 8;
  for (let i = 0; i < wanted.length; i += width) {
    const batch = await Promise.all(
      wanted.slice(i, i + width).map(async (f) => {
        try {
          const [textRes, perms] = await Promise.all([
            fetch(
              `https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=text/plain`,
              { headers: { Authorization: `Bearer ${token}` } }
            ),
            call<{ permissions?: { emailAddress?: string }[] }>(
              `https://www.googleapis.com/drive/v3/files/${f.id}/permissions` +
                "?fields=permissions(emailAddress)&supportsAllDrives=true",
              token
            ).catch(() => ({ permissions: [] })),
          ]);
          if (!textRes.ok) return null;

          return {
            id: f.id,
            title: f.name.replace(/\s*-\s*Transcript\s*$/i, "").trim(),
            createdAt: new Date(f.createdTime),
            attendees: (perms.permissions ?? [])
              .map((p) => p.emailAddress?.toLowerCase())
              .filter((e): e is string => Boolean(e)),
            text: await textRes.text(),
            url: `https://docs.google.com/document/d/${f.id}/edit`,
          };
        } catch {
          return null;
        }
      })
    );
    transcripts.push(...batch.filter((t): t is Transcript => t !== null));
  }

  return { transcripts, matching, hitCap: matching > cap };
}

export type DriveHit = {
  id: string;
  title: string;
  mimeType: string;
  modifiedAt: string | null;
  owners: string[];
  url: string;
};

/**
 * Documents one person can reach, by full-text search.
 *
 * Drive's `fullText contains` covers the body of Docs and the extracted text of
 * PDFs, which is what makes this worth having over a name search -- people
 * remember what a document said far more reliably than what it was called.
 *
 * Scoped to whoever is asking, and Drive does the scoping: the token is theirs,
 * so a file nobody shared with them is not in the answer. That is the same
 * boundary they already live with, not a new one.
 */
export async function searchDrive(
  actAs: string,
  text: string,
  cap = 15
): Promise<DriveHit[]> {
  const token = await tokenFor("drive", actAs);
  // Drive's query language ends a string at an apostrophe, so one in a search
  // term would otherwise produce a syntax error rather than a result.
  const safe = text.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q = `fullText contains '${safe}' and trashed = false`;

  const page = await call<{
    files?: {
      id: string; name: string; mimeType: string; modifiedTime?: string;
      owners?: { emailAddress?: string }[];
    }[];
  }>(
    `https://www.googleapis.com/drive/v3/files?pageSize=${cap}` +
      "&fields=files(id,name,mimeType,modifiedTime,owners(emailAddress))" +
      "&includeItemsFromAllDrives=true&supportsAllDrives=true" +
      `&q=${encodeURIComponent(q)}`,
    token
  );

  return (page.files ?? []).map((f) => ({
    id: f.id,
    title: f.name,
    mimeType: f.mimeType,
    modifiedAt: f.modifiedTime ?? null,
    owners: (f.owners ?? []).map((o) => o.emailAddress ?? "").filter(Boolean),
    url: `https://drive.google.com/open?id=${f.id}`,
  }));
}

/** The text of one Doc, for when a search hit needs reading rather than listing. */
export async function fetchDocText(
  actAs: string,
  fileId: string,
  cap = 12000
): Promise<string> {
  const token = await tokenFor("drive", actAs);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text/plain`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    // Anything that is not a Google Doc cannot be exported this way. Say which
    // rather than returning an empty string that reads as an empty document.
    throw new Error(`Drive ${res.status}: this file cannot be read as text`);
  }
  return (await res.text()).slice(0, cap);
}
