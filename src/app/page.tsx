import { AuthDialog } from "@/components/auth/auth-dialog";
import { BrandMark } from "@/components/ui/brand-mark";
import Image from "next/image";
import { CircleDot, Sparkles } from "lucide-react";
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
        <div className="landing-status"><span /> Личное пространство</div>
      </header>

      <section className="landing-preview">
        <div className="preview-copy">
          <div className="eyebrow"><Sparkles size={14} /> Ваш ритм. Ваши правила.</div>
          <h1>Соберите жизнь<br />в <em>свой контур.</em></h1>
          <p>Не ещё один список задач, а живая карта того, чему вы отдаёте время, энергию и внимание.</p>
          <div className="landing-benefits" aria-label="Возможности сервиса">
            <span><i /> Видеть баланс</span>
            <span><i /> Планировать мягко</span>
            <span><i /> Замечать рост</span>
          </div>
        </div>
        <div className="landing-art" aria-hidden="true">
          <Image
            alt=""
            className="landing-art-image"
            fill
            preload
            sizes="(max-width: 900px) 100vw, 58vw"
            src="/art/life-orbit.webp"
          />
          <div className="landing-art-note landing-art-note-top">
            <span>06 сфер</span>
            <strong>одна система</strong>
          </div>
          <div className="landing-art-note landing-art-note-bottom">
            <CircleDot size={16} />
            <span>Контур меняется<br />вместе с вами</span>
          </div>
        </div>
      </section>

      <AuthDialog />
      <footer className="landing-footer">© 2026 КОНТУР.КОСТРОВ <span>Личные данные защищены</span></footer>
    </main>
  );
}
