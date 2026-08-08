/// <reference types="react/canary" />
import { ViewTransition } from "react";

/**
 * Unlike layout.tsx, a template remounts on every navigation within this
 * route group — exactly the boundary ViewTransition needs to fire an
 * enter/exit pair between tabs (Обзор/Календарь/Цели/…). Putting the
 * wrapper in the shared layout would silently do nothing, since layouts
 * persist across navigations and never remount.
 */
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="page-enter" exit="page-exit" default="none">
      {children}
    </ViewTransition>
  );
}
