import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, passwordOk, sign } from "@/lib/auth";

async function signIn(f: FormData) {
  "use server";
  const name = String(f.get("name") ?? "").trim().slice(0, 40);
  const pass = String(f.get("pass") ?? "");
  if (!name || !passwordOk(pass)) redirect("/login?m=wrong");
  (await cookies()).set(COOKIE, sign(name), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 3600 });
  redirect("/");
}

export default async function Login({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  return (
    <main className="login">
      <form action={signIn} className="card">
        <h1>Peasily Watch</h1>
        <p className="muted">Hawks team only.</p>
        {m === "wrong" && <p className="bad">That passcode is not right.</p>}
        <label>Your name<input name="name" required autoComplete="name" /></label>
        <label>Passcode<input name="pass" type="password" required autoComplete="current-password" /></label>
        <button type="submit">Open the wall</button>
      </form>
    </main>
  );
}
