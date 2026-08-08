"use client";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, { type DateClickArg } from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import ruLocale from "@fullcalendar/core/locales/ru";
import timeGridPlugin from "@fullcalendar/timegrid";
import type { DateSelectArg, EventClickArg } from "@fullcalendar/core";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { CalendarPlus, ChevronLeft, ChevronRight, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import {
  VoiceTaskDialog,
  type VoiceTaskCategory,
  type VoiceTaskDraft,
} from "@/components/calendar/voice-task-dialog";
import {
  fullCalendarMarkerToUtc,
  toFullCalendarInput,
  toZonedInputValue,
  zonedInputToIso,
} from "@/lib/calendar-time";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import type { GoalDto } from "@/lib/goals";

import styles from "./calendar-workspace.module.css";

type EventStatus = "PLANNED" | "COMPLETED" | "CANCELLED";
type EventSource = "MANUAL" | "VOICE" | "GOAL" | "GOOGLE" | "APPLE";

type Category = VoiceTaskCategory & {
  color: string;
};

type ApiEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  includeInBalance: boolean;
  status: EventStatus;
  source: EventSource;
  calendarConnectionId: string | null;
  categoryId: string | null;
  category: { id: string; name: string; color: string } | null;
  goalId: string | null;
  goalTaskId: string | null;
  goal: { id: string; title: string; status: GoalDto["status"] } | null;
  goalTask: { id: string; title: string; kind: "HABIT" | "MILESTONE" } | null;
};

type EventDraft = VoiceTaskDraft & {
  id?: string;
  description?: string | null;
  location?: string | null;
  allDay?: boolean;
  includeInBalance?: boolean;
  status?: EventStatus;
  source?: EventSource;
  calendarConnectionId?: string | null;
  categoryName?: string;
  goalId?: string;
  goalTaskId?: string;
  goalTitle?: string;
  goalTaskTitle?: string;
};

type VisibleRange = { start: Date; end: Date };

type CalendarView = "timeGridDay" | "timeGridWeek" | "listWeek";

const MOBILE_QUERY = "(max-width: 760px)";

/**
 * A seven-column week grid leaves roughly 45px per day on a phone, which is too
 * narrow to read an event title or aim at a time slot. Mobile therefore opens
 * as a readable agenda and keeps the single-day grid one tap away for spatial
 * planning and range selection.
 */
function useIsMobile(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(MOBILE_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(MOBILE_QUERY).matches,
    // The server has no viewport; the desktop week view is the safe default and
    // the effect below corrects it on the client before paint.
    () => false,
  );
}

