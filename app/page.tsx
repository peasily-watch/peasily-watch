import Link from "next/link";
import { requireUser } from "@/lib/guard";
import { watchDb, type Wall, type Check, type Alert } from "@/lib/db";

export const dynamic = "force-dynamic";

const time = (d: string) => new Date(d).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
const ago = (d: string, now: string) => {
  const s = Math.max(0, Math.round((Date.parse(now) - Date.parse(d)) / 1000));
  return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};
// "oldest 26821 seconds" reads as "oldest 7 h 27 min"
const human = (t: string | null | undefined) =>
  (t ?? "").replace(/(\d+) seconds/g, (m, n) => {
    const s = Number(n);
    if (s < 90) return m;
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), min = Math.floor((s % 3600) / 60);
    return d ? `${d} d ${h} h` : h ? `${h} h ${min} min` : `${min} min`;
  });
const LEVEL: Record<string, string> = { critical: "Critical", "early warning": "Early warning", ok: "Fine", unknown: "Not known yet" };
const cls = (l: string) => l.replace(" ", "-");

// the first step from the runbook, shown on the card (the full page is "What to do")
const NEXT: Record<string, string> = {
  "db-backup": "Re-run the failed backup. Two nights missed: Sandeep at once.",
  "email-slow": "Wake the Email sender. Still waiting after 15 minutes: Sandeep.",
};

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

function Ring({ fine, warn, crit, total }: { fine: number; warn: number; crit: number; total: number }) {
  const C = 2 * Math.PI * 80, part = (n: number) => (total ? (n / total) * C : 0);
  const seg = (n: number, offset: number, color: string) =>
    n > 0 && <circle cx="100" cy="100" r="80" fill="none" stroke={color} strokeWidth="18" strokeDasharray={`${Math.max(part(n) - 4, 1)} ${C}`} strokeDashoffset={-offset} transform="rotate(-90 100 100)" />;
  return (
    <svg className="ring" viewBox="0 0 200 200" role="img" aria-label={`${fine} of ${total} checks fine, ${warn} warning, ${crit} critical`}>
      <circle cx="100" cy="100" r="80" fill="none" stroke="var(--raised)" strokeWidth="18" />
      {seg(fine, 0, "var(--good)")}
      {seg(warn, part(fine), "var(--warn)")}
      {seg(crit, part(fine) + part(warn), "var(--bad)")}
      <text x="100" y="98" textAnchor="middle" fontSize="44" fontWeight="800" fill="var(--ink)">{fine}/{total}</text>
      <text x="100" y="124" textAnchor="middle" fontSize="14" fill="var(--soft)">checks fine</text>
    </svg>
  );
}

function Tile({ title, big, small, level, children }: { title: string; big: string; small: string; level: Check["level"]; children?: React.ReactNode }) {
  return (
    <section className={`tile ${cls(level)}`}>
      <div className="t-head"><span>{title}</span><i>{LEVEL[level]}</i></div>
      <b>{big}</b>
      <small>{small}</small>
      {children}
    </section>
  );
}

function Problem({ a, title }: { a: Alert; title: string }) {
  const next = NEXT[a.check_key];
  return (
    <article className={`problem ${cls(a.level)}`}>
      <div className="p-top"><span>{LEVEL[a.level] ?? a.level}</span><span>since {time(a.opened_at)}</span></div>
      <h3>{title}</h3>
      <p>{human(a.detail)}</p>
      {next && <div className="p-next">Next: {next}</div>}
      <div className="p-actions">
        <Link href={`/runbook/${a.check_key}`}>What to do</Link>
        {a.seen_at
          ? <small>seen by {a.seen_by}</small>
          : <form action="/api/seen" method="post"><input type="hidden" name="id" value={a.id} /><button type="submit">Seen</button></form>}
      </div>
    </article>
  );
}

