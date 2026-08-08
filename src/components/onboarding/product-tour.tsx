"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  Crosshair,
  Goal,
  Info,
  Plus,
  Send,
  Settings,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";

import styles from "./product-tour.module.css";

type TourStep = {
  id: string;
  kicker: string;
  title: string;
  description: string;
  detail: string;
  target?: string;
  contact?: { label: string; href: string };
  icon: LucideIcon;
};

const steps: TourStep[] = [
  {
    id: "welcome",
    kicker: "Ваш проводник по балансу",
    title: "Знакомьтесь, Искра",
    description: "За пару минут она покажет, как превратить планы, цели и календарь в понятную картину вашей недели.",
    detail: "В руководстве 6 коротких остановок. Его можно пропустить и открыть снова в любой момент.",
    icon: Sparkles,
  },
  {
    id: "overview",
    kicker: "Шаг 1 · Живой профиль",
    title: "Начинайте с обзора",
    description: "Здесь видно, каким сферам досталось ваше время и где неделе не хватает равновесия.",
    detail: "Проценты сравнивают фактическое время с недельными ориентирами, а образ в центре меняется вместе с вашим главным фокусом.",
    target: "overview",
    icon: Crosshair,
  },
  {
    id: "calendar",
    kicker: "Шаг 2 · Время в контексте",
    title: "Планируйте в календаре",
    description: "Создавайте события, назначайте им жизненную сферу и связывайте их с конкретными шагами к цели.",
    detail: "Быстрый ввод понимает обычный текст, а при подключённом распознавании — и голос. Внешние календари синхронизируются в настройках.",
    target: "calendar",
    icon: CalendarDays,
  },
  {
    id: "goals",
    kicker: "Шаг 3 · От намерения к действию",
    title: "Разложите цели на шаги",
    description: "Добавляйте разовые этапы и повторяющиеся привычки, отмечайте прогресс и переносите следующий шаг в календарь.",
    detail: "Так цель перестаёт быть абстракцией: каждое действие получает время, сферу и понятный статус.",
    target: "goals",
    icon: Goal,
  },
  {
    id: "insights",
    kicker: "Шаг 4 · Паттерны недели",
    title: "Замечайте изменения",
    description: "Аналитика показывает динамику баланса, выполненный объём и сферы, которым сейчас особенно нужно внимание.",
    detail: "Смотрите не на идеальную цифру, а на устойчивый тренд — Искра помогает вовремя заметить перекос.",
    target: "insights",
    icon: BarChart3,
  },
  {
    id: "settings",
    kicker: "Шаг 5 · Ваши правила",
    title: "Настройте пространство под себя",
    description: "Выберите жизненные сферы, задайте недельные ориентиры и подключите Google Calendar или календарную ссылку.",
    detail: "Названия, цвета и цели по времени сразу отражаются в обзоре и аналитике.",
    target: "settings",
    icon: Settings,
  },
  {
    id: "create",
    kicker: "Шаг 6 · Самый быстрый старт",
    title: "Добавьте первое действие",
    description: "Кнопка «Новая задача» всегда рядом: опишите задачу своими словами, проверьте детали и сохраните её в календаре.",
    detail: "Начните с одного реального действия на этой неделе — остальная картина соберётся вокруг него.",
    target: "create",
    icon: Plus,
  },
  {
    id: "finish",
    kicker: "Маршрут готов",
    title: "Теперь найдём ваш ритм",
    description: "Добавьте событие, свяжите его со сферой и вернитесь в обзор — так вы сразу увидите, как работает контур.",
    detail: "Сайт разработал стажёр компании «КОРУС Консалтинг» Костров Никита.",
    contact: { label: "@Nik_kostrov", href: "https://t.me/Nik_kostrov" },
    icon: Check,
  },
];

type ProductTourProps = {
  storageId: string;
};

type Geometry = {
  left: number;
  top: number;
  width: number;
  height: number;
  cardLeft: number;
  cardTop: number;
};

const emptyGeometry: Geometry = {
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  cardLeft: 0,
  cardTop: 0,
};

