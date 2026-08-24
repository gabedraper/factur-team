# Google Workspace ingest — what to set up

Factur Team needs to read billing-related mail, Chat and meeting transcripts to
build the client billing trail. This is what has to exist before any of that can
run. None of it can be created from the application side — it needs Google Cloud
console access and Workspace admin approval.

## Why a second service account

There is already an org-wide credential for another agent. This uses its own,
narrower one deliberately: Factur Team is a web application on the public
internet, and a credential that reads the whole domain's mail is a much larger
thing for it to hold than the Salesforce and QuickBooks syncs it holds today. If
this app is ever compromised, the blast radius should be billing correspondence
for a named list of people, not everything.

## 1. Create the service account

In a Google Cloud project:

1. Create a service account, e.g. `factur-team-ingest`.
2. Create a JSON key for it and keep it somewhere safe — it is a password.
3. Note its **numeric client ID** (not the email); the Workspace step needs it.

Enable these APIs on the project: **Gmail API**, **Google Chat API**,
**Google Drive API**.

## 2. Grant domain-wide delegation

Google Admin → Security → Access and data control → API controls → Domain-wide
delegation → Add new. Use the numeric client ID, and exactly these scopes:

| Scope | For |
| --- | --- |
| `https://www.googleapis.com/auth/gmail.readonly` | billing email |
| `https://www.googleapis.com/auth/chat.messages.readonly` | internal chat about clients |
| `https://www.googleapis.com/auth/drive.readonly` | Meet transcripts, which land in Drive as Docs |

All three are read-only. There is no scope here that can send, delete or modify
anything.

## 3. Who gets impersonated

Delegation grants the *ability* to impersonate anyone in the domain; the ingest
restricts itself to the list below, which is generated from the app — account
managers named on a current client, team leads, and finance. It is re-checked on
each run, so somebody who stops being an account manager stops being read.

Two of these are shared mailboxes rather than people:

- `operations@facturmfg.com`
- `facturcustomersuccess@facturmfg.com`

The current list is 22 accounts. `select * from get_ingest_accounts()` returns it.

## 4. Where the key goes

As a single environment variable in Vercel, `GOOGLE_INGEST_KEY`, holding the
JSON. Not in the repository.

## What gets stored, and what does not

`comm_messages` holds a subject and a short extract per message — not whole
bodies. Storing the full text of eighteen people's mail in this application is a
much larger promise than the billing trail needs, and it is not needed to answer
"when did anyone last chase this client, and what did they say".

If sentiment analysis later needs more than an extract, that is a decision to
take on its own merits rather than one that arrives by default.
