import Link from "next/link";
import { requireUser } from "@/lib/guard";
import { watchDb, type History } from "@/lib/db";
import { Nav } from "../nav";

export const dynamic = "force-dynamic";

const when = (d: string) => new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
const dur = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
  return d ? `${d} d ${h} h` : h ? `${h} h ${min} min` : `${min} min`;
};
const human = (t: string | null) =>
  (t ?? "").replace(/(\d+) seconds/g, (m, n) => (Number(n) < 90 ? m : dur(Number(n) * 1000)));
const LEVEL: Record<string, string> = { critical: "Critical", "early warning": "Warning" };

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ f?: string; days?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const f = sp.f === "open" || sp.f === "closed" ? sp.f : "all";
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const { data, error } = await watchDb().rpc("history", { p_days: days });
  if (error || !data) {
    return (
      <main className="wall">
        <Nav active="history" />
        <p className="bad">The Watch database did not answer: {error?.message}</p>
        <p className="muted">If it says the function was not found: re-run supabase/watch.sql in the Watch project (see GUIDE.md).</p>
      </main>
    );
  }
  const h = data as History;
  const now = Date.parse(h.now);
  const open = h.alerts.filter((a) => !a.closed_at);
  const closed = h.alerts.filter((a) => a.closed_at);
  const longest = open.reduce<{ title: string; ms: number } | null>((best, a) => {
    const ms = now - Date.parse(a.opened_at);
    return !best || ms > best.ms ? { title: a.title, ms } : best;
  }, null);
  const rows = f === "open" ? open : f === "closed" ? closed : h.alerts;
  const link = (nf: string, nd: number) => `/history?f=${nf}&days=${nd}`;

  return (
    <main className="wall">
      <Nav active="history" />
      <div className="sec-head"><h1 className="page-title">Alert history</h1><span className="muted">last {days} days · every open alert</span></div>

      <section className="summary">
        <div className={`sum ${open.some((a) => a.level === "critical") ? "critical" : open.length ? "early-warning" : ""}`}>
          <span>Open now</span><b>{open.length}</b>
          <small>{open.filter((a) => a.level === "critical").length} critical · {open.filter((a) => a.level !== "critical").length} warning</small>
        </div>
        <div className="sum"><span>Closed</span><b className="good-text">{closed.length}</b><small>in the last {days} days</small></div>
        <div className="sum"><span>Longest open</span><b>{longest ? dur(longest.ms) : "—"}</b><small>{longest?.title ?? "nothing open"}</small></div>
        <div className="sum"><span>Telegram messages</span><b>{h.alerts.reduce((n, a) => n + a.sends, 0)}</b><small>first sends and repeats</small></div>
      </section>

      <section className="card">
        <div className="sec-head">
          <nav className="filter" aria-label="Show">
            <Link href={link("all", days)} className={f === "all" ? "on" : ""}>All</Link>
            <Link href={link("open", days)} className={f === "open" ? "on" : ""}>Open</Link>
            <Link href={link("closed", days)} className={f === "closed" ? "on" : ""}>Closed</Link>
          </nav>
          <nav className="filter" aria-label="Period">
            {[7, 30, 90].map((d) => <Link key={d} href={link(f, d)} className={days === d ? "on" : ""}>{d} days</Link>)}
          </nav>
        </div>
        <div className="table-wrap">
          <table className="htable">
            <thead><tr><th>Alert</th><th>Level</th><th>Opened</th><th>How long</th><th>Seen by</th><th>Sent</th><th>Detail</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className={!a.closed_at ? `open ${a.level.replace(" ", "-")}` : ""}>
                  <td><Link href={`/runbook/${a.check_key}`}>{a.title}</Link></td>
                  <td><span className={`pill ${a.level.replace(" ", "-")}`}>{LEVEL[a.level] ?? a.level}</span></td>
                  <td>{when(a.opened_at)}</td>
                  <td>{a.closed_at ? <>closed after {dur(Date.parse(a.closed_at) - Date.parse(a.opened_at))}</> : <b>open {dur(now - Date.parse(a.opened_at))}</b>}</td>
                  <td>{a.seen_by ?? (a.closed_at ? "—" : "not seen yet")}</td>
                  <td>{a.sends}</td>
                  <td className="muted">{human(a.detail)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} className="muted">No alerts here.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
