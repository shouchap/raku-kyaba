"use client";

import { useEffect } from "react";

/**
 * 未保存の入力があるときに、タブを閉じる・リロードする操作を止める。
 * シフト入力や設定は入力量が多く、誤操作でやり直しになる被害が大きい。
 */
export function useUnsavedChangesWarning(hasUnsavedChanges: boolean): void {
  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // 一部ブラウザは returnValue の設定を要求する
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedChanges]);
}
