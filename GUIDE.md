# Peasily Watch: set-up guide

**For:** Manish (most steps) and Sandeep (the steps marked **SANDEEP ONLY**).
**Time:** about one working day. Every step ends with **Expected**: check that you see it before going on.

Peasily Watch watches app.hawksdynamics.com from **its own accounts**: GitHub, Supabase, Telegram and email under
**support@peasily.com**; Vercel under **dynamicshawks@gmail.com** (the Vercel account that hosts the website).
It only **reads** production, through four doors that Sandeep opens himself:

| Door | Who sets it | Where it is kept |
|---|---|---|
| `peasily_watch` database login (it can only call `watch.snapshot()`) | Sandeep | Watch's Supabase Vault: `prod_watch_url` |
| `app.hawksdynamics.com/api/health` | nobody (it is public) | Watch settings |
| GitHub read-only token (Actions and Contents: read, one repository) | Sandeep | Watch Vault `github_token` and Vercel `GITHUB_TOKEN` |
| Watch's own keys (Telegram, email, its own database) | Manish | Watch Vault and Vercel |

**Rules (from CLAUDE.md):** Manish never sees a production password, key or connection string.
No password goes in chat, email, a file or the code: only the password manager, the Vault and Vercel settings.
Turn on two-step sign-in (authenticator app) on every account.

---

## Part 1 · Manish: the accounts (morning)

### 1. GitHub
1. Sign up at github.com with **support@peasily.com**. Turn on two-step sign-in (Settings → Password and authentication).
2. Create an **organisation** (top right + → New organization → Free): name `peasily-watch`.
3. Organisation → People → Invite member: **HawksSandeep**, role **Owner**.
4. Create a **private** repository in it: `peasily-watch`.
5. Upload the code: unzip `peasily-watch.zip`, then in that folder:
   ```
   git init
   git add .
   git commit -m "Peasily Watch 1"
   git branch -M main
   git remote add origin https://github.com/peasily-watch/peasily-watch.git
   git push -u origin main
   ```
**Expected:** the repository shows `app/`, `lib/`, `supabase/watch.sql`, `GUIDE.md`. Sandeep sees an invitation as Owner.

