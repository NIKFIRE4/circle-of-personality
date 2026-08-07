"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, CalendarDays, Crosshair, Goal, LogOut, Plus, Settings } from "lucide-react";
import { BrandMark } from "@/components/ui/brand-mark";

const navigation = [
  { href: "/overview", label: "Обзор", icon: Crosshair },
  { href: "/calendar", label: "Календарь", icon: CalendarDays },
  { href: "/goals", label: "Цели", icon: Goal },
  { href: "/insights", label: "Аналитика", icon: BarChart3 },
  { href: "/settings", label: "Настройки", icon: Settings },
];

type AppShellProps = {
  children: React.ReactNode;
  user: { name: string | null; email: string };
  balanceTotal: number;
};

export function AppShell({ children, user, balanceTotal }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const current = navigation.find((item) => pathname.startsWith(item.href))?.label ?? "КОНТУР.КОСТРОВ";

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <BrandMark />
        <div className="nav-label">Пространство</div>
        <nav className="nav-list" aria-label="Основная навигация">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link key={href} className={`nav-item ${pathname.startsWith(href) ? "active" : ""}`} href={href}>
              <Icon size={16} strokeWidth={1.7} /><span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-progress">
            <div className="sidebar-progress-head"><span>Баланс недели</span><strong>{balanceTotal}%</strong></div>
            <div className="progress-track" aria-label={`Баланс недели: ${balanceTotal}%`}><span style={{ width: `${balanceTotal}%` }} /></div>
          </div>
          <div className="profile-card">
            <div className="avatar">{(user.name || user.email).slice(0, 2).toUpperCase()}</div>
            <div className="profile-copy"><strong>{user.name || "Пользователь"}</strong><span>{user.email}</span></div>
            <button className="logout-button" onClick={logout} aria-label="Выйти"><LogOut size={15} /></button>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumbs"><span>КОНТУР.КОСТРОВ</span><span>/</span><strong>{current}</strong></div>
          <div className="topbar-actions">
            <Link href="/calendar?create=1" className="new-task-button"><Plus size={14} /><span>Новая задача</span></Link>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
