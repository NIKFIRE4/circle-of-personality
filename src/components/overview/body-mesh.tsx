"use client";

import Image from "next/image";
import { useCallback, useSyncExternalStore } from "react";

import {
  isHumanoidSelection,
  resolveHumanoidVariant,
  type HumanoidSelection,
  type HumanoidVariant,
} from "@/lib/humanoid-variant";

import styles from "@/app/(dashboard)/overview/overview.module.css";

// WebP at 768x1152: <Image> is unoptimized in production (see next.config.ts),
// so these ship to the browser as-is and the source PNGs were ~3x heavier.
const HUMANOID_ASSETS: Record<HumanoidVariant, string> = {
  meditating: "/humanoids/humanoid-meditating.webp",
  standing: "/humanoids/humanoid-standing.webp",
  athlete: "/humanoids/humanoid-athlete.webp",
  coins: "/humanoids/humanoid-coins.webp",
  resting: "/humanoids/humanoid-resting.webp",
  creative: "/humanoids/humanoid-creative.webp",
};

/**
 * Archetypes, not life areas. These deliberately do not mirror the category
 * names in default-categories.ts: the figure is who the person is being this
 * week, while a category is where the hours went.
 */
const HUMANOID_OPTIONS: Array<{
  label: string;
  value: HumanoidSelection;
}> = [
  { label: "Авто", value: "auto" },
  { label: "Мастер дзена", value: "meditating" },
  { label: "Искатель баланса", value: "standing" },
  { label: "Неутомимый атлет", value: "athlete" },
  { label: "Гений финансов", value: "coins" },
  { label: "Хранитель покоя", value: "resting" },
  { label: "Творческий гений", value: "creative" },
];

export function BodyMesh({
  categorySlug,
  preferenceKey,
}: {
  categorySlug?: string | null;
  preferenceKey: string;
}) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const handleStorage = (event: StorageEvent) => {
        if (event.key === preferenceKey) onStoreChange();
      };
      const eventName = selectionEventName(preferenceKey);

      window.addEventListener("storage", handleStorage);
      window.addEventListener(eventName, onStoreChange);

      return () => {
        window.removeEventListener("storage", handleStorage);
        window.removeEventListener(eventName, onStoreChange);
      };
    },
    [preferenceKey],
  );
  const getSnapshot = useCallback(
    () => readSelection(preferenceKey),
    [preferenceKey],
  );
  const selection = useSyncExternalStore(subscribe, getSnapshot, getAutoSelection);
  const automaticVariant = resolveHumanoidVariant(categorySlug);
  const variant = selection === "auto" ? automaticVariant : selection;
  const src = HUMANOID_ASSETS[variant];

  function handleSelection(nextSelection: HumanoidSelection) {
    window.localStorage.setItem(preferenceKey, nextSelection);
    window.dispatchEvent(new Event(selectionEventName(preferenceKey)));
  }

  return (
    <div className={styles.visual}>
      <label className={styles.selector}>
        <span>Персонаж</span>
        <span className={styles.selectorControl}>
          <select
            aria-label="Выбрать персонажа"
            onChange={(event) =>
              handleSelection(event.target.value as HumanoidSelection)
            }
            value={selection}
          >
            {HUMANOID_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </span>
      </label>
      <div aria-hidden="true" className={styles.ring} />
      <div
        aria-hidden="true"
        className={`${styles.figure} ${styles[variant]}`}
        data-variant={variant}
      >
        <Image
          alt=""
          className={styles.figureEcho}
          height={1152}
          sizes="(max-width: 980px) 72vw, 34vw"
          src={src}
          width={768}
        />
        <div className={styles.figureTurn} key={variant}>
          <Image
            alt=""
            className={styles.figureImage}
            height={1152}
            preload
            sizes="(max-width: 980px) 72vw, 34vw"
            src={src}
            width={768}
          />
        </div>
      </div>
      <span className={styles.figureCaption}>
        <i aria-hidden="true" />
        Данные обновлены сегодня
      </span>
    </div>
  );
}

function getAutoSelection(): HumanoidSelection {
  return "auto";
}

function readSelection(preferenceKey: string): HumanoidSelection {
  const savedSelection = window.localStorage.getItem(preferenceKey);
  return savedSelection && isHumanoidSelection(savedSelection)
    ? savedSelection
    : "auto";
}

function selectionEventName(preferenceKey: string): string {
  return `humanoid-selection:${preferenceKey}`;
}
