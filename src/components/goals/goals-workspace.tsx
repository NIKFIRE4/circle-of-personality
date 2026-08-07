"use client";

import {
  AlignLeft,
  CalendarDays,
  ChevronDown,
  Layers3,
  Pencil,
  Plus,
  SlidersHorizontal,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";

import type { GoalDto } from "@/lib/goals";
import { calculateGoalProgress } from "@/lib/progress";
import {
  CategoriesCard,
  type Category as OverviewCategory,
} from "@/components/settings/categories-card";

import styles from "./goals-workspace.module.css";

type GoalPayload = {
  title: string;
  description: string | null;
  categoryId: string | null;
  unit: string;
  currentValue: number;
  targetValue: number;
  targetDate: string | null;
  status: "ACTIVE" | "COMPLETED" | "ARCHIVED";
};

type GoalDialogState = { mode: "create" } | { mode: "edit"; goal: GoalDto };

export function GoalsWorkspace({
  initialGoals,
  categories,
}: {
  initialGoals: GoalDto[];
  categories: OverviewCategory[];
}) {
  const [goals, setGoals] = useState(initialGoals);
  const [dialog, setDialog] = useState<GoalDialogState | null>(null);
  const [error, setError] = useState("");

  async function saveGoal(payload: GoalPayload) {
    const existing = dialog?.mode === "edit" ? dialog.goal : null;
    const response = await fetch(existing ? `/api/goals/${existing.id}` : "/api/goals", {
      method: existing ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(apiMessage(body, "Не удалось сохранить цель"));

    const saved = body.goal as GoalDto;
    setGoals((current) =>
      (existing
        ? current.map((goal) => (goal.id === saved.id ? saved : goal))
        : [saved, ...current]).filter((goal) => goal.status !== "ARCHIVED"),
    );
    setDialog(null);
    setError("");
  }

  async function deleteGoal(goal: GoalDto, throwOnError = false) {
    if (!window.confirm(`Удалить цель «${goal.title}»? Это действие нельзя отменить.`)) return false;
    setError("");
    const response = await fetch(`/api/goals/${goal.id}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const message = apiMessage(body, "Не удалось удалить цель");
      setError(message);
      if (throwOnError) throw new Error(message);
      return false;
    }
    setGoals((current) => current.filter((item) => item.id !== goal.id));
    if (dialog?.mode === "edit" && dialog.goal.id === goal.id) setDialog(null);
    return true;
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Направление</span>
          <h1>Цели</h1>
          <p>Большие изменения начинаются с ясного следующего шага.</p>
        </div>
        <button className="new-task-button" onClick={() => setDialog({ mode: "create" })}>
          <Plus size={14} />
          <span>Добавить цель</span>
        </button>
      </div>

      <div className={styles.categoriesSection}>
        <CategoriesCard
          initialCategories={categories}
          title="Сферы обзора"
          description="Все сферы, которые отображаются в обзоре. Здесь можно изменить название, цвет и недельную цель или убрать сферу из обзора."
        />
      </div>

      <div className={styles.sectionHeading}>
        <div>
          <span className="eyebrow">Результат</span>
          <h2>Личные цели</h2>
        </div>
      </div>

      {error && <div className={styles.toolbarError} role="alert">{error}</div>}

      {goals.length ? (
        <section className="cards-grid">
          {goals.map((goal) => {
            const progress = Math.round(calculateGoalProgress(goal.currentValue, goal.targetValue));
            const color = goal.category?.color ?? "#D8A84F";
            return (
              <article className="panel goal-card" key={goal.id}>
                <div className="goal-top">
                  <div className="goal-icon" style={{ color }}><Target size={18} /></div>
                  <div className={styles.topActions}>
                    <span className="goal-percent">{progress}%</span>
                    <button className={styles.iconButton} onClick={() => setDialog({ mode: "edit", goal })} aria-label={`Изменить цель ${goal.title}`}>
                      <Pencil size={13} />
                    </button>
                    <button className={`${styles.iconButton} ${styles.danger}`} onClick={() => void deleteGoal(goal)} aria-label={`Удалить цель ${goal.title}`}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <h3>{goal.title}</h3>
                <p>{goal.description || goal.category?.name || "Без сферы"}</p>
                <div className={styles.meta}>
                  <span className={styles.status}>{statusLabel(goal.status)}</span>
                  {goal.targetDate && <span className={styles.status}>до {formatTargetDate(goal.targetDate)}</span>}
                </div>
                <div className="goal-progress"><span style={{ width: `${progress}%`, background: color }} /></div>
                <div className="goal-footer">
                  <span>{formatValue(goal.currentValue, goal.unit)}</span>
                  <span>{formatValue(goal.targetValue, goal.unit)}</span>
                </div>
              </article>
            );
          })}
          <button className="panel goal-card" style={{ borderStyle: "dashed", alignItems: "center", justifyContent: "center", color: "#69665f", cursor: "pointer" }} onClick={() => setDialog({ mode: "create" })}>
            <Plus size={22} />
            <span style={{ marginTop: 12, fontSize: 11 }}>Новая цель</span>
          </button>
        </section>
      ) : (
        <section className={`panel ${styles.empty}`}>
          <div><strong>Целей пока нет</strong><span>Создайте первую цель и задайте измеримый результат.</span></div>
        </section>
      )}

      {dialog && (
        <GoalDialog
          state={dialog}
          categories={categories}
          onClose={() => setDialog(null)}
          onSave={saveGoal}
          onDelete={dialog.mode === "edit" ? () => deleteGoal(dialog.goal, true) : undefined}
        />
      )}
    </>
  );
}

function GoalDialog({
  state,
  categories,
  onClose,
  onSave,
  onDelete,
}: {
  state: GoalDialogState;
  categories: OverviewCategory[];
  onClose: () => void;
  onSave: (payload: GoalPayload) => Promise<void>;
  onDelete?: () => Promise<boolean>;
}) {
  const goal = state.mode === "edit" ? state.goal : null;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function action(formData: FormData) {
    setPending(true);
    setError("");
    const targetDate = String(formData.get("targetDate") || "");
    const payload: GoalPayload = {
      title: String(formData.get("title") || ""),
      description: String(formData.get("description") || "").trim() || null,
      categoryId: String(formData.get("categoryId") || "") || null,
      unit: String(formData.get("unit") || ""),
      currentValue: Number(formData.get("currentValue")),
      targetValue: Number(formData.get("targetValue")),
      targetDate: targetDate ? `${targetDate}T12:00:00.000Z` : null,
      status: String(formData.get("status")) as GoalPayload["status"],
    };

    try {
      await onSave(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить цель");
      setPending(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal-card ${styles.dialog}`} role="dialog" aria-modal="true" aria-labelledby="goal-dialog-title">
        <div className={`modal-head ${styles.dialogHeader}`}>
          <h2 id="goal-dialog-title">{goal ? "Изменить цель" : "Новая цель"}</h2>
          <div className={styles.headerActions}>
            {onDelete && (
              <button
                type="button"
                className={`${styles.headerButton} ${styles.headerDelete}`}
                onClick={() => void onDelete()}
                disabled={pending}
                aria-label="Удалить цель"
              >
                <Trash2 size={15} />
              </button>
            )}
            <button type="button" className={styles.headerButton} onClick={onClose} aria-label="Закрыть">
              <X size={16} />
            </button>
          </div>
        </div>
        <form action={action} className={styles.dialogForm}>
          <input
            className={styles.titleInput}
            name="title"
            defaultValue={goal?.title ?? ""}
            maxLength={200}
            placeholder="Добавьте название"
            aria-label="Название цели"
            autoFocus
            required
          />

          <div className={styles.quickFields}>
            <div className={styles.quickField}>
              <CalendarDays size={18} aria-hidden="true" />
              <label className={styles.quickBody}>
                <span className={styles.quickLabel}>Срок</span>
                <input name="targetDate" type="date" defaultValue={goal?.targetDate?.slice(0, 10) ?? ""} />
              </label>
            </div>

            <div className={styles.quickField}>
              <Layers3 size={18} aria-hidden="true" />
              <label className={styles.quickBody}>
                <span className={styles.quickLabel}>Сфера</span>
                <select name="categoryId" defaultValue={goal?.categoryId ?? ""}>
                  <option value="">Без сферы</option>
                  {goal?.category && !categories.some((category) => category.id === goal.categoryId) && (
                    <option value={goal.category.id}>{goal.category.name} · архив</option>
                  )}
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </label>
            </div>

            <div className={`${styles.quickField} ${styles.descriptionField}`}>
              <AlignLeft size={18} aria-hidden="true" />
              <label className={styles.quickBody}>
                <span className={styles.quickLabel}>Описание</span>
                <textarea
                  name="description"
                  defaultValue={goal?.description ?? ""}
                  maxLength={10_000}
                  placeholder="Добавьте детали"
                />
              </label>
            </div>
          </div>

          <details className={styles.moreOptions}>
            <summary>
              <SlidersHorizontal size={16} aria-hidden="true" />
              <span>Дополнительные параметры</span>
              <ChevronDown className={styles.moreChevron} size={16} aria-hidden="true" />
            </summary>
            <p className={styles.moreHint}>Заполняйте, только если хотите отслеживать цель в цифрах.</p>
            <div className={styles.detailGrid}>
              <label className="field"><span className="field-label">Сейчас</span><input name="currentValue" type="number" min="0" step="any" defaultValue={goal?.currentValue ?? 0} required /></label>
              <label className="field"><span className="field-label">Целевое значение</span><input name="targetValue" type="number" min="0.000001" step="any" defaultValue={goal?.targetValue ?? 1} required /></label>
              <label className="field"><span className="field-label">Единица</span><input name="unit" defaultValue={goal?.unit ?? ""} maxLength={32} placeholder="км, ₽, уроков" /></label>
              {goal ? (
                <label className="field"><span className="field-label">Статус</span><select name="status" defaultValue={goal.status}><option value="ACTIVE">Активна</option><option value="COMPLETED">Завершена</option><option value="ARCHIVED">В архиве</option></select></label>
              ) : (
                <input name="status" type="hidden" value="ACTIVE" />
              )}
            </div>
          </details>

          <div className="auth-error" role="alert">{error}</div>
          <div className={`form-actions ${styles.actions}`}>
            <button type="button" className="secondary-button" onClick={onClose} disabled={pending}>Отмена</button>
            <button className="primary-button" disabled={pending}>{pending ? "Сохраняем…" : goal ? "Сохранить" : "Создать цель"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function apiMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") return fallback;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") return (error as { message: string }).message;
  return fallback;
}

function formatValue(value: number, unit: string) {
  const formatted = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
  return unit ? `${formatted} ${unit}` : formatted;
}

function formatTargetDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(value));
}

function statusLabel(status: GoalDto["status"]) {
  if (status === "COMPLETED") return "Завершена";
  if (status === "ARCHIVED") return "В архиве";
  return "Активна";
}
