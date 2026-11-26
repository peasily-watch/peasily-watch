# Peasily Watch

Watches app.hawksdynamics.com from its own accounts (GitHub and Supabase: support@peasily.com; Vercel: dynamicshawks@gmail.com). Read-only towards production.

- `supabase/watch.sql`: Watch's own database. Every minute it reads production's health
  (dblink to `watch.snapshot()` with the `peasily_watch` login), the website's `/api/health`,
  and GitHub's backup and test runs; it opens and closes alerts and sends Telegram and email.
  Alerts keep working even when this website is down.
- `app/`: the wall screen (sign-in with one passcode), "Seen" to stop repeats, runbooks read
  live from the Peasily repository.
- Set-up: see `GUIDE.md`.

No password, key or connection string is ever written in this repository.
