"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Menu, X } from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase-client";

const NAV_ITEMS = [
  { href: "/admin/weekly", label: "シフト入力", hideForWelfare: true },
  { href: "/admin/view", label: "シフト一覧", hideForWelfare: true },
  { href: "/admin/schedule", label: "単日登録", hideForWelfare: true },
  {
    href: "/admin/shifts/special",
    label: "特別シフト募集",
    hideForWelfare: true,
    hideForBar: true,
  },
  { href: "/admin/casts", label: "キャスト管理" },
  { href: "/admin/report", label: "月間レポート" },
  { href: "/admin/settings", label: "システム設定" },
] as const;

const WELFARE_CASTS_LABEL = "利用者管理";

type StoreOption = { id: string; name: string };

type Props = {
  stores: StoreOption[];
  activeStoreId: string;
  isSuperAdmin: boolean;
  /** アクティブ店舗の業態（就労B型ではシフト系メニューを隠す） */
  businessType: "cabaret" | "welfare_b" | "bar";
};

function navLinkClass(isActive: boolean, vertical: boolean): string {
  const align = vertical
    ? "justify-start text-left w-full"
    : "justify-center";
  return [
    "flex items-center min-h-[44px] px-4 rounded-lg text-sm font-medium transition-colors touch-manipulation",
    align,
    "border",
    isActive
      ? "text-blue-800 bg-blue-50 border-blue-200 shadow-sm"
      : "text-slate-700 bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300 active:bg-slate-100",
  ].join(" ");
}

export default function AdminNav({
  stores,
  activeStoreId,
  isSuperAdmin,
  businessType,
}: Props) {
  const isWelfare = businessType === "welfare_b";
  const isBar = businessType === "bar";
  const navEntries = NAV_ITEMS.filter((item) => {
    if (isWelfare && "hideForWelfare" in item && item.hideForWelfare) return false;
    if (isBar && "hideForBar" in item && item.hideForBar) return false;
    return true;
  }).map((item) =>
    item.href === "/admin/casts" && isWelfare
      ? { href: item.href, label: WELFARE_CASTS_LABEL }
      : { href: item.href, label: item.label }
  );
  const homeHref = isWelfare ? "/admin/casts" : "/admin/weekly";
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const currentLabel =
    stores.find((s) => s.id === activeStoreId)?.name ??
    (isSuperAdmin ? "店舗を選択" : "店舗を取得できません");

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileMenuOpen]);

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
    setMobileMenuOpen(false);
    const supabase = createBrowserSupabaseClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  const NavLinks = ({ vertical }: { vertical: boolean }) => (
    <>
      {navEntries.map((item) => {
        const isActive =
          item.href === "/admin/shifts/special"
            ? pathname.startsWith("/admin/shifts/special")
            : pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={navLinkClass(isActive, vertical)}
            onClick={() => setMobileMenuOpen(false)}
          >
            {item.label}
          </Link>
        );
      })}
      {isSuperAdmin && (
        <Link
          href="/admin/stores"
          className={
            vertical
              ? `flex items-center min-h-[44px] px-4 rounded-lg text-sm font-medium w-full text-left justify-start touch-manipulation border ${
                  pathname === "/admin/stores"
                    ? "text-amber-900 bg-amber-50 border-amber-200"
                    : "text-amber-800 bg-amber-50/50 border-amber-200/80 hover:bg-amber-50"
                }`
              : `px-3 py-2 rounded-lg text-sm font-medium transition-colors border min-h-[40px] inline-flex items-center touch-manipulation ${
                  pathname === "/admin/stores"
                    ? "text-amber-900 bg-amber-50 border-amber-200"
                    : "text-amber-800 border-amber-200/80 hover:bg-amber-50/80"
                }`
          }
          onClick={() => setMobileMenuOpen(false)}
        >
          店舗管理
        </Link>
      )}
    </>
  );

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/90 bg-white/95 shadow-sm backdrop-blur-md supports-[backdrop-filter]:bg-white/90 [padding-top:max(0.5rem,env(safe-area-inset-top))] print:hidden">
      <div className="mx-auto max-w-6xl px-3 sm:px-5">
        <div className="flex items-center gap-2 sm:gap-3 py-2.5 sm:py-3">
          <button
            type="button"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 md:hidden touch-manipulation"
            aria-expanded={mobileMenuOpen}
            aria-controls="admin-mobile-menu"
            aria-label={mobileMenuOpen ? "メニューを閉じる" : "メニューを開く"}
            onClick={() => setMobileMenuOpen((o) => !o)}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" strokeWidth={2} /> : <Menu className="h-5 w-5" strokeWidth={2} />}
          </button>

          <Link
            href={homeHref}
            className="hidden shrink-0 sm:flex flex-col leading-tight"
          >
            <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
              Portal
            </span>
            <span className="text-base font-bold tracking-tight text-slate-900">
              Raku STAFF
            </span>
          </Link>

          <div className="min-w-0 flex-1">
            {isSuperAdmin ? (
              <>
                <label htmlFor="admin-store-select" className="sr-only">
                  表示する店舗
                </label>
                <select
                  id="admin-store-select"
                  value={activeStoreId}
                  onChange={handleStoreChange}
                  className="h-11 w-full min-w-0 max-w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 sm:max-w-md"
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
              </>
            ) : (
              <div
                className="flex h-11 min-w-0 max-w-full items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-800 sm:max-w-md"
                title={currentLabel}
              >
                <span className="truncate">{currentLabel}</span>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 touch-manipulation"
          >
            <LogOut className="h-4 w-4 sm:hidden" strokeWidth={2} />
            <span className="hidden sm:inline">ログアウト</span>
          </button>
        </div>

        {/* スマホ: 展開メニュー */}
        <div
          id="admin-mobile-menu"
          className={`border-t border-slate-100 bg-slate-50/80 md:hidden ${
            mobileMenuOpen ? "block" : "hidden"
          }`}
        >
          <nav
            className="flex max-h-[min(70vh,calc(100dvh-8rem))] flex-col gap-1.5 overflow-y-auto px-2 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
            aria-label="管理メニュー"
          >
            <NavLinks vertical />
          </nav>
        </div>

        {/* デスクトップ: 横並びメニュー */}
        <nav
          className="hidden flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/50 px-1 py-2.5 md:flex"
          aria-label="管理メニュー"
        >
          <NavLinks vertical={false} />
        </nav>
      </div>

    </header>
  );
}
