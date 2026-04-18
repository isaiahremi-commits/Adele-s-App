"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard", icon: "◎" },
  { href: "/scheduling", label: "Scheduling", icon: "▦" },
  { href: "/tips", label: "Tips", icon: "◈" },
  { href: "/employees", label: "Employees", icon: "◉" },
  { href: "/setup", label: "Setup", icon: "⚙" },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <aside className="w-60 shrink-0 border-r p-5 flex flex-col gap-1" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="px-2 py-4 mb-2">
        <h1 className="text-xl font-bold" style={{ color: "var(--primary)" }}>Adele&apos;s</h1>
        <p className="text-xs" style={{ color: "var(--muted)" }}>Staff &amp; Tips</p>
      </div>
      {links.map((link) => {
        const active = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href));
        return (
          <Link
            key={link.href}
            href={link.href}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
            style={{
              background: active ? "var(--surface-2)" : "transparent",
              color: active ? "var(--primary)" : "var(--foreground)",
            }}
          >
            <span className="w-5 text-center">{link.icon}</span>
            {link.label}
          </Link>
        );
      })}
    </aside>
  );
}
