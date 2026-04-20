"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const links = [
  { href: "/", label: "Dashboard", icon: "◎" },
  { href: "/scheduling", label: "Scheduling", icon: "▦" },
  { href: "/tips", label: "Tips", icon: "◈" },
  { href: "/employees", label: "Employees", icon: "◉" },
  { href: "/setup", label: "Setup", icon: "⚙" },
];

type Theme = "light" | "dark";

function applyTheme(theme: Theme) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

export default function Nav() {
  const pathname = usePathname();
  const [theme, setTheme] = useState<Theme>("light");
  const [companyName, setCompanyName] = useState<string>("Loading...");

  useEffect(() => {
    const saved = (typeof window !== "undefined" && (localStorage.getItem("theme") as Theme | null)) || "light";
    setTheme(saved);
    applyTheme(saved);

    fetch("/api/setup")
      .then((r) => r.json())
      .then((data) => {
        if (data && data.company_name) setCompanyName(data.company_name);
        else setCompanyName("My Restaurant");
      })
      .catch(() => setCompanyName("My Restaurant"));
  }, []);

  function toggleTheme() {
    const next: Theme = theme === "light" ? "dark" : "light";
    setTheme(next);
    applyTheme(next);
    if (typeof window !== "undefined") localStorage.setItem("theme", next);
  }

  return (
    <aside
      className="w-60 shrink-0 border-r p-5 flex flex-col gap-1"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <div className="flex items-start justify-between px-2 py-4 mb-2">
        <div className="min-w-0 flex-1 pr-2">
          <h1 className="text-xl font-bold truncate" style={{ color: "var(--primary)" }}>{companyName}</h1>
          <p className="text-xs" style={{ color: "var(--muted)" }}>Staff &amp; Tips</p>
        </div>
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
          className="w-8 h-8 rounded-md flex items-center justify-center text-sm shrink-0"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            color: "var(--foreground)",
          }}
        >
          {theme === "light" ? "\u263E" : "\u2600"}
        </button>
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
      <div className="mt-auto pt-6 px-2">
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Powered by <span style={{ color: "var(--primary)" }}>Apptage</span>
        </p>
      </div>
    </aside>
  );
}