export function ProductTour({ storageId }: ProductTourProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [geometry, setGeometry] = useState<Geometry>(emptyGeometry);
  const step = steps[stepIndex];
  const isCentered = !step.target;
  const storageKey = useMemo(() => `contour:onboarding:v1:${storageId}`, [storageId]);

  const openTour = useCallback(() => {
    setStepIndex(0);
    setIsOpen(true);
  }, []);

  const closeTour = useCallback((completed = false) => {
    try {
      window.localStorage.setItem(storageKey, completed ? "completed" : "dismissed");
    } catch {
      // The guide still works when storage is unavailable (for example, in a
      // locked-down browser); it will simply be offered again next time.
    }
    dialogRef.current?.close();
    setIsOpen(false);
  }, [storageKey]);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(storageKey)) return;
    } catch {
      // Continue with a session-only first-run guide.
    }

    const timer = window.setTimeout(() => setIsOpen(true), 700);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();

    if (isOpen) {
      window.requestAnimationFrame(() => titleRef.current?.focus());
    }
  }, [isOpen, stepIndex]);

  const updateGeometry = useCallback(() => {
    if (!step.target) {
      setGeometry(emptyGeometry);
      return;
    }

    const target = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (!target) {
      setGeometry(emptyGeometry);
      return;
    }

    const rect = target.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      setGeometry(emptyGeometry);
      return;
    }

    const padding = 8;
    const gap = 24;
    const cardWidth = 400;
    const cardHeight = 390;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const left = Math.max(8, rect.left - padding);
    const top = Math.max(8, rect.top - padding);
    const width = Math.min(viewportWidth - left - 8, rect.width + padding * 2);
    const height = Math.min(viewportHeight - top - 8, rect.height + padding * 2);

    let cardLeft = rect.right + gap;
    if (cardLeft + cardWidth > viewportWidth - 18) {
      cardLeft = rect.left - gap - cardWidth;
    }
    cardLeft = Math.max(18, Math.min(cardLeft, viewportWidth - cardWidth - 18));

    const desiredTop = rect.top + rect.height / 2 - cardHeight / 2;
    const cardTop = Math.max(18, Math.min(desiredTop, viewportHeight - cardHeight - 18));

    setGeometry({ left, top, width, height, cardLeft, cardTop });
  }, [step.target]);

  useEffect(() => {
    if (!isOpen) return;

    const frame = window.requestAnimationFrame(updateGeometry);
    const target = step.target
      ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)
      : null;
    const observer = target ? new ResizeObserver(updateGeometry) : null;
    if (target && observer) observer.observe(target);
    window.addEventListener("resize", updateGeometry);
    window.addEventListener("scroll", updateGeometry, true);

    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", updateGeometry);
      window.removeEventListener("scroll", updateGeometry, true);
    };
  }, [isOpen, step.target, updateGeometry]);

  function previousStep() {
    setStepIndex((current) => Math.max(0, current - 1));
  }

  function nextStep() {
    if (stepIndex === steps.length - 1) {
      closeTour(true);
      return;
    }
    setStepIndex((current) => Math.min(steps.length - 1, current + 1));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      nextStep();
    }
    if (event.key === "ArrowLeft" && stepIndex > 0) {
      event.preventDefault();
      previousStep();
    }
  }

  const Icon = step.icon;
  const hasVisibleTarget = geometry.width > 0 && geometry.height > 0;
  const centered = isCentered || !hasVisibleTarget;

  return (
    <>
      <button
        ref={triggerRef}
        className={styles.guideButton}
        onClick={openTour}
        type="button"
        aria-label="Открыть руководство по сервису"
        title="Как пользоваться сервисом"
      >
        <Info size={18} aria-hidden="true" />
      </button>

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        onCancel={(event) => {
          event.preventDefault();
          closeTour(false);
        }}
        onClose={() => setIsOpen(false)}
        onKeyDown={handleKeyDown}
        aria-labelledby="product-tour-title"
      >
        {centered ? (
          <div className={styles.veil} aria-hidden="true" />
        ) : (
          <div
            className={styles.spotlight}
            style={{
              left: geometry.left,
              top: geometry.top,
              width: geometry.width,
              height: geometry.height,
            }}
            aria-hidden="true"
          />
        )}

        <section
          key={step.id}
          className={`${styles.card} ${centered ? styles.cardCentered : ""}`}
          style={centered ? undefined : { left: geometry.cardLeft, top: geometry.cardTop }}
        >
          <button
            className={styles.closeButton}
            onClick={() => closeTour(false)}
            type="button"
            aria-label="Закрыть руководство"
          >
            <X size={17} aria-hidden="true" />
          </button>

          <div className={styles.mascotStage} aria-hidden="true">
            <span className={styles.mascotHalo} />
            <Image
              className={styles.mascot}
              src="/onboarding/iskra-v2.webp"
              alt=""
              width={480}
              height={720}
              priority
            />
          </div>

          <div className={styles.copy} aria-live="polite">
            <span className={styles.kicker}><Icon size={13} aria-hidden="true" />{step.kicker}</span>
            <h2 ref={titleRef} id="product-tour-title" tabIndex={-1}>{step.title}</h2>
            <p>{step.description}</p>
            <small>{step.detail}</small>
            {step.contact && (
              <a
                className={styles.contactLink}
                href={step.contact.href}
                target="_blank"
                rel="noreferrer"
              >
                <Send size={13} aria-hidden="true" />
                Telegram · {step.contact.label}
              </a>
            )}
          </div>

          <div className={styles.progress} aria-label={`Шаг ${stepIndex + 1} из ${steps.length}`}>
            {steps.map((item, index) => (
              <span
                key={item.id}
                className={index <= stepIndex ? styles.progressActive : undefined}
              />
            ))}
          </div>

          <footer className={styles.actions}>
            <button className={styles.skipButton} onClick={() => closeTour(false)} type="button">
              Пропустить
            </button>
            <div>
              {stepIndex > 0 && (
                <button className={styles.backButton} onClick={previousStep} type="button">
                  <ArrowLeft size={15} aria-hidden="true" />
                  Назад
                </button>
              )}
              <button className={styles.nextButton} onClick={nextStep} type="button">
                {stepIndex === 0 ? "Начать" : stepIndex === steps.length - 1 ? "Готово" : "Далее"}
                {stepIndex === steps.length - 1
                  ? <Check size={15} aria-hidden="true" />
                  : <ArrowRight size={15} aria-hidden="true" />}
              </button>
            </div>
          </footer>
          <span className={styles.keyboardHint}>Для навигации также можно использовать клавиши ← →</span>
        </section>
      </dialog>
    </>
  );
}
