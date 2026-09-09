# Fixtur — how the build actually works

> **Scope warning — this is a partial read, and it is skewed old.**
>
> The Confluence `Services` space holds **between 261 and 320 pages**. This was
> written from about **79 of them** — roughly a quarter — and, worse, they are
> the *oldest* quarter. Confluence page ids rise over time; almost everything
> read here is under id 14,000,000 (2023 vintage). The space also contains a
> much newer tranche in the 340,000,000–420,000,000 range that was **not read**,
> including what look like the current system documents:
>
> - `Factur Platform — System Architecture Overview`, with numbered sections
>   1–8: Identity/Accounts/Authorization, Inbound Email Capture, Email Sorting
>   and State Machines, Outbound Send Pipeline, Contacts/Accounts/Data
>   Management, CRM and Enrichment Sync, AI Services, and Platform/
>   Observability/Infrastructure
> - `Public Database — System Documentation`, sections 1–6, including
>   **`Database — Amazon DocumentDB`** — which may well supersede the MySQL
>   Aurora described below
> - `deliverability_service — Design and Operations`, `Sequence machine
>   service`, `CSV Importer`, `Unsubscribe link`
> - `Network Architecture & Security Design`, `OpenVPN`, `Outlook email`,
>   `Outlook spam detectors`, `Outlook Admin accounts`
> - Per-service pages such as `Service factur-develop-main-api-listener`
>
> **Treat everything below as the 2023 design, not necessarily the current
> one.** Do not make decisions on it until the newer tranche is read.

---

## The shape of it

Fixtur is not one application. It is a small Angular app sitting on a Node API,
plus a fan of background services that pull data out of Salesforce and out of
email, push it through an AI classifier, and write conclusions back.

```
Salesforce ──▶ Salesforce import subsystem ──▶ MongoDB (tasks)
                                                   │
Gmail    ──▶ ┐                                     ▼
SendGrid ──▶ ├─▶ Email subsystem ──▶ Email Sorter ──▶ Task Service ──▶ AI subsystem
             ┘                                                            │
                                                                          ▼
                                          Gmail labels + Salesforce dispatch
```

Everything between the boxes is RabbitMQ, and every message follows the
**CloudEvents** standard.

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | Angular + TypeScript, Angular Material, Tailwind |
| Backend | Node.js + Express + TypeScript |
| Document store | MongoDB via Mongoose — tasks, imported Salesforce records |
| Relational store | MySQL on Aurora via Sequelize — reference data, SendGrid imports |
| Messaging | RabbitMQ, CloudEvents envelopes |
| Auth | AWS Cognito |
| Authorization | OPA / Rego (with an unresolved spike on Permify) |
| Files / static | S3 + CloudFront |
| Hosting | AWS Elastic Beanstalk |

**Version numbers in the docs disagree with each other.** One page says Angular
16, another 15.2.9. One says Node 16, another v18.14.0. Nothing records which is
current, so treat both as unreliable and check `package.json` before assuming.

---

## Authentication and the user model

Cognito is the whole identity story, and it is used in a specific way worth
knowing:

- **A Cognito user group *is* an organization.** There is no separate org table.
  Multi-tenancy is Cognito group membership.
- **Every profile field is a Cognito custom attribute**, prefixed `custom:`.
  This was deliberate — not predefining fields keeps the schema flexible — but
  it means the user profile is not queryable like a database and there is no
  referential integrity on it.
- Password rules are enforced by Cognito, not by the app. The frontend checks
  only that the fields are filled and that the two new-password boxes match.
- An admin resetting somebody's password does it **by impersonating a Cognito
  admin server-side** and setting a temporary password. The user must change it
  on first login.

### The user-facing pieces

- `settings/users` — the organization user list. First name, last name, email,
  status, actions. Sorting, paging and search are all **server-side**.
- Add user — fills basic profile + security profile + status, creates the
  Cognito user.
- Edit basic profile / edit security profile — two separate actions in the list
  (pencil icon and key icon).
- Security page in the profile menu — the user changes their own password.
- Sign out from either the top bar or the avatar dropdown; both land on login.

### Mailboxes

A **mailbox** is a Gmail address exclusively owned by one user. One user can
hold several; one mailbox can only be claimed by one user. A newly linked
mailbox is **not** validated — ownership has to be proven before it counts.
This is the join between a person and the email the pipeline reads.

---

## Salesforce import subsystem

Two services.

**`salesforce-importer`** (Node) exposes an HTTP API *to* Salesforce — Salesforce
pushes, Fixtur does not pull.

- `POST /token` with a shared API key returns a JWT. The key is a plain string
  held on both sides, with no rotation or format requirements documented.
- Data endpoints receive the payload and drop it straight into **S3**, then
  publish a RabbitMQ message pointing at the object.

**`salesforce-importer-processing`** picks that message up, fetches the object
from S3, transforms it, and **bulk-writes into MongoDB**. Splitting it this way
means a large import never sits in a request.