export default async function WallScreen({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const who = await requireUser();
  const { f } = await searchParams;
  const filter = f === "problems" || f === "fine" ? f : "all";
  const { data, error } = await watchDb().rpc("wall");
  if (error || !data) return <main className="wall"><p className="bad">The Watch database did not answer: {error?.message}</p></main>;
  const w = data as Wall;
  const s = w.snapshot?.data ?? null;
  const lv = (k: string): Check["level"] => w.checks.find((c) => c.key === k)?.level ?? "unknown";
  const worst = (...keys: string[]): Check["level"] => (["critical", "early warning", "unknown", "ok"] as const).find((l) => keys.some((k) => lv(k) === l)) ?? "ok";
  const titleOf = (k: string) => w.checks.find((c) => c.key === k)?.title ?? k;

  const open = w.alerts.filter((a) => !a.closed_at)
    .sort((x, y) => (x.level === "critical" ? 0 : 1) - (y.level === "critical" ? 0 : 1) || Date.parse(x.opened_at) - Date.parse(y.opened_at));
  const nCrit = w.checks.filter((c) => c.level === "critical").length;
  const nWarn = w.checks.filter((c) => c.level === "early warning").length;
  const nFine = w.checks.filter((c) => c.level === "ok").length;
  const nUnknown = w.checks.length - nCrit - nWarn - nFine;

  const lastHealth = w.health.at(-1);
  const q = s?.queues;
  const jobs = s?.jobs ?? [];
  const backup = w.checks.find((c) => c.key === "db-backup");

  // the tiles; a tile whose checks have a problem moves to "Needs action" (its alert card)
  const tiles = ([
    { level: worst("website-down", "website-slow"), node: (lvl: Check["level"]) => (
      <Tile key="web" title="Website" level={lvl} big={lastHealth?.status === 200 ? "Up" : lastHealth ? "Not answering" : "Not known yet"}
        small={lastHealth?.ms != null ? `${lastHealth.ms} ms · last check ${time(lastHealth.at)}` : "first check in a minute"}>
        <Spark values={w.health.map((h) => h.ms ?? 0)} warn={2000} />
      </Tile>) },
    { level: worst("db-connections", "watch-cannot-read"), node: (lvl: Check["level"]) => (
      <Tile key="conn" title="Database connections" level={lvl} big={s?.connections ? `${s.connections.total} of ${s.connections.max}` : "Not known yet"}
        small={s?.connections ? `${s.connections.active} working · ${s.connections.waiting_on_lock} waiting · longest ${s.connections.longest_s} s` : w.snapshot?.error ?? ""}>
        <Spark values={w.connections.map((c) => c.n)} max={s?.connections?.max} warn={s?.connections ? s.connections.max * 0.8 : undefined} />
      </Tile>) },
    { level: worst("db-blocking", "db-long-query", "db-open-change", "db-deadlock"), node: (lvl: Check["level"]) => (
      <Tile key="block" title="Blocked work" level={lvl} big={(w.checks.find((c) => c.key === "db-blocking")?.detail ?? "Not known yet").replace(/^none$/, "None")}
        small={human(w.checks.find((c) => c.key === "db-long-query")?.detail)} />) },
    { level: worst("email-slow", "email-failed", "telegram-stuck", "phone-alerts-stuck"), node: (lvl: Check["level"]) => (
      <Tile key="msg" title="Messages waiting" level={lvl} big={q ? `${q.email.waiting + q.telegram.waiting + q.phone.waiting}` : "Not known yet"}
        small={q ? `email ${q.email.waiting} · Telegram ${q.telegram.waiting} · phone ${q.phone.waiting} · failed emails ${q.email.failed_last_hour} this hour` : ""} />) },
    { level: "ok", node: (lvl: Check["level"]) => (
      <Tile key="pos" title="Counters billing" level={lvl} big={s?.pos ? `${s.pos.counters_billing_last_30_min} of ${s.pos.counters}` : "Not known yet"}
        small={s?.pos ? `${s.pos.bills_last_30_min} bills in the last 30 minutes` : ""} />) },
    { level: worst("job-failed", "job-missed"), node: (lvl: Check["level"]) => (
      <Tile key="jobs" title="Background jobs" level={lvl} big={jobs.length ? `${jobs.filter((j) => j.last_status === "succeeded").length} of ${jobs.length} fine` : "Not known yet"}
        small={w.checks.find((c) => c.key === "job-failed")?.detail ?? ""} />) },
    { level: backup?.level ?? "unknown", node: (lvl: Check["level"]) => (
      <Tile key="backup" title="Nightly backup" level={lvl} big={backup?.level === "ok" ? "Done" : backup?.level === "critical" ? "Failed" : "Not known yet"} small={backup?.detail ?? ""} />) },
    { level: worst("watch-cannot-read"), node: (lvl: Check["level"]) => (
      <Tile key="db" title="Database" level={lvl} big={s?.database ? `${(s.database.size_bytes / 1048576).toFixed(0)} MB` : "Not known yet"}
        small={s?.database ? `cache hits ${s.database.cache_hit_pct}%` : ""} />) },
  ] as { level: Check["level"]; node: (l: Check["level"]) => React.ReactNode }[]).map((t) => ({ level: t.level, node: t.node(t.level) }));
  const calm = tiles.filter((t) => t.level === "ok" || t.level === "unknown");

  const order = { critical: 0, "early warning": 1, unknown: 2, ok: 3 } as const;
  const rows = [...w.checks]
    .sort((x, y) => order[x.level] - order[y.level] || x.title.localeCompare(y.title))
    .filter((c) => filter === "all" || (filter === "problems" ? c.level === "critical" || c.level === "early warning" : c.level === "ok"));

  return (
    <main className="wall">
      <meta httpEquiv="refresh" content="30" />

      <header className={`health ${nCrit ? "critical" : nWarn ? "early-warning" : "ok"}`}>
        <Ring fine={nFine} warn={nWarn} crit={nCrit} total={w.checks.length} />
        <div className="h-text">
          <h1>Peasily Watch</h1>
          <span className="muted">app.hawksdynamics.com · updated {w.snapshot ? ago(w.snapshot.at, w.now) : "never"} · refreshes every 30 seconds</span>
          <div className="legend">
            <span><i className="dot critical" />{nCrit} critical</span>
            <span><i className="dot early-warning" />{nWarn} warning</span>
            <span><i className="dot" />{nFine} fine</span>
            {nUnknown > 0 && <span><i className="dot unknown" />{nUnknown} not known yet</span>}
          </div>
        </div>
        <div className="who muted">Signed in as<b>{who}</b></div>
      </header>

      <div className="split">
        <aside className="rail" aria-label="Needs action">
          <div className="sec-head"><h2>Needs action</h2><span className="muted">most urgent first</span></div>
          {open.length === 0 && <div className="all-clear">Nothing needs action. All checks are fine.</div>}
          {open.map((a) => <Problem key={a.id} a={a} title={titleOf(a.check_key)} />)}
        </aside>

        <div className="rest">
          <div className="sec-head"><h2>Everything else</h2><span className="good-text">{calm.length} tiles calm</span></div>
          <div className="tiles">{calm.map((t) => t.node)}</div>

          <section className="card">
            <div className="sec-head">
              <h2>Every check</h2>
              <nav className="filter" aria-label="Filter checks">
                <Link href="/" className={filter === "all" ? "on" : ""}>All</Link>
                <Link href="/?f=problems" className={filter === "problems" ? "on" : ""}>Problems</Link>
                <Link href="/?f=fine" className={filter === "fine" ? "on" : ""}>Fine</Link>
              </nav>
            </div>
            <div className="checks">
              {rows.map((c) => (
                <div key={c.key} className="row"><i className={`dot ${cls(c.level)}`} /><Link href={`/runbook/${c.key}`}>{c.title}</Link><small>{human(c.detail)}</small></div>
              ))}
              {rows.length === 0 && <p className="muted">No checks here.</p>}
            </div>
          </section>

          {(s?.slowest?.length ?? 0) > 0 && (
            <section className="card">
              <h2>Slowest work (average)</h2>
              {s!.slowest!.slice(0, 8).map((x) => <div key={x.what} className="row plain"><span>{x.what}</span><small>{x.mean_ms} ms · {x.calls} calls</small></div>)}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}