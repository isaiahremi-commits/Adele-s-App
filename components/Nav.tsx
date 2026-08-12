"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import SignOutButton from "@/components/SignOutButton";

// Day-3 item 4: Adèle's tab order. Route for Schedule stays /scheduling.
const links = [
  { href: "/", label: "Dashboard", icon: "◎" },
  { href: "/scheduling", label: "Schedule", icon: "▦" },
  { href: "/timecards", label: "Timecards", icon: "◷" },
  { href: "/tips", label: "Tips", icon: "◈" },
  { href: "/pto", label: "PTO", icon: "❖" },
  { href: "/payroll", label: "Payroll", icon: "▣" },
  { href: "/reports", label: "Reports", icon: "▤" },
  { href: "/swaps", label: "Swaps", icon: "⇄" },
  { href: "/employees", label: "Employees", icon: "◉" },
  { href: "/setup", label: "Setup", icon: "⚙" },
];

export default function Nav() {
  const pathname = usePathname();
  // The login screen renders standalone (no sidebar).
  const hidden = pathname === "/login";
  const [companyName, setCompanyName] = useState<string>("Loading...");
  const [collapsed, setCollapsed] = useState(false); // Item 16

  useEffect(() => {
    if (typeof window !== "undefined") {
      const c = localStorage.getItem("sidebar_collapsed") === "true";
      setCollapsed(c);
      document.documentElement.dataset.sidebarCollapsed = String(c); // drives content reflow
    }

    fetch("/api/setup")
      .then((r) => r.json())
      .then((data) => {
        if (data && data.company_name) setCompanyName(data.company_name);
        else setCompanyName("My Restaurant");
      })
      .catch(() => setCompanyName("My Restaurant"));
  }, []);

  function setCollapsedState(v: boolean) {
    setCollapsed(v);
    if (typeof window !== "undefined") {
      localStorage.setItem("sidebar_collapsed", String(v));
      document.documentElement.dataset.sidebarCollapsed = String(v);
    }
  }

  if (hidden) return null;

  // Item 16: icons-only mini-rail when collapsed; labels hide, icons + tooltips stay.
  // Brand book cover treatment: swiss-chocolate sidebar, cream text, apricot
  // active states, pear/cream logotype.
  const btnStyle = {
    background: "rgba(247, 242, 225, 0.08)",
    border: "1px solid var(--sidebar-border)",
    color: "var(--sidebar-fg)",
  } as const;
  return (
    <aside
      className={`${collapsed ? "w-16 p-2" : "w-60 p-5"} shrink-0 border-r flex flex-col gap-1`}
      style={{ borderColor: "var(--sidebar-border)", background: "var(--sidebar)" }}
    >
      <div className={`flex ${collapsed ? "flex-col items-center" : "items-start justify-between"} px-1 py-3 mb-2 gap-2`}>
        {collapsed ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src="/brand/manadele-mark-dark.svg" alt="manadele" className="w-9 h-auto" />
        ) : (
          <div className="min-w-0 flex-1 pr-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/manadele-logo-dark.svg" alt="manadele" className="h-8 w-auto mb-2" />
            <p className="text-sm font-medium truncate" style={{ color: "var(--sidebar-fg)" }}>
              {companyName}
            </p>
          </div>
        )}
        <div className={`flex ${collapsed ? "flex-col" : "items-center"} gap-1 shrink-0`}>
          <button onClick={() => setCollapsedState(!collapsed)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="w-8 h-8 rounded-md flex items-center justify-center text-sm" style={btnStyle}>
            {collapsed ? "⟩" : "⟨"}
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
              background: active ? "var(--sidebar-active)" : "transparent",
              color: active ? "var(--primary)" : "var(--sidebar-fg)",
            }}
          >
            <span className="w-5 text-center">{link.icon}</span>
            {!collapsed && link.label}
          </Link>
        );
      })}
      {!collapsed && (
        <div className="mt-auto pt-6 px-2">
          <div className="pb-3 mb-3" style={{ borderBottom: "1px solid var(--sidebar-border)" }}>
            <SignOutButton />
          </div>
          <p className="text-xs" style={{ color: "var(--sidebar-muted)" }}>
            Powered by <span style={{ color: "var(--primary)" }}>manadele</span>
          </p>
        </div>
      )}
    </aside>
  );
}
