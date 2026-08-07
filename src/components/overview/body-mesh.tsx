"use client";

import Image from "next/image";
import { useCallback, useSyncExternalStore } from "react";

import {
  isHumanoidSelection,
  resolveHumanoidVariant,
  type HumanoidSelection,
  type HumanoidVariant,
} from "@/lib/humanoid-variant";

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

const HUMANOID_OPTIONS: Array<{
  label: string;
  value: HumanoidSelection;
}> = [
  { label: "Авто", value: "auto" },
  { label: "Медитация", value: "meditating" },
  { label: "Нейтральный", value: "standing" },
  { label: "Спортсмен", value: "athlete" },
  { label: "Финансы", value: "coins" },
  { label: "Отдых", value: "resting" },
  { label: "Творчество", value: "creative" },
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
    <>
      <label className="human-selector">
        <span>Персонаж</span>
        <span className="human-selector-control">
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
      <div
        aria-hidden="true"
        className={`human-figure human-figure-${variant}`}
        data-variant={variant}
      >
        <Image
          alt=""
          className="human-figure-echo"
          height={1152}
          sizes="(max-width: 760px) 62vw, 360px"
          src={src}
          width={768}
        />
        <div className="human-figure-turn" key={variant}>
          <Image
            alt=""
            className="human-figure-image"
            height={1152}
            preload
            sizes="(max-width: 760px) 62vw, 360px"
            src={src}
            width={768}
          />
        </div>
      </div>
    </>
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
