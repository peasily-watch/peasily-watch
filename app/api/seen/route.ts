import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, verify } from "@/lib/auth";
import { watchDb } from "@/lib/db";

// "Seen" on the wall screen: stops the Telegram repeats of that alert.
export async function POST(req: NextRequest) {
  const who = verify(req.cookies.get(COOKIE)?.value);
  if (!who) return NextResponse.json({ error: "sign in" }, { status: 401 });
  const f = await req.formData();
  const id = Number(f.get("id"));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
  await watchDb().rpc("seen", { p_id: id, p_by: who });
  return NextResponse.redirect(new URL("/", req.url), 303);
}
