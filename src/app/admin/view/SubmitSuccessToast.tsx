"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * ログイン済みでシフト提出後に /admin/view?shiftSubmitted=1 へ来たときのトースト
 */
export function SubmitSuccessToast() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (searchParams.get("shiftSubmitted") !== "1") return;
    setVisible(true);
    router.replace("/admin/view", { scroll: false });
    const t = window.setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(t);
  }, [searchParams, router]);

  if (!visible) return null;

  return (
    <div
      role="status"
      className="fixed left-1/2 top-4 z-[100] w-[min(92vw,24rem)] -translate-x-1/2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-sm font-medium text-emerald-900 shadow-lg"
    >
      シフトを提出しました
    </div>
  );
}
