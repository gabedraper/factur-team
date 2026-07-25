# Team Learning Academy — Chrome Extension

A companion browser extension for the LMS: check your enrolled courses'
progress and file a bug report (with a screenshot of the current tab)
without leaving whatever page you're on.

## Load it locally

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this `chrome-extension/` folder.
4. Click the extension icon, then **Open Settings** and enter your LMS's
   URL (the same one you use to log in from the browser, e.g.
   `https://learn.example.com`).
5. Reopen the popup and log in with your LMS email/password.

## What it does

- **My Courses** — lists your enrollments with progress bars; clicking a
  course opens it on the LMS site.
- **Report a Bug** — capture a screenshot of the active tab, describe the
  issue, and send it. This reuses the LMS's existing bug-report email flow.

## How it talks to the LMS

The extension calls three routes added to the Next.js app under
`/api/extension/*`:

- `POST /api/extension/login` — exchanges email/password for a Supabase
  access token (the extension never talks to Supabase directly).
- `GET /api/extension/me` — returns the logged-in user's profile and
  course progress.
- `POST /api/extension/bug-report` — sends a bug report email, identical to
  the in-app "Report a Bug" widget.

Sessions are stored in `chrome.storage.local` and are not refreshed
automatically — when the access token expires you'll be prompted to log in
again.
