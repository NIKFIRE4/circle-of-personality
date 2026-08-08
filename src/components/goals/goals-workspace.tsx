"use client";

import {
  AlignLeft,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Layers3,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Target,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import type { Category as OverviewCategory } from "@/components/settings/categories-card";
import type { GoalDto, GoalTaskDto } from "@/lib/goals";
import { calculateGoalProgress } from "@/lib/progress";
import { useSubmitGuard } from "@/lib/use-submit-guard";

import styles from "./goals-workspace.module.css";

type EditableTask = Omit<GoalTaskDto, "completedAt" | "completedThisWeek" | "id" | "sortOrder"> & {
  id?: string;
  description: string | null;
};

type GoalPayload = {
  title: string;
  description: string | null;
  categoryId: string | null;
  unit: string;
  currentValue: number;
  targetValue: number;
  targetDate: string | null;
  status: "ACTIVE" | "COMPLETED" | "ARCHIVED";
  tasks: EditableTask[];
};

type GoalDialogState =
  | { mode: "create"; categoryId: string | null }
  | { mode: "edit"; goal: GoalDto };

type GoalGroup = {
  key: string;
  name: string;
  color: string;
  categoryId: string | null;
  archived: boolean;
  goals: GoalDto[];
};

function buildGoalGroups(goals: GoalDto[], categories: OverviewCategory[]): GoalGroup[] {
  const activeGroups = new Map<string, GoalGroup>(categories.map((category) => [
    category.id,
    { key: category.id, name: category.name, color: category.color, categoryId: category.id, archived: false, goals: [] },
  ]));
  const archivedGroups = new Map<string, GoalGroup>();
  const orphaned: GoalDto[] = [];

  for (const goal of goals) {
    const active = goal.categoryId ? activeGroups.get(goal.categoryId) : undefined;
    if (active) {
      active.goals.push(goal);
      continue;
    }
    if (goal.categoryId) {
      const archived = archivedGroups.get(goal.categoryId) ?? {
        key: goal.categoryId,
        name: goal.category?.name ?? "Архивная сфера",
        color: goal.category?.color ?? "#766a58",
        categoryId: goal.categoryId,
        archived: true,
        goals: [],
      };
      archived.goals.push(goal);
      archivedGroups.set(goal.categoryId, archived);
      continue;
    }
    orphaned.push(goal);
  }

  const groups = [...activeGroups.values(), ...archivedGroups.values()];
  if (orphaned.length) groups.push({ key: "none", name: "Без сферы", color: "#5c5952", categoryId: null, archived: false, goals: orphaned });
  return groups;
}

export function GoalsWorkspace({ initialGoals, categories }: { initialGoals: GoalDto[]; categories: OverviewCategory[] }) {
  const [goals, setGoals] = useState(initialGoals);
  const [dialog, setDialog] = useState<GoalDialogState | null>(null);
  const [error, setError] = useState("");
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const groups = useMemo(() => buildGoalGroups(goals, categories), [goals, categories]);

  function replaceGoal(saved: GoalDto) {
    setGoals((current) => current.map((goal) => goal.id === saved.id ? saved : goal).filter((goal) => goal.status !== "ARCHIVED"));
  }

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
    if (existing) replaceGoal(saved);
    else setGoals((current) => [saved, ...current]);
    setDialog(null);
    setError("");
  }

  async function toggleGoal(goal: GoalDto) {
    setError("");
    const status = goal.status === "COMPLETED" ? "ACTIVE" : "COMPLETED";
    const response = await fetch(`/api/goals/${goal.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return setError(apiMessage(body, "Не удалось изменить статус цели"));
    replaceGoal(body.goal as GoalDto);
  }

  async function toggleTask(goal: GoalDto, task: GoalTaskDto, completed: boolean) {
    setPendingTaskId(task.id);
    setError("");
    try {
      const response = await fetch(`/api/goal-tasks/${task.id}/completion`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ completed }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiMessage(body, "Не удалось отметить шаг"));
      replaceGoal(body.goal as GoalDto);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось отметить шаг");
    } finally {
      setPendingTaskId(null);
    }
  }

  async function deleteGoal(goal: GoalDto, throwOnError = false) {
    if (!window.confirm(`Удалить цель «${goal.title}»? События останутся в календаре, но потеряют связь с целью.`)) return false;
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
          <span className="eyebrow">От намерения к действию</span>
          <h1>Цели</h1>
          <p>Цель задаёт результат, шаги — повторяемые действия, календарь — конкретное время для них.</p>
        </div>
        <button className="new-task-button" onClick={() => setDialog({ mode: "create", categoryId: null })}>
          <Plus size={14} /><span>Добавить цель</span>
        </button>
      </div>

      <section className={styles.logicStrip} aria-label="Как устроены цели">
        <div><b>1</b><span><strong>Сфера</strong> даёт контекст</span></div>
        <i />
        <div><b>2</b><span><strong>Цель</strong> описывает результат</span></div>
        <i />
        <div><b>3</b><span><strong>Шаги</strong> попадают в календарь</span></div>
      </section>

      {error && <div className={styles.toolbarError} role="alert">{error}</div>}

      <div className={styles.groups}>
        {groups.map((group) => (
          <section className={styles.categoryGroup} key={group.key}>
            <div className={styles.categoryGroupHead}>
              <i className={styles.categoryDot} style={{ background: group.color }} />
              <h2>{group.name}</h2>
              {group.archived && <span className={styles.archivedBadge}>архив</span>}
              <span className={styles.categoryCount}>{pluralGoals(group.goals.length)}</span>
            </div>
            {group.goals.length ? (
              <section className={styles.goalGrid}>
                {group.goals.map((goal) => (
                  <GoalCard
                    key={goal.id}
                    goal={goal}
                    pendingTaskId={pendingTaskId}
                    onEdit={() => setDialog({ mode: "edit", goal })}
                    onDelete={() => void deleteGoal(goal)}
                    onToggleGoal={() => void toggleGoal(goal)}
                    onToggleTask={(task, completed) => void toggleTask(goal, task, completed)}
                  />
                ))}
                {!group.archived && <button className={`panel ${styles.newGoalCard}`} onClick={() => setDialog({ mode: "create", categoryId: group.categoryId })}><Plus size={20} /><span>Новая цель</span></button>}
              </section>
            ) : (
              <button className={`panel ${styles.emptyGroup}`} onClick={() => setDialog({ mode: "create", categoryId: group.categoryId })}><Plus size={18} /><span>Добавить первую цель в «{group.name}»</span></button>
            )}
          </section>
        ))}
      </div>

      {!groups.length && <section className={`panel ${styles.empty}`}><div><strong>Сфер пока нет</strong><span>Добавьте сферу в <Link href="/overview">обзоре</Link>, чтобы связать с ней цель.</span></div></section>}

      {dialog && <GoalDialog state={dialog} categories={categories} onClose={() => setDialog(null)} onSave={saveGoal} onDelete={dialog.mode === "edit" ? () => deleteGoal(dialog.goal, true) : undefined} />}
    </>
  );
}

function GoalCard({ goal, pendingTaskId, onEdit, onDelete, onToggleGoal, onToggleTask }: {
  goal: GoalDto;
  pendingTaskId: string | null;
  onEdit: () => void;
  onDelete: () => void;
  onToggleGoal: () => void;
  onToggleTask: (task: GoalTaskDto, completed: boolean) => void;
}) {
  const progress = goalProgress(goal);
  const color = goal.category?.color ?? "#D8A84F";
  const done = goal.status === "COMPLETED";

  return (
    <article className={`panel goal-card ${styles.goalCard} ${done ? styles.completedGoal : ""}`}>
      <div className="goal-top">
        <div className="goal-icon" style={{ color }}><Target size={18} /></div>
        <div className={styles.topActions}>
          <span className="goal-percent">{progress}%</span>
          <button className={`${styles.iconButton} ${done ? styles.doneButton : ""}`} onClick={onToggleGoal} aria-label={done ? `Вернуть цель ${goal.title}` : `Завершить цель ${goal.title}`} title={done ? "Вернуть в активные" : "Завершить цель"}>{done ? <RotateCcw size={14} /> : <CheckCircle2 size={15} />}</button>
          <button className={styles.iconButton} onClick={onEdit} aria-label={`Изменить цель ${goal.title}`}><Pencil size={13} /></button>
          <button className={`${styles.iconButton} ${styles.danger}`} onClick={onDelete} aria-label={`Удалить цель ${goal.title}`}><Trash2 size={13} /></button>
        </div>
      </div>
      <h3>{goal.title}</h3>
      <p>{goal.description || goal.category?.name || "Без сферы"}</p>
      <div className={styles.meta}>
        <span className={styles.status}>{statusLabel(goal.status)}</span>
        {goal.targetDate && <span className={styles.status}>до {formatTargetDate(goal.targetDate)}</span>}
      </div>
      <div className={styles.taskList}>
        {goal.tasks.length ? goal.tasks.map((task) => {
          const milestoneDone = task.status === "COMPLETED";
          const habitDone = task.completedThisWeek >= (task.targetPerWeek ?? 1);
          return (
            <div className={styles.taskRow} key={task.id}>
              <button
                className={`${styles.taskCheck} ${(milestoneDone || habitDone) ? styles.checked : ""}`}
                onClick={() => onToggleTask(task, task.kind === "MILESTONE" ? !milestoneDone : true)}
                disabled={pendingTaskId === task.id || done}
                aria-label={task.kind === "MILESTONE" ? (milestoneDone ? "Вернуть шаг" : "Завершить шаг") : "Отметить выполнение"}
              >{milestoneDone || habitDone ? <Check size={13} /> : <Circle size={13} />}</button>
              <div className={styles.taskBody}>
                <strong>{task.title}</strong>
                <span>{task.kind === "HABIT" ? `${task.completedThisWeek} из ${task.targetPerWeek} на этой неделе` : (milestoneDone ? "Этап выполнен" : "Разовый этап")}</span>
              </div>
              {task.kind === "HABIT" && task.completedThisWeek > 0 && !done && <button className={styles.undoTask} onClick={() => onToggleTask(task, false)} disabled={pendingTaskId === task.id} title="Убрать последнюю быструю отметку"><Minus size={12} /></button>}
              {!done && <Link className={styles.scheduleTask} href={`/calendar?create=1&goalId=${goal.id}&taskId=${task.id}`} title="Запланировать в календаре"><CalendarPlus size={14} /></Link>}
            </div>
          );
        }) : <button className={styles.addSteps} onClick={onEdit}><Plus size={14} /> Добавьте шаги, которые можно запланировать</button>}
      </div>
      <div className="goal-progress"><span style={{ width: `${progress}%`, background: color }} /></div>
      <div className="goal-footer"><span>{goal.tasks.length ? `${completedSteps(goal)} выполнено` : formatValue(goal.currentValue, goal.unit)}</span><span>{goal.tasks.length ? `${goal.tasks.length} шагов` : formatValue(goal.targetValue, goal.unit)}</span></div>
    </article>
  );
}

function GoalDialog({ state, categories, onClose, onSave, onDelete }: {
  state: GoalDialogState;
  categories: OverviewCategory[];
  onClose: () => void;
  onSave: (payload: GoalPayload) => Promise<void>;
  onDelete?: () => Promise<boolean>;
}) {
  const goal = state.mode === "edit" ? state.goal : null;
  const initialCategoryId = state.mode === "create" ? state.categoryId ?? "" : goal?.categoryId ?? "";
  const { pending, guard } = useSubmitGuard();
  const [error, setError] = useState("");
  const [tasks, setTasks] = useState<EditableTask[]>(() => goal?.tasks.map(({ id, title, description, kind, targetPerWeek, durationMinutes, status }) => ({ id, title, description, kind, targetPerWeek, durationMinutes, status })) ?? []);

  function updateTask(index: number, patch: Partial<EditableTask>) {
    setTasks((current) => current.map((task, taskIndex) => taskIndex === index ? { ...task, ...patch } : task));
  }

  function addTask(kind: EditableTask["kind"] = "HABIT") {
    setTasks((current) => [...current, { title: "", description: null, kind, targetPerWeek: kind === "HABIT" ? 3 : null, durationMinutes: 30, status: "ACTIVE" }]);
  }

  function action(formData: FormData) {
    setError("");
    if (tasks.some((task) => !task.title.trim())) return setError("Назовите каждый шаг или удалите пустой.");
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
      tasks: tasks.map((task) => ({ ...task, title: task.title.trim(), description: task.description?.trim() || null })),
    };
    guard(async () => {
      try { await onSave(payload); }
      catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось сохранить цель"); }
    });
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal-card ${styles.dialog}`} role="dialog" aria-modal="true" aria-labelledby="goal-dialog-title">
        <div className={`modal-head ${styles.dialogHeader}`}>
          <h2 id="goal-dialog-title">{goal ? "Изменить цель" : "Новая цель"}</h2>
          <div className={styles.headerActions}>
            {onDelete && <button type="button" className={`${styles.headerButton} ${styles.headerDelete}`} onClick={() => void onDelete()} disabled={pending} aria-label="Удалить цель"><Trash2 size={15} /></button>}
            <button type="button" className={styles.headerButton} onClick={onClose} aria-label="Закрыть"><X size={16} /></button>
          </div>
        </div>
        <form action={action} className={styles.dialogForm}>
          <input className={styles.titleInput} name="title" defaultValue={goal?.title ?? ""} maxLength={200} placeholder="Какой результат хотите получить?" aria-label="Название цели" autoFocus required />
          <div className={styles.quickFields}>
            <div className={styles.quickField}><CalendarDays size={18} /><label className={styles.quickBody}><span className={styles.quickLabel}>Срок</span><input name="targetDate" type="date" defaultValue={goal?.targetDate?.slice(0, 10) ?? ""} /></label></div>
            <div className={styles.quickField}><Layers3 size={18} /><label className={styles.quickBody}><span className={styles.quickLabel}>Сфера</span><select name="categoryId" defaultValue={initialCategoryId}><option value="">Без сферы</option>{goal?.category && !categories.some((category) => category.id === goal.categoryId) && <option value={goal.category.id}>{goal.category.name} · архив</option>}{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label></div>
            <div className={`${styles.quickField} ${styles.descriptionField}`}><AlignLeft size={18} /><label className={styles.quickBody}><span className={styles.quickLabel}>Зачем</span><textarea name="description" defaultValue={goal?.description ?? ""} maxLength={10_000} placeholder="Как поймёте, что цель действительно достигнута?" /></label></div>
          </div>

          <section className={styles.taskEditorSection}>
            <div className={styles.taskEditorHead}><div><span className="eyebrow">Действия</span><h3>Шаги к цели</h3></div><button type="button" className="small-button accent" onClick={() => addTask()}><Plus size={13} /> Шаг</button></div>
            <p>Повторяемые действия считаются каждую неделю; разовый этап закрывается один раз.</p>
            <div className={styles.taskEditors}>
              {tasks.map((task, index) => (
                <div className={styles.taskEditor} key={task.id ?? `new-${index}`}>
                  <input className={styles.taskTitleInput} value={task.title} onChange={(event) => updateTask(index, { title: event.target.value })} placeholder="Например, пробежка в спокойном темпе" maxLength={200} aria-label={`Название шага ${index + 1}`} />
                  <select value={task.kind} onChange={(event) => { const kind = event.target.value as EditableTask["kind"]; updateTask(index, { kind, targetPerWeek: kind === "HABIT" ? (task.targetPerWeek ?? 1) : null }); }} aria-label={`Тип шага ${index + 1}`}><option value="HABIT">Каждую неделю</option><option value="MILESTONE">Разовый этап</option></select>
                  {task.kind === "HABIT" && <label><input type="number" min="1" max="14" value={task.targetPerWeek ?? 1} onChange={(event) => updateTask(index, { targetPerWeek: Number(event.target.value) })} /><span>раз в неделю</span></label>}
                  <label><input type="number" min="5" max="480" step="5" value={task.durationMinutes} onChange={(event) => updateTask(index, { durationMinutes: Number(event.target.value) })} /><span>минут</span></label>
                  <button type="button" className={styles.removeTask} onClick={() => setTasks((current) => current.filter((_, taskIndex) => taskIndex !== index))} aria-label={`Удалить шаг ${index + 1}`}><Trash2 size={13} /></button>
                </div>
              ))}
              {!tasks.length && <button type="button" className={styles.emptyTasks} onClick={() => addTask()}><Plus size={16} /> Добавить первое конкретное действие</button>}
            </div>
          </section>

          <details className={styles.moreOptions}>
            <summary><SlidersHorizontal size={16} /><span>Числовой показатель цели</span><ChevronDown className={styles.moreChevron} size={16} /></summary>
            <p className={styles.moreHint}>Необязательно: деньги, километры, уроки или другой итоговый показатель.</p>
            <div className={styles.detailGrid}>
              <label className="field"><span className="field-label">Сейчас</span><input name="currentValue" type="number" min="0" step="any" defaultValue={goal?.currentValue ?? 0} required /></label>
              <label className="field"><span className="field-label">Цель</span><input name="targetValue" type="number" min="0.000001" step="any" defaultValue={goal?.targetValue ?? 1} required /></label>
              <label className="field"><span className="field-label">Единица</span><input name="unit" defaultValue={goal?.unit ?? ""} maxLength={32} placeholder="км, ₽, уроков" /></label>
              {goal ? <label className="field"><span className="field-label">Статус</span><select name="status" defaultValue={goal.status}><option value="ACTIVE">Активна</option><option value="COMPLETED">Завершена</option><option value="ARCHIVED">В архиве</option></select></label> : <input name="status" type="hidden" value="ACTIVE" />}
            </div>
          </details>
          <div className="auth-error" role="alert">{error}</div>
          <div className={`form-actions ${styles.actions}`}><button type="button" className="secondary-button" onClick={onClose} disabled={pending}>Отмена</button><button className="primary-button" disabled={pending}>{pending ? "Сохраняем…" : goal ? "Сохранить" : "Создать цель"}</button></div>
        </form>
      </section>
    </div>
  );
}

function goalProgress(goal: GoalDto) {
  if (goal.status === "COMPLETED") return 100;
  if (!goal.tasks.length) return Math.round(calculateGoalProgress(goal.currentValue, goal.targetValue));
  const sum = goal.tasks.reduce((total, task) => total + (task.kind === "MILESTONE" ? (task.status === "COMPLETED" ? 1 : 0) : Math.min(1, task.completedThisWeek / (task.targetPerWeek ?? 1))), 0);
  return Math.round((sum / goal.tasks.length) * 100);
}

function completedSteps(goal: GoalDto) {
  return goal.tasks.filter((task) => task.kind === "MILESTONE" ? task.status === "COMPLETED" : task.completedThisWeek >= (task.targetPerWeek ?? 1)).length;
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

function pluralGoals(count: number): string {
  const noun = { one: "цель", few: "цели", many: "целей" }[new Intl.PluralRules("ru-RU").select(count) as "one" | "few" | "many"] ?? "целей";
  return `${count} ${noun}`;
}
