# Google Workspace ingest — setup walkthrough

Factur Team needs to read billing-related mail, Chat and meeting transcripts to
build the client billing trail. None of this can be created from the application
side: it needs Google Cloud console access and Workspace admin approval.

Roughly 20 minutes. Steps 1–5 are in Google Cloud, step 6 is in Google Admin,
step 7 is in Vercel.

## The three ideas, in plain terms

**Service account** — a login for a program rather than a person. It has an
email address and a key file instead of a password, and nobody signs in as it.

**Domain-wide delegation** — permission for that program to act *as* your staff
when it calls Google. Without it a service account can only see its own empty
mailbox. With it, it can read mail as Brenolene, as an account manager, and so
on. This is the step that needs a Workspace admin, and it is the one worth
being careful about.

**Scopes** — the specific things it may do. Ours are all `readonly`. There is no
scope here that can send, delete or change anything.

## Why a second service account

There is already an org-wide credential for another agent. This one is separate
and narrower on purpose. Factur Team is a web application on the public
internet; a credential that reads the whole domain's mail is a much larger thing
for it to hold than the Salesforce and QuickBooks syncs it holds today. If this
app is ever compromised, the damage should be billing correspondence for a named
list of people rather than everything.

---

## 1. Pick or create a Google Cloud project

<https://console.cloud.google.com/projectcreate>

Reuse the project the other agent uses if you prefer — the projects can be
shared, it is the *service account* that should not be. Name it something you
will recognise in a year, e.g. `factur-team`.

## 2. Turn on the three APIs

APIs & Services → Library, search for and Enable each:

- **Gmail API**
- **Google Chat API**
- **Google Drive API**

Enabling an API only makes it available to the project. It grants no access to
anything on its own.

## 3. Create the service account

IAM & Admin → Service Accounts → **Create service account**

- Name: `factur-team-ingest`
- Skip the optional "grant this service account access to the project" step —
  it needs no project roles, only the delegation in step 6.

## 4. Create its key

Open the new service account → **Keys** → Add key → Create new key → **JSON**.

A `.json` file downloads. **This file is a password.** Anyone holding it can do
everything the account is allowed to do. Do not email it, do not put it in
ClickUp, and do not paste it into a chat window — including to me. It goes
straight into Vercel in step 7 and nowhere else.

## 5. Copy the numeric client ID

On the same service account, **Details** → Advanced settings → **Client ID**.
It is a long number, around 21 digits. Not the email address — the next step
will not accept the email.

## 6. Grant domain-wide delegation

Google Admin → Security → Access and data control → **API controls** →
Domain-wide delegation → **Add new**

- Client ID: the number from step 5
- OAuth scopes: paste all six, comma separated, exactly as written:

```
https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/gmail.compose,https://www.googleapis.com/auth/chat.spaces.readonly,https://www.googleapis.com/auth/chat.messages.readonly,https://www.googleapis.com/auth/drive.readonly,https://www.googleapis.com/auth/admin.directory.user.readonly
```

A typo here fails in an unhelpful way — Google reports "unauthorized_client"
rather than naming the bad scope — so it is worth pasting rather than typing.

### The one scope that is not readonly

`gmail.compose` is the exception to everything said above, and it is there for
one feature: collections. It lets the app put a chase email into Brenolene's
mailbox, either as a draft for her to read and send, or sent outright when
collections is switched to full auto. It covers both, which is why there is one
new scope here rather than two.

It is worth being deliberate about. Every other scope in this list can only
read; this one can put a message in front of a customer under a member of
staff's name. Three things hold it in:

- The app only ever composes as the address in `collections_settings.send_as`.
- The recipient is never taken from the browser. It is the billing address on
  that client's last QuickBooks invoice, decided on the server.
- Nothing is due to anybody until a step in the sequence is switched on, and
  every step ships switched off.

If you would rather not grant it at all, everything else in collections still
works — the queue, the wording, the schedule. The Draft button is the only part
that fails, and it says exactly this when it does.

## 7. Put the key into Vercel

Vercel → the `factur-team` project → Settings → Environment Variables → Add

- Name: `GOOGLE_INGEST_KEY`
- Value: the entire contents of the JSON file, pasted as one line
- Environments: Production (and Preview if you want it to work there)

Then redeploy, since environment variables are read at build time.

## What happens after

The ingest confines itself to the accounts `get_ingest_accounts()` returns —
account managers named on a current client, team leads, and finance. That is 22
accounts today, and it is recalculated on every run, so somebody who stops being
an account manager stops being read without anyone remembering to remove them.

Delegation grants the ability to impersonate the whole domain. The restraint is
in the code, not in Google's settings, which is worth knowing: it means the list
is auditable and reviewable in one place, and it also means the setting itself is
broader than what is used.

`comm_messages` stores a subject and a short extract per message, not whole
bodies. Storing the full text of eighteen people's mail in this application is a
much larger promise than the billing trail needs.

## If it does not work

- **`unauthorized_client`** — the scopes in step 6 do not match exactly, or you
  used the service account's email rather than its numeric client ID.
- **`Precondition check failed`** — the account being impersonated does not
  exist, or is suspended.
- **Chat returns nothing** — the Chat API only returns spaces the impersonated
  person is actually a member of. It is not an error; it means that person is
  not in the space you expected.
