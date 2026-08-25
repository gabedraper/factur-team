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
