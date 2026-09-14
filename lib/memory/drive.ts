import { tokenFor } from "@/lib/google/auth";
import { chunk, remember, forgetTail, syncState, markSynced } from "./store";

/*
 * Drive, one person at a time.
 *
 * Read as each member of staff through the same delegation the rest of the
 * Google code uses, and every file they can open is remembered with them in
 * its audience. A file shared with the whole company is reached through
 * everybody and ends up readable by everybody; one only they can see stays
 * theirs. Drive's own sharing is the permission model, copied rather than
 * reinterpreted.
 *
 * Only Google's own formats are read: Docs, Sheets and Slides export as text.
 * Uploaded PDFs and Office files need downloading and parsing, which is a
 * later feeder.
 */

const EXPORTABLE: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

/** Files per account per run, so one person's Drive cannot eat the whole run. */
const FILES_PER_RUN = 120;
/** Past this a sheet is data, not knowledge, and the rest is noise in search. */
const MAX_CHARS = 60_000;

type File = { id: string; name: string; mimeType: string; modifiedTime: string; owners?: { emailAddress?: string }[] };

async function list(token: string, since: string | null): Promise<File[]> {
  const q = [
    "trashed = false",
    `(${Object.keys(EXPORTABLE).map((m) => `mimeType = '${m}'`).join(" or ")})`,
    since ? `modifiedTime > '${since}'` : null,
  ].filter(Boolean).join(" and ");

  const files: File[] = [];
  let pageToken: string | undefined;
  do {
    const res = await fetch(
      "https://www.googleapis.com/drive/v3/files?pageSize=100&orderBy=modifiedTime" +
        "&fields=nextPageToken,files(id,name,mimeType,modifiedTime,owners(emailAddress))" +
        "&includeItemsFromAllDrives=true&supportsAllDrives=true" +
        `&q=${encodeURIComponent(q)}${pageToken ? `&pageToken=${pageToken}` : ""}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`Drive ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const page = (await res.json()) as { files?: File[]; nextPageToken?: string };
    files.push(...(page.files ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken && files.length < FILES_PER_RUN);

  return files.slice(0, FILES_PER_RUN);
}

async function exportText(token: string, file: File): Promise<string | null> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}/export?mimeType=${EXPORTABLE[file.mimeType]}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  return (await res.text()).slice(0, MAX_CHARS);
}

export async function syncDriveFor(email: string, deadline: number): Promise<{ files: number; passages: number; done: boolean }> {
  const account = email.toLowerCase();
  const state = await syncState("drive", account);
  let token: string;
  try {
    token = await tokenFor("drive", account);
  } catch (e) {
    await markSynced("drive", account, { error: e instanceof Error ? e.message : "no token" });
    return { files: 0, passages: 0, done: true };
  }

  let files: File[];
  try {
    files = await list(token, state.cursor);
  } catch (e) {
    await markSynced("drive", account, { error: e instanceof Error ? e.message : "listing failed" });
    return { files: 0, passages: 0, done: true };
  }

  let passages = 0;
  let newest = state.cursor;
  let read = 0;
  for (const file of files) {
    if (Date.now() > deadline) break;
    const text = await exportText(token, file);
    read++;
    // The cursor moves only past files actually read, so a file skipped for
    // time is picked up next run rather than lost behind the cursor.
    newest = file.modifiedTime;
    if (!text || text.trim().length < 80) continue;

    const pieces = chunk(text);
    passages += await remember(pieces.map((body, i) => ({
      source: "drive",
      sourceId: file.id,
      chunk: i,
      title: file.name,
      url: `https://drive.google.com/open?id=${file.id}`,
      author: file.owners?.[0]?.emailAddress ?? null,
      body,
      audience: [account],
      occurredAt: file.modifiedTime,
    })));
    await forgetTail("drive", file.id, pieces.length);
  }

  const done = read === files.length && files.length < FILES_PER_RUN;
  await markSynced("drive", account, { cursor: newest, passages, error: null });
  return { files: read, passages, done };
}
