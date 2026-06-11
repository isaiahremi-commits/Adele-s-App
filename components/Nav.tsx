"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import SignOutButton from "@/components/SignOutButton";

const links = [
  { href: "/", label: "Dashboard", icon: "◎" },
  { href: "/scheduling", label: "Scheduling", icon: "▦" },
  { href: "/timecards", label: "Timecards", icon: "◷" },
  { href: "/payroll", label: "Payroll", icon: "▣" },
  { href: "/pto", label: "PTO", icon: "❖" },
  { href: "/tips", label: "Tips", icon: "◈" },
  { href: "/reports", label: "Reports", icon: "▤" },
  { href: "/swaps", label: "Swaps", icon: "⇄" },
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
  // The login screen renders standalone (no sidebar).
  const hidden = pathname === "/login";
  const [theme, setTheme] = useState<Theme>("light");
  const [companyName, setCompanyName] = useState<string>("Loading...");
  const [collapsed, setCollapsed] = useState(false); // Item 16

  useEffect(() => {
    const saved = (typeof window !== "undefined" && (localStorage.getItem("theme") as Theme | null)) || "light";
    setTheme(saved);
    applyTheme(saved);
    if (typeof window !== "undefined") setCollapsed(localStorage.getItem("sidebar_collapsed") === "true");

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

  function setCollapsedState(v: boolean) {
    setCollapsed(v);
    if (typeof window !== "undefined") localStorage.setItem("sidebar_collapsed", String(v));
  }

  if (hidden) return null;

  // Item 16: icons-only mini-rail when collapsed; labels hide, icons + tooltips stay.
  const btnStyle = { background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--foreground)" } as const;
  return (
    <aside
      className={`${collapsed ? "w-16 p-2" : "w-60 p-5"} shrink-0 border-r flex flex-col gap-1`}
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <div className={`flex ${collapsed ? "flex-col items-center" : "items-start justify-between"} px-1 py-3 mb-2 gap-2`}>
        {!collapsed && (
          <div className="min-w-0 flex-1 pr-2">
            <h1 className="text-xl font-bold truncate" style={{ color: "var(--primary)" }}>{companyName}</h1>
            <p className="text-xs" style={{ color: "var(--muted)" }}>manadele</p>
          </div>
        )}
        <div className={`flex ${collapsed ? "flex-col" : "items-center"} gap-1 shrink-0`}>
          <button onClick={toggleTheme} aria-label="Toggle theme"
            title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            className="w-8 h-8 rounded-md flex items-center justify-center text-sm" style={btnStyle}>
            {theme === "light" ? "\u263E" : "\u2600"}
          </button>
          <button onClick={() => setCollapsedState(!collapsed)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="w-8 h-8 rounded-md flex items-center justify-center text-sm" style={btnStyle}>
            {collapsed ? "\u27E9" : "\u27E8"}
          </button>
        </div>
      </div>
      {links.map((link) => {
        const active = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href));
        return (
          <Link
            key={link.href}
            href={link.href}
            title={collapsed ? link.label : undefined}
            className={`flex items-center ${collapsed ? "justify-center" : "gap-3"} px-3 py-2 rounded-lg text-sm transition-colors`}
            style={{
              background: active ? "var(--surface-2)" : "transparent",
              color: active ? "var(--primary)" : "var(--foreground)",
            }}
          >
            <span className="w-5 text-center">{link.icon}</span>
            {!collapsed && link.label}
          </Link>
        );
      })}
      {!collapsed && (
        <div className="mt-auto pt-6 px-2">
          <div className="pb-3 mb-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <SignOutButton />
          </div>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Powered by <span style={{ color: "var(--primary)" }}>manadele</span>
          </p>
        </div>
      )}
    </aside>
  );
}
