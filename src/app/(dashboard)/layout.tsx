import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentUser } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const dashboard = await getDashboardData(user.id, user.timeZone);
  return <AppShell user={{ name: user.name, email: user.email }} balanceTotal={dashboard.total}>{children}</AppShell>;
}
