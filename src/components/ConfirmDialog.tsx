"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 削除など取り消せない操作は赤系にする */
  tone?: "default" | "danger";
};

type PendingConfirm = ConfirmOptions & {
  resolve: (ok: boolean) => void;
};

type Listener = (pending: PendingConfirm | null) => void;

let pending: PendingConfirm | null = null;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener(pending);
}

/**
 * `window.confirm` の置き換え。ネイティブダイアログはブラウザを固め、
 * スマホでの見た目も悪いため、アプリ内モーダルで同じ使い勝手を提供する。
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  // 前の確認が残っている場合はキャンセル扱いにして閉じる
  pending?.resolve(false);

  return new Promise<boolean>((resolve) => {
    pending = { ...options, resolve };
    emit();
  });
}

function settle(ok: boolean) {
  pending?.resolve(ok);
  pending = null;
  emit();
}

export function ConfirmDialogHost() {
  const [current, setCurrent] = useState<PendingConfirm | null>(null);

  useEffect(() => {
    const listener: Listener = (next) => setCurrent(next);
    listeners.add(listener);
    setCurrent(pending);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!current) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") settle(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current]);

  if (!current) return null;

  const isDanger = current.tone === "danger";

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 p-4 print:hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) settle(false);
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl sm:p-6">
        <div className="flex items-start gap-3">
          {isDanger && (
            <AlertTriangle
              className="mt-0.5 h-6 w-6 shrink-0 text-red-600"
              aria-hidden
            />
          )}
          <div className="min-w-0 flex-1">
            <h2
              id="confirm-dialog-title"
              className="text-base font-bold text-slate-900"
            >
              {current.title}
            </h2>
            {current.message && (
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {current.message}
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => settle(false)}
            className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            {current.cancelLabel ?? "キャンセル"}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => settle(true)}
            className={`min-h-[44px] rounded-lg px-4 text-sm font-semibold text-white shadow-sm transition-colors ${
              isDanger
                ? "bg-red-600 hover:bg-red-700"
                : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {current.confirmLabel ?? "実行する"}
          </button>
        </div>
      </div>
    </div>
  );
}
