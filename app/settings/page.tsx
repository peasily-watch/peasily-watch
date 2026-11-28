import { requireUser } from "@/lib/guard";
import { watchDb, type WatchSettings } from "@/lib/db";
import { Nav } from "../nav";

export const dynamic = "force-dynamic";

const when = (d: string) => new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
const hourLabel = (h: number) => (h === 0 ? "12 am" : h === 12 ? "12 pm" : h > 12 ? `${h - 12} pm` : `${h} am`);
const NAMES: Record<string, string> = { repeat_minutes: "Repeat every", remind_seen_hours: "Reminder after Seen", alive_daily: "Daily message", alive_hour: "Daily message time" };
const show = (key: string, v: string | null) =>
  v == null ? "—" : key === "repeat_minutes" ? `${v} min` : key === "remind_seen_hours" ? (v === "0" ? "off" : `${v} h`) : key === "alive_hour" ? hourLabel(Number(v)) : v;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; err?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const { data, error } = await watchDb().rpc("get_settings");
  if (error || !data) {
    return (
      <main className="wall">
        <Nav active="settings" />
        <p className="bad">The Watch database did not answer: {error?.message}</p>
        <p className="muted">If it says the function was not found: re-run supabase/watch.sql in the Watch project (see GUIDE.md).</p>
      </main>
    );
  }
  const s = data as WatchSettings;
  const v = s.values;
  const rep = v.repeat_minutes ?? "2";
  const remind = v.remind_seen_hours ?? "0";
  const aliveOn = v.alive_daily === "on";
  const aliveHour = Number(v.alive_hour ?? "9");

  return (
    <main className="wall settings">
      <Nav active="settings" />
      <h1 className="page-title">Settings</h1>
      {sp.saved && <p className="notice good">Saved. Watch uses the new settings from its next minute.</p>}
      {sp.err && <p className="notice bad-box">Not saved: {sp.err}</p>}

      <form action="/api/settings" method="post" className="card form">
        <h2>Alerts</h2>
        <div className="set-row">
          <div><b>Repeat a critical alert every</b><small>until someone presses Seen</small></div>
          <div className="seg" role="radiogroup" aria-label="Repeat every">
            {["2", "5", "10", "15", "30"].map((m) => (
              <label key={m}><input type="radio" name="repeat_minutes" value={m} defaultChecked={rep === m} />{m} min</label>
            ))}
          </div>
        </div>
        <div className="set-row">
          <div><b>Remind about a seen but unfixed alert</b><small>so a "Seen" problem is not forgotten (critical alerts only)</small></div>
          <label className="sel">After
            <select name="remind_seen_hours" defaultValue={remind}>
              <option value="0">Off</option><option value="2">2 hours</option><option value="4">4 hours</option><option value="8">8 hours</option><option value="12">12 hours</option>
            </select>
          </label>
        </div>
        <div className="set-row">
          <div><b>Daily &quot;Watch is alive&quot; message</b><small>one Telegram message a day; if it does not come, Watch has stopped</small></div>
          <div className="inline">
            <label className="switch"><input type="checkbox" name="alive_daily" defaultChecked={aliveOn} /><span aria-hidden="true" /> On</label>
            <label className="sel">at
              <select name="alive_hour" defaultValue={String(aliveHour)}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={String(h)}>{hourLabel(h)}</option>)}
              </select>
            </label>
          </div>
        </div>
        <div className="form-actions"><button type="submit">Save settings</button></div>
      </form>

      <section className="card">
        <h2>Where alerts go</h2>
        <div className="conn-grid">
          <div className="conn"><div><b>Telegram</b><i className={s.connected.telegram ? "ok" : "no"}>{s.connected.telegram ? "Connected" : "Not set"}</i></div><small>every alert, with repeats and reminders</small></div>
          <div className="conn"><div><b>Email</b><i className={s.connected.email ? "ok" : "no"}>{s.connected.email ? "Connected" : "Not set"}</i></div><small>to {v.email_to ?? "—"} · from {v.email_from ?? "—"} · one per alert</small></div>
        </div>
      </section>

      <section className="card">
        <h2>What Watch reads</h2>
        <div className="kv">
          <span>Production database</span><span>{s.connected.production ? "connected · read-only login, every minute" : "not set (prod_watch_url)"}</span>
          <span>Website health</span><span>{v.health_url ?? "—"}</span>
          <span>Backups and runbooks</span><span>{v.github_repo ?? "—"} · {s.connected.github ? "token set" : "token not set"}</span>
          <span>Wall address in messages</span><span>{v.wall_url ?? "—"}</span>
        </div>
        <p className="muted small">Passwords and keys are never shown here. Change them in the Watch Vault or Vercel settings.</p>
      </section>

      <section className="card">
        <h2>Recent changes</h2>
        {s.changes.length === 0 && <p className="muted">No changes yet.</p>}
        {s.changes.map((c, i) => (
          <div key={i} className="row plain"><span><b>{NAMES[c.key] ?? c.key}</b>: {show(c.key, c.old_value)} → {show(c.key, c.new_value)} · by {c.changed_by}</span><small>{when(c.at)}</small></div>
        ))}
      </section>
    </main>
  );
}
