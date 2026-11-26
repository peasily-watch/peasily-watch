import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, verify } from "./auth";

export async function requireUser(): Promise<string> {
  const who = verify((await cookies()).get(COOKIE)?.value);
  if (!who) redirect("/login");
  return who;
}
