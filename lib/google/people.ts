import { tokenFor } from "./auth";

export type Person = { googleId: string; email: string | null; name: string | null };

/**
 * Turn Google user ids into names.
 *
 * Chat identifies a sender as `users/110081219106234071392` and leaves the
 * display name empty on plenty of messages, so without this the trail says an
 * eighteen-digit number said the thing.
 *
 * `viewType=domain_public` is what makes this work without an administrator:
 * it returns only the fields the domain already publishes to its own members,
 * so an ordinary account can be impersonated for the lookup. The full view
 * would need admin rights and would return far more than a name.
 */
export async function lookUpPeople(
  ids: string[],
  actAs: string
): Promise<{ people: Person[]; problem: string | null }> {
  if (ids.length === 0) return { people: [], problem: null };

  let token: string;
  try {
    token = await tokenFor("directory", actAs);
  } catch (e) {
    return { people: [], problem: e instanceof Error ? e.message : "No directory token" };
  }

  const people: Person[] = [];
  let problem: string | null = null;

  // Six at a time: this is a handful of ids, not a sweep.
  const width = 6;
  for (let i = 0; i < ids.length; i += width) {
    const batch = await Promise.all(
      ids.slice(i, i + width).map(async (googleId): Promise<Person | null> => {
        try {
          const res = await fetch(
            `https://admin.googleapis.com/admin/directory/v1/users/${encodeURIComponent(
              googleId
            )}?projection=basic&viewType=domain_public`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          /*
           * A refusal about one id is not a problem with the connection.
           *
           * Chat apps post too -- the AR digest in Financial Ops Team is one --
           * and the directory has no person to return for them, answering 403
           * or 404 depending on the kind. Treated as an error, one bot on an
           * otherwise perfect sweep painted the whole account red with "the API
           * is switched off", which was plainly untrue.
           *
           * They are remembered as unknown instead, so the same handful of ids
           * are not asked about on every sweep. Only a failure that is about
           * the connection itself -- no token, rate limited, Google down --
           * is reported.
           */
          if (res.status === 403 || res.status === 404) {
            return { googleId, email: null, name: null };
          }
          if (!res.ok) {
            problem ??= `Directory ${res.status}: ${(await res.text()).slice(0, 160)}`;
            return null;
          }
          const u = (await res.json()) as {
            primaryEmail?: string;
            name?: { fullName?: string; givenName?: string; familyName?: string };
          };
          const name =
            u.name?.fullName ??
            [u.name?.givenName, u.name?.familyName].filter(Boolean).join(" ") ??
            null;
          return { googleId, email: u.primaryEmail ?? null, name: name || null };
        } catch {
          return null;
        }
      })
    );
    people.push(...batch.filter((p): p is Person => p !== null));
  }

  return { people, problem };
}
