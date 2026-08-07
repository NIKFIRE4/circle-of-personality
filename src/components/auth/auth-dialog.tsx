"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, AtSign, KeyRound, Orbit, UserRound } from "lucide-react";

type Mode = "login" | "register";

export function AuthDialog() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(formData: FormData) {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(formData)),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : payload.error?.message || "Не удалось войти");
      router.push("/overview");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Попробуйте ещё раз");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-overlay">
      <section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <div className="auth-dialog-header">
          <div>
            <span className="auth-kicker">Личное пространство</span>
            <h2 id="auth-title">{mode === "login" ? "С возвращением" : "Создать контур"}</h2>
          </div>
          <div className="auth-orbit"><Orbit size={20} /></div>
        </div>

        <div className="auth-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === "login"} className={`auth-tab ${mode === "login" ? "active" : ""}`} onClick={() => { setMode("login"); setError(""); }}>Войти</button>
          <button type="button" role="tab" aria-selected={mode === "register"} className={`auth-tab ${mode === "register" ? "active" : ""}`} onClick={() => { setMode("register"); setError(""); }}>Регистрация</button>
        </div>

        <form action={submit}>
          {mode === "register" && (
            <label className="field">
              <span className="field-label">Имя</span>
              <span className="input-shell"><UserRound size={16} /><input name="name" placeholder="Как к вам обращаться" minLength={2} required autoComplete="name" /></span>
            </label>
          )}
          <label className="field">
            <span className="field-label">Электронная почта</span>
            <span className="input-shell"><AtSign size={16} /><input name="email" type="email" placeholder="name@example.com" required autoComplete="email" /></span>
          </label>
          <label className="field">
            <span className="field-label">Пароль</span>
            <span className="input-shell"><KeyRound size={16} /><input name="password" type="password" placeholder="Минимум 10 символов и цифра" minLength={mode === "login" ? 1 : 10} required autoComplete={mode === "login" ? "current-password" : "new-password"} /></span>
          </label>
          <div className="auth-error" role="alert">{error}</div>
          <button className="primary-button" disabled={pending} type="submit">
            {pending ? "Проверяем…" : mode === "login" ? "Войти в систему" : "Создать аккаунт"} <ArrowRight size={15} />
          </button>
        </form>

        <p className="auth-note">Входя, вы соглашаетесь с обработкой данных.</p>
      </section>
    </div>
  );
}
