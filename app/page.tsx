import Link from "next/link";
import { requireUser } from "@/lib/guard";
import { watchDb, type Wall, type Check } from "@/lib/db";

export const dynamic = "force-dynamic";

const time = (d: string) => new Date(d).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
const ago = (d: string, now: string) => {
  const s = Math.max(0, Math.round((Date.parse(now) - Date.parse(d)) / 1000));
  return s < 90 ? `${s} seconds ago` : s < 5400 ? `${Math.round(s / 60)} minutes ago` : `${Math.round(s / 3600)} hours ago`;
};
const LEVEL: Record<string, string> = { critical: "Critical", "early warning": "Early warning", ok: "Fine", unknown: "Not known yet" };

// a small line for the last hour (one point a minute)
function Spark({ values, max, warn }: { values: number[]; max?: number; warn?: number }) {
  if (values.length < 2) return <div className="spark empty">Not enough minutes yet</div>;
  const W = 300, H = 56, top = Math.max(max ?? 0, ...values, 1);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${(H - (v / top) * (H - 4) - 2).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {warn !== undefined && warn < top && <line x1="0" x2={W} y1={H - (warn / top) * (H - 4) - 2} y2={H - (warn / top) * (H - 4) - 2} className="warnline" />}
      <polyline points={pts} />
    </svg>
  );
}

function Tile({ title, big, small, level, children }: { title: string; big: string; small: string; level: Check["level"]; children?: React.ReactNode }) {
  return (
    <section className={`tile ${level.replace(" ", "-")}`}>
      <div className="t-head"><span>{title}</span><i>{LEVEL[level]}</i></div>
      <b>{big}</b>
      <small>{small}</small>
      {children}
    </section>
  );
}

export default async function WallScreen() {
  const who = await requireUser();
  const { data, error } = await watchDb().rpc("wall");
  if (error || !data) return <main className="wall"><p className="bad">The Watch database did not answer: {error?.message}</p></main>;
  const w = data as Wall;
  const s = w.snapshot?.data ?? null;
  const lv = (k: string): Check["level"] => w.checks.find((c) => c.key === k)?.level ?? "unknown";
  const worst = (...keys: string[]): Check["level"] => (["critical", "early warning", "unknown", "ok"] as const).find((l) => keys.some((k) => lv(k) === l)) ?? "ok";
  const open = w.alerts.filter((a) => !a.closed_at);
  const crit = open.filter((a) => a.level === "critical").length;
  const lastHealth = w.health.at(-1);
  const q = s?.queues;
  const jobs = s?.jobs ?? [];
  const backup = w.checks.find((c) => c.key === "db-backup");
  return (
    <main className="wall">
      <meta httpEquiv="refresh" content="30" />
      <header className={`bar ${crit ? "critical" : open.length ? "early-warning" : "ok"}`}>
        <div><h1>Peasily Watch</h1><span className="muted">app.hawksdynamics.com · updated {w.snapshot ? ago(w.snapshot.at, w.now) : "never"}</span></div>
        <strong>{crit ? `${crit} critical` : open.length ? `${open.length} to look at` : "All fine"}</strong>
        <span className="muted">{who} · refreshes every 30 seconds</span>
      </header>

      <div className="tiles">
        <Tile title="Website" level={worst("website-down", "website-slow")} big={lastHealth?.status === 200 ? "Up" : lastHealth ? "Not answering" : "Not known yet"}
          small={lastHealth?.ms != null ? `${lastHealth.ms} ms · last check ${time(lastHealth.at)}` : "first check in a minute"}>
          <Spark values={w.health.map((h) => h.ms ?? 0)} warn={2000} />
        </Tile>
        <Tile title="Database connections" level={worst("db-connections", "watch-cannot-read")} big={s?.connections ? `${s.connections.total} of ${s.connections.max}` : "Not known yet"}
          small={s?.connections ? `${s.connections.active} working · ${s.connections.waiting_on_lock} waiting · longest ${s.connections.longest_s} s` : w.snapshot?.error ?? ""}>
          <Spark values={w.connections.map((c) => c.n)} max={s?.connections?.max} warn={s?.connections ? s.connections.max * 0.8 : undefined} />
        </Tile>
        <Tile title="Blocked work" level={worst("db-blocking", "db-long-query", "db-open-change", "db-deadlock")}
          big={(w.checks.find((c) => c.key === "db-blocking")?.detail ?? "Not known yet").replace(/^none$/, "None")}
          small={w.checks.find((c) => c.key === "db-long-query")?.detail ?? ""} />
        <Tile title="Messages waiting" level={worst("email-slow", "email-failed", "telegram-stuck", "phone-alerts-stuck")}
          big={q ? `${q.email.waiting + q.telegram.waiting + q.phone.waiting}` : "Not known yet"}
          small={q ? `email ${q.email.waiting} · Telegram ${q.telegram.waiting} · phone ${q.phone.waiting} · failed emails ${q.email.failed_last_hour} this hour` : ""} />
        <Tile title="Counters billing" level="ok" big={s?.pos ? `${s.pos.counters_billing_last_30_min} of ${s.pos.counters}` : "Not known yet"}
          small={s?.pos ? `${s.pos.bills_last_30_min} bills in the last 30 minutes` : ""} />
        <Tile title="Background jobs" level={worst("job-failed", "job-missed")}
          big={jobs.length ? `${jobs.filter((j) => j.last_status === "succeeded").length} of ${jobs.length} fine` : "Not known yet"}
          small={w.checks.find((c) => c.key === "job-failed")?.detail ?? ""} />
        <Tile title="Nightly backup" level={backup?.level ?? "unknown"} big={backup?.level === "ok" ? "Done" : backup?.level === "critical" ? "Failed" : "Not known yet"} small={backup?.detail ?? ""} />
        <Tile title="Database" level={worst("watch-cannot-read")} big={s?.database ? `${(s.database.size_bytes / 1048576).toFixed(0)} MB` : "Not known yet"}
          small={s?.database ? `cache hits ${s.database.cache_hit_pct}%` : ""} />
      </div>

      <div className="cols">
        <section className="card">
          <h2>Open now</h2>
          {open.length === 0 && <p className="muted">Nothing open.</p>}
          {open.map((a) => {
            const c = w.checks.find((x) => x.key === a.check_key);
            return (
              <div key={a.id} className={`alert ${a.level.replace(" ", "-")}`}>
                <div><b>{c?.title ?? a.check_key}</b><small>{a.detail} · since {time(a.opened_at)}{a.seen_by ? ` · seen by ${a.seen_by}` : ""}</small></div>
                <Link href={`/runbook/${a.check_key}`}>What to do</Link>
                {!a.seen_at && <form action="/api/seen" method="post"><input type="hidden" name="id" value={a.id} /><button type="submit">Seen</button></form>}
              </div>
            );
          })}
        </section>
        <section className="card">
          <h2>Every check</h2>
          {w.checks.map((c) => (
            <div key={c.key} className="row"><i className={`dot ${c.level.replace(" ", "-")}`} /><Link href={`/runbook/${c.key}`}>{c.title}</Link><small>{c.detail}</small></div>
          ))}
        </section>
      </div>
      {(s?.slowest?.length ?? 0) > 0 && (
        <section className="card">
          <h2>Slowest work (average)</h2>
          {s!.slowest!.slice(0, 8).map((x) => <div key={x.what} className="row"><span>{x.what}</span><small>{x.mean_ms} ms · {x.calls} calls</small></div>)}
        </section>
      )}
    </main>
  );
}
