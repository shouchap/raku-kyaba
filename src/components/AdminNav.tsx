"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  CalendarPlus2,
  ClipboardList,
  LogOut,
  Menu,
  Megaphone,
  Settings,
  Store,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase-client";
import { BUSINESS_THEME, type BusinessType } from "@/lib/business-ui";
import type { CustomTerms } from "@/lib/custom-terms";

type NavItem = {
  id: string;
  href: string;
  label: string;
  icon: typeof ClipboardList;
};

type MenuSettingsMap = Record<string, { label: string; isHidden: boolean }>;

// NOTE: 微調整や差し戻しが必要な場合は、この定数だけ変更すればOK。
const NAV_ICON_CLASS = "h-4 w-4 shrink-0 transition-opacity";
const NAV_ICON_ACTIVE_CLASS = "opacity-95";
const NAV_ICON_IDLE_CLASS = "opacity-65";

const NAV_ITEMS_BY_BUSINESS: Record<BusinessType, NavItem[]> = {
  cabaret: [
    { id: "shift-input", href: "/admin/weekly", label: "シフト入力", icon: CalendarDays },
    { id: "shift-list", href: "/admin/view", label: "シフト一覧", icon: ClipboardList },
    { id: "shift-single", href: "/admin/schedule", label: "単日登録", icon: CalendarPlus2 },
    { id: "special-shift", href: "/admin/shifts/special", label: "特別シフト募集", icon: Megaphone },
    { id: "cast-manage", href: "/admin/casts", label: "キャスト管理", icon: Users },
    { id: "report", href: "/admin/report", label: "月間レポート", icon: BarChart3 },
    { id: "settings", href: "/admin/settings", label: "システム設定", icon: Settings },
  ],
  bar: [
    { id: "shift-input", href: "/admin/weekly", label: "出勤入力", icon: CalendarDays },
    { id: "shift-list", href: "/admin/view", label: "出勤一覧", icon: ClipboardList },
    { id: "shift-single", href: "/admin/schedule", label: "単日登録", icon: CalendarPlus2 },
    { id: "cast-manage", href: "/admin/casts", label: "キャスト管理", icon: Users },
    { id: "report", href: "/admin/report", label: "BARレポート", icon: BarChart3 },
    { id: "settings", href: "/admin/settings", label: "BAR設定", icon: Settings },
  ],
  welfare_b: [
    { id: "cast-manage", href: "/admin/casts", label: "利用者管理", icon: UserRound },
    { id: "report", href: "/admin/report", label: "日報・実績", icon: BarChart3 },
    { id: "settings", href: "/admin/settings", label: "事業所設定", icon: Settings },
  ],
};

type StoreOption = { id: string; name: string };

type Props = {
  stores: StoreOption[];
  activeStoreId: string;
  isSuperAdmin: boolean;
  /** アクティブ店舗の業態（就労B型ではシフト系メニューを隠す） */
  businessType: BusinessType;
  customTerms: CustomTerms;
  menuSettings?: MenuSettingsMap;
};

function navLinkClass(isActive: boolean, vertical: boolean, businessType: BusinessType): string {
  const theme = BUSINESS_THEME[businessType];
  const align = vertical
    ? "justify-start text-left w-full"
    : "justify-center";
  return [
    "flex items-center min-h-[44px] px-4 rounded-lg text-sm font-medium transition-colors touch-manipulation",
    align,
    "gap-2",
    "border",
    isActive ? `${theme.navActiveClass} shadow-sm` : theme.navMutedClass,
  ].join(" ");
}

export default function AdminNav({
  stores,
  activeStoreId,
  isSuperAdmin,
  businessType,
  customTerms,
  menuSettings,
}: Props) {
  const theme = BUSINESS_THEME[businessType];
  const navEntries = NAV_ITEMS_BY_BUSINESS[businessType]
    .map((item) => {
      let label = item.label;
      if (item.href === "/admin/casts") label = `${customTerms.term_cast}管理`;
      if (item.href === "/admin/report") label = `${customTerms.term_cast}${customTerms.term_attendance}レポート`;

      const setting = menuSettings?.[item.id];
      if (setting?.isHidden === true) return null;
      const overrideLabel = setting?.label?.trim();
      return { ...item, label: overrideLabel || label };
    })
    .filter((item): item is NavItem => item !== null);
  const homeHref = businessType === "welfare_b" ? "/admin/casts" : "/admin/weekly";
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
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={navLinkClass(isActive, vertical, businessType)}
            onClick={() => setMobileMenuOpen(false)}
          >
            <Icon
              className={`${NAV_ICON_CLASS} ${isActive ? NAV_ICON_ACTIVE_CLASS : NAV_ICON_IDLE_CLASS}`}
            />
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
                    ? `${theme.navActiveClass}`
                    : `${theme.navMutedClass}`
                }`
              : `px-3 py-2 rounded-lg text-sm font-medium transition-colors border min-h-[40px] inline-flex items-center touch-manipulation ${
                  pathname === "/admin/stores"
                    ? `${theme.navActiveClass}`
                    : `${theme.navMutedClass}`
                }`
          }
          onClick={() => setMobileMenuOpen(false)}
        >
          <Store
            className={`mr-1.5 ${NAV_ICON_CLASS} ${
              pathname === "/admin/stores" ? NAV_ICON_ACTIVE_CLASS : NAV_ICON_IDLE_CLASS
            }`}
          />
          店舗管理
        </Link>
      )}
    </>
  );

  return (
    <header
      className={`sticky top-0 z-50 border-b shadow-sm backdrop-blur-md [padding-top:max(0.5rem,env(safe-area-inset-top))] print:hidden ${theme.headerClass}`}
    >
      <div className="mx-auto max-w-6xl px-3 sm:px-5">
        <div className="flex items-center gap-2 sm:gap-3 py-2.5 sm:py-3">
          <button
            type="button"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-current/20 bg-white/30 text-current shadow-sm hover:bg-white/40 md:hidden touch-manipulation"
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
            <span className="text-[10px] font-medium uppercase tracking-wider opacity-70">
              Portal
            </span>
            <span className="text-base font-bold tracking-tight">
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
                  className="h-11 w-full min-w-0 max-w-full rounded-lg border border-current/20 bg-white/80 px-3 text-sm font-medium text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 sm:max-w-md"
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
                className="flex h-11 min-w-0 max-w-full items-center rounded-lg border border-current/20 bg-white/40 px-3 text-sm font-medium sm:max-w-md"
                title={currentLabel}
              >
                <span className="truncate">{currentLabel}</span>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border border-current/20 bg-white/70 px-3 text-sm font-medium shadow-sm hover:bg-white touch-manipulation"
          >
            <LogOut className="h-4 w-4 sm:hidden" strokeWidth={2} />
            <span className="hidden sm:inline">ログアウト</span>
          </button>
        </div>

        {/* スマホ: 展開メニュー */}
        <div
          id="admin-mobile-menu"
          className={`border-t border-current/10 bg-white/50 md:hidden ${
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
          className="hidden flex-wrap items-center gap-2 border-t border-current/10 bg-white/40 px-1 py-2.5 md:flex"
          aria-label="管理メニュー"
        >
          <NavLinks vertical={false} />
        </nav>
      </div>

    </header>
  );
}
