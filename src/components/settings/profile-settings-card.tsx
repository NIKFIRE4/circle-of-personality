"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ProfileSettingsCardProps = {
  initialName: string;
  email: string;
  initialTimeZone: string;
};

const COMMON_TIME_ZONES = [
  "Europe/Moscow",
  "Europe/Kaliningrad",
  "Europe/Samara",
  "Asia/Yekaterinburg",
  "Asia/Omsk",
  "Asia/Krasnoyarsk",
  "Asia/Irkutsk",
  "Asia/Yakutsk",
  "Asia/Vladivostok",
  "Asia/Magadan",
  "Asia/Kamchatka",
  "UTC",
];

export function ProfileSettingsCard({
  initialName,
  email,
  initialTimeZone,
}: ProfileSettingsCardProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [timeZone, setTimeZone] = useState(initialTimeZone);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, timeZone }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error?.message || "Не удалось сохранить профиль");
      }
      setMessage("Изменения сохранены");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить профиль");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label className="field">
        <span className="field-label">Имя</span>
        <input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} required />
      </label>
      <label className="field">
        <span className="field-label">Электронная почта</span>
        <input value={email} readOnly aria-readonly="true" />
      </label>
      <label className="field">
        <span className="field-label">Часовой пояс</span>
        <input list="profile-time-zones" value={timeZone} onChange={(event) => setTimeZone(event.target.value)} required />
        <datalist id="profile-time-zones">
          {COMMON_TIME_ZONES.map((zone) => <option value={zone} key={zone} />)}
        </datalist>
      </label>
      <div className="auth-error" role="alert">{error}</div>
      {message && <p className="settings-success" role="status">{message}</p>}
      <button className="connect-button" type="submit" disabled={pending}>
        {pending ? "Сохраняем…" : "Сохранить"}
      </button>
    </form>
  );
}
