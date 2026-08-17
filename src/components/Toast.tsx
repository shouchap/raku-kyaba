"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

export type ToastKind = "success" | "error" | "info";

export type ToastItem = {
  id: number;
  message: string;
  kind: ToastKind;
};

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener(items);
}

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

/**
 * どこからでも呼べる通知。`alert()` の置き換え用に、
 * フック不要のモジュール関数として公開する。
 */
export function showToast(message: string, kind: ToastKind = "info"): void {
  const text = message.trim();
  if (!text) return;

  const id = nextId++;
  items = [...items, { id, message: text, kind }].slice(-3);
  emit();

  const holdMs = kind === "error" ? 6000 : 3500;
  setTimeout(() => dismiss(id), holdMs);
}

export const toast = {
  success: (message: string) => showToast(message, "success"),
  error: (message: string) => showToast(message, "error"),
  info: (message: string) => showToast(message, "info"),
};

const STYLE: Record<ToastKind, { box: string; icon: typeof Info }> = {
  success: {
    box: "border-emerald-300 bg-emerald-50 text-emerald-900",
    icon: CheckCircle2,
  },
  error: {
    box: "border-red-300 bg-red-50 text-red-900",
    icon: AlertCircle,
  },
  info: {
    box: "border-slate-300 bg-white text-slate-900",
    icon: Info,
  },
};

export function ToastViewport() {
  const [visible, setVisible] = useState<ToastItem[]>([]);

  useEffect(() => {
    const listener: Listener = (next) => setVisible(next);
    listeners.add(listener);
    setVisible(items);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (visible.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] print:hidden sm:inset-x-auto sm:right-4 sm:items-end"
    >
      {visible.map((item) => {
        const style = STYLE[item.kind];
        const Icon = style.icon;
        return (
          <div
            key={item.id}
            role={item.kind === "error" ? "alert" : "status"}
            className={`animate-rise pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg ${style.box}`}
          >
            <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
              {item.message}
            </span>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              aria-label="閉じる"
              className="-mr-1 shrink-0 rounded-md p-1 opacity-60 transition-opacity hover:opacity-100"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
