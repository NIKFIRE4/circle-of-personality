"use client";

import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  BALANCE_MODEL_SOURCES,
  DEFAULT_BALANCE_CATEGORIES,
  DEFAULT_CATEGORY_GUIDES,
  defaultCategoryGuide,
  OMITTED_SPHERE_NOTE,
} from "@/lib/default-categories";
import { useSubmitGuard } from "@/lib/use-submit-guard";

import styles from "./categories-card.module.css";

const DEFAULT_CATEGORY_NAMES = new Map<string, string>(
  DEFAULT_BALANCE_CATEGORIES.map((category) => [category.slug, category.name]),
);

export type Category = {
  id: string;
  name: string;
  slug: string;
  color: string;
  icon: string | null;
  targetMinutesPerWeek: number;
  sortOrder: number;
  isArchived: boolean;
};

type CategoryPayload = {
  name: string;
  color: string;
  targetMinutesPerWeek: number;
};

export function CategoriesCard({
  initialCategories,
  title = "Сферы жизни",
  description = "Настройте направления и недельные цели времени.",
}: {
  initialCategories?: Category[];
  title?: string;
  description?: string;
}) {
  const router = useRouter();
  const [categories, setCategories] = useState(initialCategories ?? []);
  const [loading, setLoading] = useState(initialCategories === undefined);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Category | "new" | null>(null);

  useEffect(() => {
    if (initialCategories !== undefined) return;
    const controller = new AbortController();
    fetch("/api/categories", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(apiMessage(body, "Не удалось загрузить сферы"));
        setCategories(Array.isArray(body.categories) ? body.categories : []);
      })
      .catch((caught) => {
        if ((caught as Error).name !== "AbortError") setError(caught instanceof Error ? caught.message : "Не удалось загрузить сферы");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [initialCategories]);

  async function saveCategory(payload: CategoryPayload) {
    const existing = editing === "new" ? null : editing;
    const response = await fetch(existing ? `/api/categories/${existing.id}` : "/api/categories", {
      method: existing ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(apiMessage(body, "Не удалось сохранить сферу"));
    const saved = body.category as Category;
    setCategories((current) => existing ? current.map((category) => category.id === saved.id ? saved : category) : [...current, saved].sort(compareCategories));
    router.refresh();
    setEditing(null);
    setError("");
  }

  async function archiveCategory(category: Category) {
    if (!window.confirm(`Удалить сферу «${category.name}» из обзора? Она исчезнет из обзора и списка сфер, а история событий и целей сохранится.`)) return;
    const response = await fetch(`/api/categories/${category.id}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(apiMessage(body, "Не удалось удалить сферу из обзора"));
      return;
    }
    setCategories((current) => current.filter((item) => item.id !== category.id));
    router.refresh();
    if (editing !== "new" && editing?.id === category.id) setEditing(null);
  }

  return (
    <>
      <article className="panel settings-card">
        <div className={styles.header}>
          <div><h2>{title}</h2><p>{description}</p></div>
          <button className="connect-button" onClick={() => setEditing("new")}><Plus size={12} /> Добавить</button>
        </div>
        {loading ? <div className={styles.message}>Загружаем сферы…</div> : null}
        {error ? <div className={`${styles.message} ${styles.error}`} role="alert">{error}</div> : null}
        {!loading && !categories.length ? <div className={styles.message}>Активных сфер пока нет.</div> : null}
        <div className={styles.list}>
          {categories.map((category) => {
            const guide = defaultCategoryGuide(category.slug);

            return (
            <div className={styles.row} key={category.id}>
              <i className={styles.dot} style={{ background: category.color }} />
              <div className={styles.copy}>
                <strong>{category.name}</strong>
                {guide ? <span className={styles.summary}>{guide.summary}</span> : null}
                <span>{formatWeeklyTarget(category.targetMinutesPerWeek)}</span>
              </div>
              <div className={styles.actions}>
                <button className={styles.iconButton} onClick={() => setEditing(category)} aria-label={`Изменить сферу ${category.name}`}><Pencil size={13} /></button>
                <button className={`${styles.iconButton} ${styles.danger}`} onClick={() => void archiveCategory(category)} aria-label={`Удалить сферу ${category.name} из обзора`}><Trash2 size={13} /></button>
              </div>
            </div>
            );
          })}
        </div>
        <BalanceModelExplainer />
      </article>
      {editing && <CategoryDialog category={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSave={saveCategory} />}
    </>
  );
}

/**
 * The eight starting spheres used to appear without explanation, which made
 * them read as arbitrary. This states where each one comes from and why its
 * weekly target is what it is, so the defaults can be argued with.
 */
function BalanceModelExplainer() {
  return (
    <details className={styles.rationale}>
      <summary>Откуда эти восемь сфер</summary>
      <p>
        Набор по умолчанию не придуман здесь: это пересечение трёх опубликованных
        моделей благополучия, которые независимо сходятся на одних и тех же
        областях жизни. Любую сферу можно переименовать, изменить её цель или
        убрать из обзора.
      </p>
      <ul className={styles.rationaleList}>
        {DEFAULT_CATEGORY_GUIDES.map((guide) => (
          <li key={guide.slug}>
            <strong>{DEFAULT_CATEGORY_NAMES.get(guide.slug) ?? guide.slug}</strong>
            <span>Основание: {guide.basis}</span>
            <span>Недельная цель: {guide.target}</span>
            <span>Сюда попадают: {guide.includes.join(", ")}.</span>
          </li>
        ))}
      </ul>
      <p>{OMITTED_SPHERE_NOTE}</p>
      <ul className={styles.sourceList}>
        {BALANCE_MODEL_SOURCES.map((source) => (
          <li key={source.url}>
            <a href={source.url} target="_blank" rel="noreferrer noopener">
              {source.title}
            </a>
            <span>{source.detail}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function CategoryDialog({ category, onClose, onSave }: { category: Category | null; onClose: () => void; onSave: (payload: CategoryPayload) => Promise<void> }) {
  const { pending, guard } = useSubmitGuard();
  const [error, setError] = useState("");

  function action(formData: FormData) {
    setError("");
    guard(async () => {
      try {
        await onSave({
          name: String(formData.get("name") || ""),
          color: String(formData.get("color") || "#D8A84F"),
          targetMinutesPerWeek: Number(formData.get("targetMinutesPerWeek")),
        });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Не удалось сохранить сферу");
      }
    });
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="category-dialog-title">
        <div className="modal-head">
          <div><span className="eyebrow">Баланс</span><h2 id="category-dialog-title">{category ? "Изменить сферу" : "Новая сфера"}</h2></div>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть"><X size={15} /></button>
        </div>
        <form action={action}>
          <div className="form-grid">
            <label className="field full"><span className="field-label">Название</span><input name="name" defaultValue={category?.name} maxLength={80} required /></label>
            <label className="field"><span className="field-label">Цвет</span><input name="color" type="color" defaultValue={category?.color ?? "#D8A84F"} required /></label>
            <label className="field"><span className="field-label">Минут в неделю</span><input name="targetMinutesPerWeek" type="number" min="0" max="10080" step="1" defaultValue={category?.targetMinutesPerWeek ?? 0} required /></label>
          </div>
          <div className="auth-error" role="alert">{error}</div>
          <div className="form-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={pending}>Отмена</button><button className="primary-button" disabled={pending}>{pending ? "Сохраняем…" : "Сохранить"}</button></div>
        </form>
      </section>
    </div>
  );
}

function compareCategories(left: Category, right: Category) {
  return left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "ru");
}

function formatWeeklyTarget(minutes: number) {
  if (!minutes) return "Недельная цель не задана";
  const hours = minutes / 60;
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(hours)} ч в неделю`;
}

function apiMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") return fallback;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") return (error as { message: string }).message;
  return fallback;
}
