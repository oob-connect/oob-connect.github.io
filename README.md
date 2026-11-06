# Classroom Chat

A lightweight group-chat for classrooms. One **admin** account (you) creates
rooms; everyone else signs up, signs in, and posts messages. Built as plain
**HTML + CSS + vanilla JavaScript** (no framework, no build step) on top of
**Supabase** for auth, data, and realtime.

## How it works

- **Auth** — Supabase email/password. Every signed-in user gets a `profiles`
  row automatically (via a database trigger).
- **Rooms** — only an admin can create or delete rooms. This is enforced in the
  database with Row-Level Security, so it holds even if someone bypasses the UI
  and calls the API directly. The "New room" button is only shown to admins as
  a convenience.
- **Messages** — any signed-in user can post into any room. You can delete your
  own messages; an admin can delete anyone's.
- **Realtime** — new messages (and new rooms) appear instantly for everyone
  through Supabase Realtime.

## Setup

### 1. Create the database

In your Supabase project, open the **SQL editor** and run:

1. `supabase/migrations/0001_init.sql` — tables, triggers, RLS, realtime.

### 2. Make yourself the admin

1. Start the app (next step) and **sign up once** with the email you want to be
   the master/admin account.
2. Edit `supabase/make_admin.sql`, replace `you@school.edu` with that email, and
   run it in the SQL editor. That account can now create rooms.

> Tip: for quick testing, disable email confirmation in Supabase under
> **Authentication → Providers → Email** so new sign-ups are usable immediately.

### 3. Configure the frontend

Edit `config.js` and paste your project's **URL** and **anon/public key** from
**Settings → API**, then commit it. The anon key is meant to be public — your
data is protected by RLS, not by hiding the key. Never put the `service_role`
key or your database password here.

### 4. Deploy to GitHub Pages

This is a static site with no build step, so GitHub Pages serves it directly.

**Automatic (included workflow):** `.github/workflows/deploy-pages.yml` deploys
the repo on every push to the default branch. Enable it once:

1. Push this repo to GitHub.
2. Go to **Settings → Pages → Build and deployment** and set **Source** to
   **GitHub Actions**.
3. Push to the default branch (or run the workflow manually). Your site appears
   at `https://<your-user>.github.io/<repo>/`.

Then, in Supabase under **Authentication → URL Configuration**, set the **Site
URL** (and add a redirect URL) to your Pages URL so email confirmation links
point back to the deployed site.

**Local preview** (optional, no Python needed) — any static server works, e.g.:

```bash
npx serve .
```

or use the VS Code "Live Server" extension.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | Page markup (auth view + app shell) |
| `styles.css` | Dark, utility-grade theme |
| `app.js` | All client logic: auth, rooms, messages, realtime |
| `config.js` | Your Supabase URL + anon key (committed, served to the browser) |
| `config.example.js` | Reference template for `config.js` |
| `supabase/migrations/0001_init.sql` | Schema, RLS policies, realtime |
| `supabase/make_admin.sql` | Promote your account to admin |
| `supabase/optional_retention.sql` | Optional: auto-delete old messages (storage housekeeping) |
| `.github/workflows/deploy-pages.yml` | Auto-deploy to GitHub Pages |

## Security notes

- The anon key is meant to be public; safety comes from RLS policies, not from
  hiding the key. Review `supabase/migrations/0001_init.sql` to see exactly what
  each role can do.
- User-supplied text (names, messages) is HTML-escaped before it is inserted
  into the page, so message content cannot inject markup.
- `config.js` is committed on purpose (GitHub Pages needs it) and contains only
  the public anon key. Never put the `service_role` key or database password in
  it or anywhere in the repo. If either is ever exposed, rotate it in the
  Supabase dashboard.
