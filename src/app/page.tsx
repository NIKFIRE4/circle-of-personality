import { AuthDialog } from "@/components/auth/auth-dialog";
import { BrandMark } from "@/components/ui/brand-mark";
import { ArrowUpRight, CalendarDays, Sparkles } from "lucide-react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function HomePage() {
  if (await getCurrentUser()) redirect("/overview");

  return (
    <main className="auth-page">
      <div className="auth-ambient auth-ambient-one" />
      <div className="auth-ambient auth-ambient-two" />

      <header className="landing-header">
        <BrandMark />
        <div className="landing-status">Личное пространство</div>
      </header>

      <section className="landing-preview" aria-hidden="true">
        <div className="preview-copy">
          <div className="eyebrow"><Sparkles size={14} /> Жизнь — не список дел</div>
          <h1>Держите важное<br />в поле зрения.</h1>
          <p>Единый контур для планов, энергии и прогресса.</p>
        </div>
        <div className="preview-dashboard">
          <div className="preview-card preview-score">
            <span>Ваш прогресс</span><strong>—</strong>
            <div className="preview-line"><i /><i /><i /><i /><i /><i /><i /></div>
          </div>
          <div className="preview-card preview-next">
            <CalendarDays size={18} />
            <div><span>Следующее событие</span><strong>Появится после входа</strong></div>
            <ArrowUpRight size={17} />
          </div>
        </div>
      </section>

      <AuthDialog />
      <footer className="landing-footer">© 2026 КОНТУР.КОСТРОВ <span>Личные данные защищены</span></footer>
    </main>
  );
}
