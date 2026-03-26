"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase-client";

const NAV_ITEMS = [
  { href: "/admin/weekly", label: "シフト入力" },
  { href: "/admin/view", label: "シフト一覧" },
  { href: "/admin/schedule", label: "単日登録" },
  { href: "/admin/casts", label: "キャスト管理" },
  { href: "/admin/report", label: "月間レポート" },
  { href: "/admin/settings", label: "システム設定" },
] as const;

type StoreOption = { id: string; name: string };

type Props = {
  stores: StoreOption[];
  activeStoreId: string;
  isSuperAdmin: boolean;
};

export default function AdminNav({ stores, activeStoreId, isSuperAdmin }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  const currentLabel =
    stores.find((s) => s.id === activeStoreId)?.name ?? "店舗を選択";

  const handleStoreChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const storeId = e.target.value;
    if (!storeId || storeId === activeStoreId) return;

    try {
      const res = await fetch("/api/admin/set-active-store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error ?? "店舗の切り替えに失敗しました");
        e.target.value = activeStoreId;
        return;
      }
      router.refresh();
    } catch (err) {
      console.error(err);
      alert("店舗の切り替えに失敗しました");
      e.target.value = activeStoreId;
    }
  };

  const handleLogout = async () => {
    const supabase = createBrowserSupabaseClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  return (
    <nav className="bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-4xl mx-auto px-3 sm:px-6 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0 shrink">
              <label htmlFor="admin-store-select" className="sr-only">
                表示する店舗
              </label>
              <select
                id="admin-store-select"
                value={activeStoreId}
                onChange={handleStoreChange}
                className="min-w-0 max-w-[min(100%,220px)] sm:max-w-xs min-h-[40px] px-3 py-2 text-sm border border-gray-300 rounded-md bg-white text-gray-900 font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                title={currentLabel}
              >
                {stores.length === 0 ? (
                  <option value={activeStoreId}>{currentLabel}</option>
                ) : (
                  stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-1 sm:gap-2">
              {NAV_ITEMS.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href + item.label}
                    href={item.href}
                    className={`px-3 py-2 rounded-md text-sm font-medium transition-colors border border-gray-200/80 ${
                      isActive
                        ? "text-blue-700 bg-blue-50/80 border-blue-200"
                        : "text-blue-600 hover:text-blue-700 hover:bg-gray-50 border-gray-200/80 hover:border-gray-300"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
              {isSuperAdmin && (
                <Link
                  href="/admin/stores"
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors border border-gray-200/80 ${
                    pathname === "/admin/stores"
                      ? "text-amber-800 bg-amber-50 border-amber-200"
                      : "text-amber-700 hover:bg-amber-50/80 border-amber-200/80"
                  }`}
                >
                  店舗管理
                </Link>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="px-3 py-2 rounded-md text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 font-medium transition-colors border border-gray-200/80 hover:border-gray-300 shrink-0"
          >
            ログアウト
          </button>
        </div>
      </div>
    </nav>
  );
}