### 2. Supabase (Watch's own database)
1. Sign up at supabase.com with **support@peasily.com** (email, not GitHub). Two-step sign-in on.
2. New organisation: `Peasily Watch`, Free plan. Organisation settings → Team → Invite: **gosainsandeep8@gmail.com** as **Owner**.
3. New project: name `peasily-watch`, region **Mumbai (ap-south-1)**, a long database password saved in the password manager.
4. Database → Extensions: switch on **pg_cron**, **pg_net**, **dblink** (Vault is already on).
5. SQL Editor → New query → paste all of `supabase/watch.sql` → Run.
**Expected:** "Success" with one result `schedule 1`. Table Editor → schema `watch` shows 5 tables.
6. Project Settings → API keys: note the **Project URL** and the **secret key** (`sb_secret_...`) in the password manager (they are Watch's own, for step 5).

### 3. Telegram (the alerts)
1. In Telegram open **@BotFather** → `/newbot` → name `Peasily Watch` → username e.g. `peasily_watch_bot`. Save the **bot token** in the password manager.
2. Create a group `Peasily Watch alerts`. Add Sandeep, yourself and the bot.
3. Send "hello" in the group. Open in a browser: `https://api.telegram.org/bot<BOT TOKEN>/getUpdates`
   and find `"chat":{"id":-100...` . That number (with the minus) is the **chat id**.
**Expected:** a chat id that starts with `-`.

### 4. Email (Resend, free 3,000 a month)
1. Sign up at resend.com with **support@peasily.com** (alerts land in that mailbox too).
2. Domains → Add `peasily.com` → add the DNS records it shows where peasily.com's DNS is managed (ask Sandeep where).
3. API keys → Create (Sending access) → save it.
**Expected:** the domain shows **Verified** (can take up to an hour). Until then email is skipped; Telegram still works.

### 5. Watch's own keys into the Vault
Supabase (Watch project) → **Integrations → Vault → Add new secret** (use this screen, not the SQL Editor, so nothing stays in query history). Add exactly these names:

| Name | Value |
|---|---|
| `telegram_bot_token` | the bot token |
| `telegram_chat_id` | the chat id (with the minus) |
| `resend_api_key` | the Resend key |

**Expected:** 3 secrets listed. Within 2 minutes the Telegram group gets a 🔴 message "Watch can read the Peasily database" (it cannot yet: that is Sandeep's door, Part 3). That proves Telegram works.

---

## Part 2 · Manish: the website (afternoon)

### 6. Vercel
1. Sign in at vercel.com with **dynamicshawks@gmail.com** (the account that hosts the website; Sandeep has its login). Two-step sign-in on.
2. Let Vercel read the code: Add New → Project → Import Git Repository → **Add GitHub Account / Install** → choose the `peasily-watch` organisation → **Only select repositories** → `peasily-watch`. (A GitHub owner of that organisation approves it: you or Sandeep.)
3. Import `peasily-watch/peasily-watch` as a **new project** named `peasily-watch`. Framework: Next.js (found by itself). Do not touch the website's project.
4. Environment variables (Production), in the **peasily-watch** project only:

| Name | Value | Who |
|---|---|---|
| `WATCH_SUPABASE_URL` | Watch's Project URL (step 2.6) | Manish |
| `WATCH_SUPABASE_SECRET_KEY` | Watch's secret key (step 2.6) | Manish |
| `WATCH_PASSWORD` | a long passcode for the wall screen; save it in the password manager and share it with Sandeep there | Manish |
| `GITHUB_REPO` | `HawksSandeep/hawks-dynamics-Prod` | Manish |
| `GITHUB_TOKEN` | leave out for now | **Sandeep** (Part 3) |

5. Deploy.
**Expected:** the vercel.app address opens the Peasily Watch sign-in. Sign in with your name and the passcode: the wall shows tiles, most "Not known yet", and an open alert "Watch can read the Peasily database".

6. Domains: Project → Settings → Domains → add `watch.peasily.com`. Add the CNAME record it shows (`cname.vercel-dns.com`) where peasily.com's DNS is managed. Sandeep adds `watch.hawksdynamics.com` the same way on his domain.
**Expected:** both addresses open the sign-in with a padlock.

**Note:** Sandeep already owns the dynamicshawks@gmail.com login, so he has full access to Vercel (and is an Owner in GitHub and Supabase). Watch is a separate project there: it never changes the website's project or settings.

### 7. Tell Sandeep: "Ready for Part 3".

---

## Part 3 · SANDEEP ONLY: open the doors to production

### S1. Apply d381 to production
```
.\go.ps1 d381
```
**Expected:** dry run lists only `20261215000100_peasily_watch_snapshot.sql`; after Y, the check prints ALL CHECKS OK.

### S2. Give the `peasily_watch` login a password
Production Supabase (gosainsandeep8 account) → SQL Editor:
```
alter role peasily_watch login password '<a long new password>';
```
Save the password in the password manager. **Expected:** "Success. No rows returned".

### S3. Put the connection into Watch's Vault
Watch Supabase → Integrations → Vault → Add new secret, name **`prod_watch_url`**, value:
```
postgresql://peasily_watch.hpettlcmkzrslkskwdoh:<THE PASSWORD>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require
```
**Expected:** within 2 minutes Telegram says 🟢 "Fine again · Watch can read the Peasily database", and the wall shows connections, queues and jobs.

### S4. GitHub read-only token
github.com (HawksSandeep) → Settings → Developer settings → Personal access tokens → **Fine-grained** → Generate:
- Repository access: **Only** `hawks-dynamics-Prod`
- Permissions: **Actions: Read**, **Contents: Read** (Metadata: Read comes by itself)
- Expiration: 1 year (put a reminder 2 weeks before)

Put it in **two** places: Watch Vault as **`github_token`**, and Vercel → `GITHUB_TOKEN`, then Redeploy.
**Expected:** within 10 minutes the "Nightly backup" tile shows the last run; "What to do" opens the runbook text.

---

## Part 4 · Manish: test day (with expected results)

1. **A test alert.** Watch SQL Editor:
   ```
   select watch.set_check('test-alert', 'Test alert', 'critical', 'TEST - please ignore');
   ```
   **Expected:** within 1 minute Telegram 🔴 and one email; the wall's top bar turns red.
2. **The repeat.** Wait 5 minutes. **Expected:** 2 more Telegram messages ("repeat 2", "repeat 3").
3. **Seen.** Press **Seen** on the wall. **Expected:** no more repeats; the alert shows "seen by Manish".
4. **Close it.** Watch SQL Editor:
   ```
   select watch.set_check('test-alert', 'Test alert', 'ok', 'test finished');
   ```
   **Expected:** within 1 minute Telegram 🟢 "Fine again · Test alert".
5. **Website down (safe test).** Watch SQL Editor:
   ```
   update watch.settings set value = 'https://app.hawksdynamics.com/api/health-test-404' where key = 'health_url';
   ```
   **Expected:** after 2 to 3 minutes 🔴 "app.hawksdynamics.com answers". Then put it back:
   ```
   update watch.settings set value = 'https://app.hawksdynamics.com/api/health' where key = 'health_url';
   ```
   **Expected:** 🟢 within 3 minutes.
6. **Runbooks.** Open three checks from "Every check" → **What to do**. **Expected:** each shows its page (Check first, Fix, Never, Escalate).
7. **Phone and wall.** Open watch.peasily.com on a phone and on a TV/laptop full screen. **Expected:** readable, refreshes every 30 seconds.
8. Send Sandeep: screenshots of steps 1, 3, 4 and the wall.

---

## What Watch checks today (version 1)

Website up and speed · database connections · blocked and long-running work · sessions left open ·
deadlocks · emails waiting and failed · Telegram and phone alerts waiting · background jobs failed or missed ·
nightly backup · Watch itself can read the database.

**Coming next:** crash reports from the phone app, server CPU, memory and disk (needs the metrics key),
sign-in failures, POS counters gone quiet, outlets without a day closing, automatic agents.

## If something goes wrong
- Telegram silent: check the 3 Vault names are spelled exactly; `select * from net._http_response order by created desc limit 5;` shows Telegram's answer.
- "Watch can read" stays red: S2 and S3 (password, and the user written as `peasily_watch.hpettlcmkzrslkskwdoh`).
- Free Supabase projects can be paused after 7 quiet days: opening the wall screen once a week, or the Pro plan, keeps it awake.
- Re-running `supabase/watch.sql` after an update is safe: it keeps data and the one-minute job.

---

## Version 2 · History and Settings pages (one-time update)

1. **Watch Supabase → SQL Editor → New query →** paste the whole `supabase/watch.sql` → **Run**.
   It is safe to re-run: data and settings are kept. **Expected:** "Success".
2. Push the code (Vercel redeploys by itself). **Expected:** the wall has a menu **Wall · History · Settings**.
3. **Do not tick functions** under Integrations → Data API → Exposed functions. That gives the public key access.
   The website uses the secret key, which `watch.sql` already allows.
4. Check that the public key has no access (both must be `false`):
   ```
   select has_function_privilege('anon','watch.history(int)','execute'),
          has_function_privilege('anon','watch.set_setting(text,text,text)','execute');
   ```

What it adds: alert history (7, 30 or 90 days); settings for the repeat time, a reminder every few hours for
an alert that was seen but not fixed, and a daily "Watch is alive" Telegram message (on at 9 am by default;
if it does not arrive, Watch has stopped). Every settings change is recorded with the name of who made it.
