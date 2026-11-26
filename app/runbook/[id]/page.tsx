import Link from "next/link";
import { requireUser } from "@/lib/guard";
import { watchDb, type Wall } from "@/lib/db";

export const dynamic = "force-dynamic";

// The runbook comes live from the Peasily repository (docs/runbooks), read
// with a read-only GitHub token, so it is never out of date. {{job:name}}
// is filled with that job's live figures.
async function fetchRunbook(id: string): Promise<string | null> {
  const repo = process.env.GITHUB_REPO ?? "HawksSandeep/hawks-dynamics-Prod";
  const token = process.env.GITHUB_TOKEN;
  if (!token || !/^[a-z0-9-]+$/.test(id)) return null;
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/docs/runbooks/${id}.md?ref=main`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.raw", "User-Agent": "peasily-watch" },
    next: { revalidate: 300 },
  });
  return r.ok ? r.text() : null;
}

const inline = (t: string) => t.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) =>
  p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : p.startsWith("`") ? <code key={i}>{p.slice(1, -1)}</code> : p);

function Markdown({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  let list: { kind: "ol" | "ul"; items: string[] } | null = null;
  const flush = () => { if (list) { const L = list.kind; out.push(L === "ol" ? <ol key={out.length}>{list.items.map((x, i) => <li key={i}>{inline(x)}</li>)}</ol> : <ul key={out.length}>{list.items.map((x, i) => <li key={i}>{inline(x)}</li>)}</ul>); list = null; } };
  for (const raw of text.split("\n")) {
    const l = raw.trimEnd();
    const ol = l.match(/^\d+\.\s+(.*)/), ul = l.match(/^[-*]\s+(.*)/);
    if (ol) { if (list?.kind !== "ol") { flush(); list = { kind: "ol", items: [] }; } list.items.push(ol[1]); continue; }
    if (ul) { if (list?.kind !== "ul") { flush(); list = { kind: "ul", items: [] }; } list.items.push(ul[1]); continue; }
    if (/^\s+\S/.test(raw) && list) { list.items[list.items.length - 1] += " " + l.trim(); continue; }
    flush();
    if (l.startsWith("# ")) out.push(<h1 key={out.length}>{l.slice(2)}</h1>);
    else if (l.startsWith("## ")) out.push(<h2 key={out.length}>{l.slice(3)}</h2>);
    else if (l.startsWith("> ")) out.push(<p key={out.length} className="warn">{inline(l.slice(2))}</p>);
    else if (l) out.push(<p key={out.length}>{inline(l)}</p>);
  }
  flush();
  return <>{out}</>;
}

export default async function Runbook({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const [md, wall] = await Promise.all([fetchRunbook(id), watchDb().rpc("wall")]);
  const w = wall.data as Wall | null;
  const jobs = w?.snapshot?.data?.jobs ?? [];
  const check = w?.checks.find((c) => c.key === id);
  let body = md ?? "";
  body = body.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/\{\{job:([a-z0-9-]+)\}\}/g, (_, name: string) => {
    const j = jobs.find((x) => x.job === name);
    return j ? `${name} (runs ${j.schedule}; last ${j.last_status ?? "never"}${j.last_start ? " at " + new Date(j.last_start).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : ""}${j.failed_24h ? `; failed ${j.failed_24h} times in 24 hours` : ""})` : name;
  });
  return (
    <main className="wall runbook">
      <Link href="/">← Back to the wall</Link>
      {check && <p className={`now ${check.level.replace(" ", "-")}`}>Now: <b>{check.title}</b> · {check.detail}</p>}
      <article className="card">{md ? <Markdown text={body} /> : <p className="bad">This runbook could not be read from GitHub (check GITHUB_TOKEN in the Vercel settings).</p>}</article>
    </main>
  );
}