The import creates **tasks** in MongoDB. Those tasks are the unit of work for
everything downstream.

---

## Email subsystem

Gathers everything arriving from the Gmail and SendGrid APIs, filters it, and
hands it to Salesforce and the AI subsystem.

**SendGrid importer** — a scheduled job using axios. It asks SendGrid for
everything since the last successful run recorded in its logs, or the last 15
minutes if there is no such record. Messages land in a MySQL database named
`sendgrid_import` and go out on queue `email_events` (exchange `email_subsytem`,
spelled that way in the code).

**SendGrid Enrichment** — implements the **outbox pattern**. It consumes
`email_events`, calls the SendGrid API for the full detail of each message,
persists that to a table, and a separate job publishes the enriched events on an
interval to `email_status_to_sort`. The point of the outbox is that the database
write and the message publish can't disagree.

**Email Sorter** — sits between Gmail Enrichment and the Task Service. In on
`email_status_to_sort`, out on `email_status`, exchange
`gmail_listener_subsystem`. It normalises two different input shapes — Gmail API
messages and SendGrid messages — into one outbound format.

---

## Task Service

Three things in one deployable:

1. **Salesforce task listener** — the Salesforce importer writes tasks to
   MongoDB; at the point they're all in working memory, this forwards them
   downstream. It deliberately does *no* filtering or business logic beyond
   passing them on. The only recipient is the AI Service Chain.
2. **Email task listener** — the same, for email-originated tasks.
3. **Salesforce dispatch** — the write-back leg.

---

## AI subsystem

The interesting part, and the least finished.

1. A message arrives carrying a task ID.
2. The **ingestion service** loads that task and extracts the message body.
3. **Sentiment analysis** runs over it.
4. The task in MongoDB is **labelled with the outcome and a confidence level**.
5. That label drives action: emails get **labelled in the Gmail inbox** with a
   label corresponding to the confidence assessment.

### Known problems, from Fixtur's own improvement page

- **Logs are written into the task document in MongoDB**, not to a log table.
  You cannot report on it. The recommendation on file is a dedicated MySQL log
  table, structured fields (task ID, timestamp, action, sentiment, label), and a
  reporting service on top.
- Nothing records model, prompt or version alongside a classification, so a
  label cannot be traced back to what produced it.

---

## Analytics

The docs draw the distinction but don't say what's built:

- **Operational data** — real-time, generated by the services in the course of
  doing their work.
- **Analytic data** — collected across sources, then processed for insight.

No warehouse, tool or schema is named. Treat this as a stated intention rather
than a component.

---

## Reference data

Countries are stored in MySQL: ISO 3166 codes plus international dial-in codes,
seeded by a database migration from files attached to the page. Dial codes are
stored as **integers without the `+`**.

The page says *"Table name is ________________________"* — the blank was never
filled in.

---

## Authorization: unresolved

OPA/Rego is the documented approach. There is also a page `[SPIKE] Permify
Authorization` which is **nothing but four links** — the main site, the Node SDK,
a Postman collection and the enforcement docs. No findings, no recommendation, no
decision. Whether Fixtur ended up on OPA, on Permify, or on neither is not
recorded anywhere in this space.

---

## What the documentation is worth

There is a `Templates and examples` page that sets a real standard: every
functionality page should carry description, data and validations, page layouts,
and implementation notes split frontend/backend with tables and endpoints. Most
pages do not meet it.

Concretely, when reading these docs:

- **Message formats are missing.** Nearly every service page says "message
  structure:" and then holds the actual JSON in a code macro or an image. The
  shapes are not readable as text and several are empty.
- **Architecture is in Lucid diagrams**, embedded as images. The written text
  around them is often one paragraph.
- **Typos are load-bearing.** `email_subsytem` is the real exchange name.
  "Subsytem", "Frontent" and "Sengrid" appear throughout — search accordingly.
- Several pages are stubs or drafts that were never finished.

---

## Security: act on this

The page titled **"Accounts" (page id 5701646)** opens with *"DO NOT SHARE THIS
PAGE WITH ANYONE"* and then lists **live usernames and passwords in plaintext**
— Apollo, the Fixtur dev app at `app.fixtur.io`, Swagger, and several
application users.

They are not reproduced here and should not be copied anywhere else.

Recommended, in order:

1. **Rotate every credential on that page.** Anyone who has ever had read access
   to the space has had them, and Confluence page history keeps old versions
   even after an edit.
2. **Delete the page including its version history**, not just its contents.
3. Move the secrets to AWS Secrets Manager or SSM Parameter Store — the app is
   already on AWS, so this costs nothing new.
4. Audit who has access to the `Services` space.

Related: the Salesforce importer's `POST /token` authenticates on a **shared
static API key** with no rotation described. Worth checking whether that key is
also on the Accounts page.
