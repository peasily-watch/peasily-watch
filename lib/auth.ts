import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// One shared passcode for the wall screen (kept in Vercel settings, never in
// code). The browser keeps a signed cookie; nothing about Peasily is stored.
export const COOKIE = "watch_ok";
const secret = () => process.env.WATCH_PASSWORD ?? "";
export const sign = (who: string) => {
  const v = `${who}.${Date.now()}`;
  return `${v}.${createHmac("sha256", secret()).update(v).digest("hex")}`;
};
export function verify(cookie: string | undefined): string | null {
  if (!cookie || !secret()) return null;
  const i = cookie.lastIndexOf(".");
  const v = cookie.slice(0, i), mac = cookie.slice(i + 1);
  const good = createHmac("sha256", secret()).update(v).digest("hex");
  if (mac.length !== good.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
  const [who, at] = [v.slice(0, v.lastIndexOf(".")), Number(v.slice(v.lastIndexOf(".") + 1))];
  if (!at || Date.now() - at > 30 * 24 * 3600 * 1000) return null;
  return who;
}
export function passwordOk(p: string): boolean {
  const s = secret();
  return !!s && p.length === s.length && timingSafeEqual(Buffer.from(p), Buffer.from(s));
}
