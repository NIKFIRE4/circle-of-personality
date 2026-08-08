"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, CalendarDays, Crosshair, Goal, LogOut, Plus, Settings } from "lucide-react";
import { ProductTour } from "@/components/onboarding/product-tour";
import { BrandMark } from "@/components/ui/brand-mark";

import styles from "./app-shell.module.css";

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
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#dashboard-content">Перейти к содержимому</a>
      <aside className={styles.sidebar}>
        <BrandMark />
        <div className={styles.navLabel}>Пространство</div>
        <nav className={styles.navList} aria-label="Основная навигация">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              aria-current={pathname.startsWith(href) ? "page" : undefined}
              className={styles.navItem}
              data-tour={href.slice(1)}
              href={href}
              title={label}
            >
              <Icon size={16} strokeWidth={1.7} /><span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className={styles.sidebarBottom}>
          <div className={styles.sidebarProgress}>
            <div className={styles.progressHead}><span>Баланс недели</span><strong>{balanceTotal}%</strong></div>
            <div
              aria-label={`Баланс недели: ${balanceTotal}%`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={balanceTotal}
              className={styles.progressTrack}
              role="progressbar"
            >
              <span style={{ width: `${balanceTotal}%` }} />
            </div>
          </div>
          <div className={styles.profileCard}>
            <div className={styles.avatar}>{(user.name || user.email).slice(0, 2).toUpperCase()}</div>
            <div className={styles.profileCopy}><strong>{user.name || "Пользователь"}</strong><span>{user.email}</span></div>
            <button className={styles.logoutButton} onClick={logout} aria-label="Выйти" type="button"><LogOut size={15} /></button>
          </div>
        </div>
      </aside>
      <div className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.breadcrumbs}><span>КОНТУР.КОСТРОВ</span><span>/</span><strong>{current}</strong></div>
          <div className={styles.topbarActions}>
            <ProductTour storageId={encodeURIComponent(user.email)} />
            <Link href="/calendar?create=1" className={styles.newTaskButton} data-tour="create"><Plus size={14} /><span>Новая задача</span></Link>
          </div>
        </header>
        <div className={styles.content} id="dashboard-content" tabIndex={-1}>{children}</div>
      </div>
    </div>
  );
}
