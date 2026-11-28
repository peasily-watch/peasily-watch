import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, verify } from "@/lib/auth";
import { watchDb } from "@/lib/db";

// "Save settings" on the Settings page. The database checks every value again
// (watch.set_setting) and records who changed what.
export async function POST(req: NextRequest) {
  const who = verify(req.cookies.get(COOKIE)?.value);
  if (!who) return NextResponse.json({ error: "sign in" }, { status: 401 });
  const f = await req.formData();
  const values: [string, string][] = [
    ["repeat_minutes", String(f.get("repeat_minutes") ?? "")],
    ["remind_seen_hours", String(f.get("remind_seen_hours") ?? "")],
    ["alive_daily", f.get("alive_daily") ? "on" : "off"],
    ["alive_hour", String(f.get("alive_hour") ?? "")],
  ];
  for (const [key, value] of values) {
    if (value === "") continue;
    const { error } = await watchDb().rpc("set_setting", { p_key: key, p_value: value, p_by: who });
    if (error) return NextResponse.redirect(new URL(`/settings?err=${encodeURIComponent(error.message.slice(0, 120))}`, req.url), 303);
  }
  return NextResponse.redirect(new URL("/settings?saved=1", req.url), 303);
}
