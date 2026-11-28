import Link from "next/link";

// the small menu at the top of the wall, History and Settings
export function Nav({ active }: { active: "wall" | "history" | "settings" }) {
  const items = [["wall", "/", "Wall"], ["history", "/history", "History"], ["settings", "/settings", "Settings"]] as const;
  return (
    <nav className="topnav" aria-label="Watch pages">
      {items.map(([k, href, label]) => (
        <Link key={k} href={href} className={active === k ? "on" : ""} aria-current={active === k ? "page" : undefined}>{label}</Link>
      ))}
    </nav>
  );
}