export function CalendarWorkspace({
  timeZone,
  initialCreate = false,
  initialGoalId,
  initialGoalTaskId,
}: {
  timeZone: string;
  initialCreate?: boolean;
  initialGoalId?: string;
  initialGoalTaskId?: string;
}) {
  const router = useRouter();
  const [today] = useState(() => new Date());
  const calendarRef = useRef<FullCalendar>(null);
  const rangeAbortRef = useRef<AbortController | null>(null);
  const feedSyncStartedRef = useRef(false);
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [goals, setGoals] = useState<GoalDto[]>([]);
  const [visibleRange, setVisibleRange] = useState<VisibleRange | null>(null);
  const [viewTitle, setViewTitle] = useState("");
  const [eventModal, setEventModal] = useState<EventDraft | null>(() => initialCreate ? defaultDraft(timeZone, initialGoalId, initialGoalTaskId) : null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const isMobile = useIsMobile();
  const [view, setView] = useState<CalendarView>("timeGridWeek");
  // Once the view is picked by hand, crossing the breakpoint must not undo it.
  const viewPickedByUserRef = useRef(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");

  const loadRange = useCallback(async (start: Date, end: Date) => {
    rangeAbortRef.current?.abort();
    const controller = new AbortController();
    rangeAbortRef.current = controller;
    setLoading(true);
    setLoadError("");
    try {
      const result = await requestEvents(start, end, controller.signal);
      setEvents(result);
      if (result.length === 500) {
        setLoadError("В диапазоне больше 500 событий. Уменьшите период просмотра.");
      }
    } catch (caught) {
      if (!controller.signal.aborted) setLoadError(errorMessage(caught, "Не удалось загрузить события"));
    } finally {
      if (rangeAbortRef.current === controller) {
        rangeAbortRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const response = await fetch("/api/categories");
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiMessage(body, "Не удалось загрузить сферы"));
      if (!Array.isArray(body.categories)) throw new Error("Сервер вернул некорректный список сфер");
      setCategories(body.categories);
    } catch (caught) {
      setLoadError(errorMessage(caught, "Не удалось загрузить сферы"));
    }
  }, []);

  const loadGoals = useCallback(async () => {
    try {
      const response = await fetch("/api/goals?status=ACTIVE");
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiMessage(body, "Не удалось загрузить цели"));
      if (!Array.isArray(body.goals)) throw new Error("Сервер вернул некорректный список целей");
      setGoals(body.goals);
    } catch (caught) {
      setLoadError(errorMessage(caught, "Не удалось загрузить цели"));
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCategories();
      void loadGoals();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      rangeAbortRef.current?.abort();
    };
  }, [loadCategories, loadGoals]);

  useEffect(() => {
    if (!actionSuccess) return;
    const timer = window.setTimeout(() => setActionSuccess(""), 6_000);
    return () => window.clearTimeout(timer);
  }, [actionSuccess]);

  useEffect(() => {
    if (viewPickedByUserRef.current) return;
    const responsiveView: CalendarView = isMobile ? "listWeek" : "timeGridWeek";
    setView(responsiveView);
    calendarRef.current?.getApi().changeView(responsiveView);
  }, [isMobile]);

  function selectView(next: CalendarView) {
    viewPickedByUserRef.current = true;
    setView(next);
    calendarRef.current?.getApi().changeView(next);
  }

  useEffect(() => {
    if (!visibleRange || feedSyncStartedRef.current) return;
    feedSyncStartedRef.current = true;
    const controller = new AbortController();

    void fetch("/api/integrations/calendar-feeds/sync", {
      method: "POST",
      signal: controller.signal,
    }).then((response) => {
      if (!response.ok || controller.signal.aborted) return;
      void loadRange(visibleRange.start, visibleRange.end);
    }).catch(() => {
      // Calendar subscriptions refresh quietly; the already imported snapshot
      // remains usable when a provider is temporarily unavailable.
    });

    return () => controller.abort();
  }, [loadRange, visibleRange]);

  const calendarEvents = useMemo(() => events.map((event) => ({
    id: event.id,
    title: event.title,
    start: toFullCalendarInput(event.startAt, timeZone, event.allDay),
    end: toFullCalendarInput(event.endAt, timeZone, event.allDay),
    allDay: event.allDay,
    editable: !isImportedEvent(event),
    backgroundColor: event.status === "CANCELLED" ? "#514d47" : event.category?.color || "#766a58",
    borderColor: "transparent",
    classNames: event.status === "CANCELLED" ? [styles.cancelled] : [],
    extendedProps: { source: event.source },
  })), [events, timeZone]);

  function handleDatesSet(arg: { start: Date; end: Date; view: { title: string } }) {
    const range = {
      start: fullCalendarMarkerToUtc(arg.start, timeZone),
      end: fullCalendarMarkerToUtc(arg.end, timeZone),
    };
    setViewTitle(arg.view.title);
    setVisibleRange(range);
    void loadRange(range.start, range.end);
  }

  function openForDate(arg: DateClickArg | DateSelectArg) {
    const startMarker = "start" in arg ? arg.start : arg.date;
    const allDay = arg.allDay;
    const endMarker = "end" in arg
      ? arg.end
      : new Date(startMarker.getTime() + (allDay ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000));
    const start = fullCalendarMarkerToUtc(startMarker, timeZone);
    const end = fullCalendarMarkerToUtc(endMarker, timeZone);
    setActionError("");
    setEventModal({
      title: "",
      startAt: toZonedInputValue(start, timeZone, allDay),
      endAt: toZonedInputValue(end, timeZone, allDay),
      allDay,
      includeInBalance: true,
      status: "PLANNED",
      source: "MANUAL",
    });
  }

  async function saveEvent(draft: EventDraft) {
    const allDay = draft.allDay ?? false;
    const importedEvent = isImportedEvent(draft);
    const common = importedEvent
      ? {
          categoryId: draft.categoryId || null,
          goalId: draft.goalId || null,
          goalTaskId: draft.goalTaskId || null,
          status: draft.status ?? "PLANNED",
          includeInBalance: draft.includeInBalance ?? true,
        }
      : {
          title: draft.title.trim(),
          description: draft.description?.trim() || null,
          location: draft.location?.trim() || null,
          startAt: zonedInputToIso(draft.startAt, timeZone),
          endAt: zonedInputToIso(draft.endAt, timeZone),
          categoryId: draft.categoryId || null,
          goalId: draft.goalId || null,
          goalTaskId: draft.goalTaskId || null,
          allDay,
          includeInBalance: draft.includeInBalance ?? true,
          status: draft.status ?? "PLANNED",
        };
    const creating = !draft.id;
    const payload = creating
      ? {
          ...common,
          source: draft.voiceCommandId ? "VOICE" : "MANUAL",
          voiceCommandId: draft.voiceCommandId || null,
        }
      : common;

    setActionError("");
    setActionSuccess("");
    const response = await fetch(creating ? "/api/events" : `/api/events/${draft.id}`, {
      method: creating ? "POST" : "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(apiMessage(body, "Не удалось сохранить событие"));

    const saved = body.event as ApiEvent;
    setEvents((current) => upsertVisibleEvent(current, saved, visibleRange));
    void loadGoals();
    router.refresh();
    setEventModal(null);
    setVoiceOpen(false);
    if (draft.smartInput) {
      setActionSuccess(`${draft.voiceCommandId ? "Голосовая" : "Умная"} задача «${saved.title}» создана.`);
      calendarRef.current?.getApi().gotoDate(toFullCalendarInput(saved.startAt, timeZone, saved.allDay));
    }
    clearCreateQuery();
  }

  async function deleteEvent(event: EventDraft) {
    if (!event.id) return;
    if (isImportedEvent(event)) {
      throw new Error("Удалите событие в исходном календаре, затем обновите импорт.");
    }
    if (!window.confirm(`Удалить событие «${event.title}»? Это действие нельзя отменить.`)) return;

    const response = await fetch(`/api/events/${event.id}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(apiMessage(body, "Не удалось удалить событие"));
    }
    setEvents((current) => current.filter((item) => item.id !== event.id));
    void loadGoals();
    router.refresh();
    setEventModal(null);
    clearCreateQuery();
  }

  async function moveEvent(arg: { event: { id: string; start: Date | null; end: Date | null; allDay: boolean }; revert: () => void }) {
    const existing = events.find((event) => event.id === arg.event.id);
    if (!existing || isImportedEvent(existing) || !arg.event.start || !arg.event.end) {
      arg.revert();
      if (existing && isImportedEvent(existing)) {
        setActionError("Время импортированного события изменяется в исходном календаре.");
      }
      return;
    }

    const response = await fetch(`/api/events/${existing.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        startAt: fullCalendarMarkerToUtc(arg.event.start, timeZone).toISOString(),
        endAt: fullCalendarMarkerToUtc(arg.event.end, timeZone).toISOString(),
        allDay: arg.event.allDay,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      arg.revert();
      setActionError(apiMessage(body, "Не удалось перенести событие"));
      return;
    }
    const updated = body.event as ApiEvent;
    setEvents((current) => current.map((event) => event.id === updated.id ? updated : event));
    router.refresh();
  }

  function eventClick(arg: EventClickArg) {
    const event = events.find((item) => item.id === arg.event.id);
    if (!event) return;
    setActionError("");
    setEventModal(draftFromEvent(event, timeZone));
  }

  function closeEventDialog() {
    setEventModal(null);
    clearCreateQuery();
  }

  function clearCreateQuery() {
    if (initialCreate) router.replace("/calendar", { scroll: false });
  }

  function retryLoading() {
    void loadCategories();
    void loadGoals();
    if (visibleRange) void loadRange(visibleRange.start, visibleRange.end);
  }

  const api = () => calendarRef.current?.getApi();

  return (
    <>
      <div className="calendar-layout">
        <section className="panel calendar-panel">
          <div className="calendar-toolbar">
            <div className="calendar-period-navigation">
              <button className="small-button calendar-arrow-button" onClick={() => api()?.prev()} aria-label="Предыдущий период"><ChevronLeft size={18} /></button>
              <h2 className="calendar-title" aria-live="polite">{viewTitle || "Календарь"}</h2>
              <button className="small-button calendar-arrow-button" onClick={() => api()?.next()} aria-label="Следующий период"><ChevronRight size={18} /></button>
            </div>
            <div className="calendar-tools">
              <button className="small-button calendar-today-button" onClick={() => api()?.today()}>Сегодня</button>
              <span className="calendar-view-switch" role="group" aria-label="Масштаб календаря">
                <button
                  className={`small-button ${view === "timeGridDay" ? "accent" : ""}`}
                  onClick={() => selectView("timeGridDay")}
                  aria-pressed={view === "timeGridDay"}
                >День</button>
                <button
                  className={`small-button calendar-week-view ${view === "timeGridWeek" ? "accent" : ""}`}
                  onClick={() => selectView("timeGridWeek")}
                  aria-pressed={view === "timeGridWeek"}
                >Неделя</button>
                <button
                  className={`small-button calendar-list-view ${view === "listWeek" ? "accent" : ""}`}
                  onClick={() => selectView("listWeek")}
                  aria-pressed={view === "listWeek"}
                >Расписание</button>
              </span>
              <button className="small-button accent calendar-create-button" onClick={() => setEventModal(defaultDraft(timeZone))}>
                <CalendarPlus size={17} /> <span>Событие</span>
              </button>
            </div>
          </div>
          <div className={styles.noticeStack}>
            {(loadError || actionError) && (
              <div className={`${styles.notice} ${styles.error}`} role="alert">
                <span>{actionError || loadError}</span>
                {loadError && <button className="small-button" onClick={retryLoading}>Повторить</button>}
              </div>
            )}
            {actionSuccess && <div className={`${styles.notice} ${styles.success}`} role="status">{actionSuccess}</div>}
            {loading && <div className={styles.notice}>Загружаем события выбранного периода…</div>}
            {!loading && !loadError && !events.length && view !== "listWeek" && <div className={`${styles.notice} ${styles.empty}`}>В этом периоде событий нет. Коснитесь времени, чтобы добавить первое.</div>}
          </div>
          <div
            className={`${styles.calendarFrame} ${view === "timeGridWeek" ? styles.dayScroll : ""} ${view === "listWeek" ? styles.listView : ""}`}
          >
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
              initialView="timeGridWeek"
              // Taller rows give a comfortable drag target on touch; the day
              // view has the width to spare, so it does not cost readability.
              slotDuration="00:30:00"
              snapDuration="00:15:00"
              initialDate={toFullCalendarInput(today, timeZone, true)}
              now={() => toFullCalendarInput(new Date(), timeZone, false)}
              timeZone={timeZone}
              locale={ruLocale}
              headerToolbar={false}
              height="100%"
              expandRows
              stickyHeaderDates
              allDaySlot
              nowIndicator
              editable
              selectable
              selectMirror
              // FullCalendar waits a full second before a touch turns into a
              // drag (longPressDelay defaults to 1000ms), so on a phone a swipe
              // across the grid scrolled the page instead of selecting a range.
              longPressDelay={180}
              selectLongPressDelay={180}
              eventLongPressDelay={320}
              selectMinDistance={2}
              firstDay={1}
              slotMinTime="06:00:00"
              slotMaxTime="23:00:00"
              noEventsContent="На ближайшие семь дней событий нет"
              events={calendarEvents}
              datesSet={handleDatesSet}
              dateClick={openForDate}
              select={openForDate}
              eventClick={eventClick}
              eventDrop={(arg) => void moveEvent(arg)}
              eventResize={(arg) => void moveEvent(arg)}
            />
          </div>
        </section>
      </div>
      <button
        className="voice-fab"
        onClick={() => { setActionSuccess(""); setVoiceOpen(true); }}
        aria-haspopup="dialog"
        aria-expanded={voiceOpen}
      ><i><Sparkles size={15} /></i><span>Умная задача</span></button>
      {eventModal && <EventDialog draft={eventModal} categories={categories} goals={goals} onClose={closeEventDialog} onSave={saveEvent} onDelete={deleteEvent} />}
      {voiceOpen && <VoiceTaskDialog categories={categories} timeZone={timeZone} onClose={() => setVoiceOpen(false)} onSave={saveEvent} />}
    </>
  );
}

function EventDialog({
  draft,
  categories,
  goals,
  onClose,
  onSave,
  onDelete,
}: {
  draft: EventDraft;
  categories: Category[];
  goals: GoalDto[];
  onClose: () => void;
  onSave: (draft: EventDraft) => Promise<void>;
  onDelete: (draft: EventDraft) => Promise<void>;
}) {
  const [allDay, setAllDay] = useState(draft.allDay ?? false);
  const [includeInBalance, setIncludeInBalance] = useState(draft.includeInBalance ?? true);
  const [selectedGoalId, setSelectedGoalId] = useState(draft.goalId ?? "");
  const [selectedTaskId, setSelectedTaskId] = useState(draft.goalTaskId ?? "");
  const [title, setTitle] = useState(draft.title);
  const [error, setError] = useState("");
  const { pending, guard } = useSubmitGuard();
  const importedEvent = isImportedEvent(draft);
  const sourceName = calendarSourceName(draft);
  const selectedGoal = goals.find((goal) => goal.id === selectedGoalId);
  const availableTasks = selectedGoal?.tasks.filter((task) => task.status === "ACTIVE" || task.id === selectedTaskId) ?? [];
  const suggestedTitle = !draft.id && draft.goalTaskId
    ? goals.flatMap((goal) => goal.tasks).find((item) => item.id === draft.goalTaskId)?.title ?? ""
    : "";

  function action(formData: FormData) {
    setError("");
    guard(async () => {
      try {
        await onSave({
          ...draft,
          title: String(formData.get("title") ?? (title || suggestedTitle)),
          description: String(formData.get("description") ?? draft.description ?? ""),
          location: String(formData.get("location") ?? draft.location ?? ""),
          startAt: String(formData.get("startAt") ?? draft.startAt),
          endAt: String(formData.get("endAt") ?? draft.endAt),
          categoryId: String(formData.get("categoryId") || ""),
          goalId: selectedGoalId,
          goalTaskId: selectedTaskId,
          allDay,
          includeInBalance,
          status: String(formData.get("status") || "PLANNED") as EventStatus,
        });
      } catch (caught) {
        setError(errorMessage(caught, "Не удалось сохранить событие"));
      }
    });
  }

  function remove() {
    setError("");
    guard(async () => {
      try {
        await onDelete(draft);
      } catch (caught) {
        setError(errorMessage(caught, "Не удалось удалить событие"));
      }
    });
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="event-dialog-title">
        <div className="modal-head">
          <div><span className="eyebrow">Планирование</span><h2 id="event-dialog-title">{draft.id ? "Изменить событие" : "Новое событие"}</h2></div>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть"><X size={15} /></button>
        </div>
        {importedEvent && <p className={styles.sourceNote}>Событие импортировано из {sourceName}. Здесь можно изменить сферу, связь с целью и локальный статус. Название, время и удаление управляются в исходном календаре.</p>}
        <form action={action}>
          <div className="form-grid">
            <label className="field full"><span className="field-label">Название</span><input name="title" value={title || suggestedTitle} onChange={(event) => setTitle(event.target.value)} placeholder="Например, танцевальная практика" maxLength={200} disabled={importedEvent} required /></label>
            <label className="field full"><span className="field-label">Описание</span><textarea className={styles.description} name="description" defaultValue={draft.description ?? ""} maxLength={10_000} disabled={importedEvent} /></label>
            <label className="field full"><span className="field-label">Место</span><input name="location" defaultValue={draft.location ?? ""} maxLength={500} disabled={importedEvent} /></label>
            <label className="field full"><span className="field-label">Формат</span><span className={styles.checkbox}><input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} disabled={importedEvent} /> Весь день</span></label>
            <label className="field"><span className="field-label">Начало</span><input key={`start-${allDay}`} name="startAt" type={allDay ? "date" : "datetime-local"} defaultValue={inputDefault(draft.startAt, allDay, false)} disabled={importedEvent} required /></label>
            <label className="field"><span className="field-label">Завершение</span><input key={`end-${allDay}`} name="endAt" type={allDay ? "date" : "datetime-local"} defaultValue={endInputDefault(draft.startAt, draft.endAt, allDay)} disabled={importedEvent} required /></label>
            <label className="field"><span className="field-label">Сфера жизни</span><select name="categoryId" defaultValue={draft.categoryId ?? ""}><option value="">Без категории</option>{draft.categoryId && !categories.some((category) => category.id === draft.categoryId) && <option value={draft.categoryId}>{draft.categoryName || "Архивная сфера"} · архив</option>}{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <label className="field"><span className="field-label">Статус</span><select name="status" defaultValue={draft.status ?? "PLANNED"}><option value="PLANNED">Запланировано</option><option value="COMPLETED">Выполнено</option><option value="CANCELLED">Отменено</option></select></label>
            <label className="field"><span className="field-label">Цель</span><select value={selectedGoalId} onChange={(event) => { setSelectedGoalId(event.target.value); setSelectedTaskId(""); }}><option value="">Без цели</option>{draft.goalId && !goals.some((goal) => goal.id === draft.goalId) && <option value={draft.goalId}>{draft.goalTitle || "Неактивная цель"}</option>}{goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label>
            <label className="field"><span className="field-label">Шаг цели</span><select value={selectedTaskId} onChange={(event) => { const nextId = event.target.value; setSelectedTaskId(nextId); const task = availableTasks.find((item) => item.id === nextId); if (task && !title.trim()) setTitle(task.title); }} disabled={!selectedGoalId}><option value="">Без конкретного шага</option>{draft.goalTaskId && !availableTasks.some((task) => task.id === draft.goalTaskId) && <option value={draft.goalTaskId}>{draft.goalTaskTitle || "Завершённый шаг"}</option>}{availableTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
            <label className="field full"><span className="field-label">Колесо баланса</span><span className={styles.checkbox}><input type="checkbox" checked={includeInBalance} onChange={(event) => setIncludeInBalance(event.target.checked)} /> Учитывать эту задачу в колесе баланса</span></label>
          </div>
          <div className="auth-error" role="alert">{error}</div>
          <div className="form-actions">
            {draft.id && !importedEvent && <button type="button" className={`secondary-button ${styles.dangerButton}`} onClick={() => void remove()} disabled={pending}>Удалить</button>}
            <button type="button" className="secondary-button" onClick={onClose} disabled={pending}>Отмена</button>
            <button className="primary-button" disabled={pending}>{pending ? "Сохраняем…" : draft.id ? "Сохранить" : "Создать событие"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

async function requestEvents(start: Date, end: Date, signal?: AbortSignal): Promise<ApiEvent[]> {
  const query = new URLSearchParams({ from: start.toISOString(), to: end.toISOString(), limit: "500" });
  const response = await fetch(`/api/events?${query}`, { signal });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiMessage(body, "Не удалось загрузить события"));
  if (!Array.isArray(body.events)) throw new Error("Сервер вернул некорректный список событий");
  return body.events;
}

function draftFromEvent(event: ApiEvent, timeZone: string): EventDraft {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    location: event.location,
    startAt: toZonedInputValue(event.startAt, timeZone, event.allDay),
    endAt: toZonedInputValue(event.endAt, timeZone, event.allDay),
    categoryId: event.categoryId ?? undefined,
    categoryName: event.category?.name,
    goalId: event.goalId ?? undefined,
    goalTaskId: event.goalTaskId ?? undefined,
    goalTitle: event.goal?.title,
    goalTaskTitle: event.goalTask?.title,
    allDay: event.allDay,
    includeInBalance: event.includeInBalance,
    status: event.status,
    source: event.source,
    calendarConnectionId: event.calendarConnectionId,
  };
}

type ImportableEvent = Pick<EventDraft, "source" | "calendarConnectionId">;

function isImportedEvent(event: ImportableEvent) {
  return event.source === "GOOGLE" || event.source === "APPLE" || Boolean(event.calendarConnectionId);
}

function calendarSourceName(event: ImportableEvent) {
  if (event.source === "GOOGLE") return "Google Calendar";
  if (event.source === "APPLE") return "Apple Calendar";
  return "внешнего календаря";
}

function defaultDraft(timeZone: string, goalId?: string, goalTaskId?: string): EventDraft {
  const local = toZonedTime(new Date(), timeZone);
  local.setMinutes(Math.ceil(local.getMinutes() / 30) * 30, 0, 0);
  const start = fromZonedTime(local, timeZone);
  return {
    title: "",
    startAt: toZonedInputValue(start, timeZone, false),
    endAt: toZonedInputValue(new Date(start.getTime() + 60 * 60 * 1000), timeZone, false),
    allDay: false,
    includeInBalance: true,
    status: "PLANNED",
    source: "MANUAL",
    goalId,
    goalTaskId,
  };
}

function inputDefault(value: string, allDay: boolean, end: boolean) {
  const date = value.slice(0, 10);
  if (allDay) return date;
  if (value.includes("T") && value.length >= 16) return value.slice(0, 16);
  return `${date}T${end ? "10:00" : "09:00"}`;
}

function endInputDefault(startValue: string, endValue: string, allDay: boolean) {
  const end = inputDefault(endValue, allDay, true);
  if (!allDay || end > startValue.slice(0, 10)) return end;
  const nextDay = new Date(`${startValue.slice(0, 10)}T00:00:00.000Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return nextDay.toISOString().slice(0, 10);
}

function upsertVisibleEvent(current: ApiEvent[], event: ApiEvent, range: VisibleRange | null) {
  const withoutEvent = current.filter((item) => item.id !== event.id);
  if (!range || (new Date(event.endAt) > range.start && new Date(event.startAt) < range.end)) {
    return [...withoutEvent, event].sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime());
  }
  return withoutEvent;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function apiMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") return fallback;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") return (error as { message: string }).message;
  return fallback;
}
