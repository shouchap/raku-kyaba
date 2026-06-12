"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  CalendarPlus2,
  Check,
  ChevronDown,
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

type MenuSettingsMap = Record<string, { label: string; isHidden: boolean; order?: number }>;

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
    { id: "report", href: "/admin/report", label: "レポート", icon: BarChart3 },
    { id: "settings", href: "/admin/settings", label: "システム設定", icon: Settings },
  ],
  bar: [
    { id: "shift-input", href: "/admin/weekly", label: "出勤入力", icon: CalendarDays },
    { id: "shift-list", href: "/admin/view", label: "出勤一覧", icon: ClipboardList },
    { id: "shift-single", href: "/admin/schedule", label: "単日登録", icon: CalendarPlus2 },
    { id: "cast-manage", href: "/admin/casts", label: "キャスト管理", icon: Users },
    { id: "report", href: "/admin/report", label: "レポート", icon: BarChart3 },
    { id: "settings", href: "/admin/settings", label: "BAR設定", icon: Settings },
  ],
  welfare_b: [
    { id: "cast-manage", href: "/admin/casts", label: "利用者管理", icon: UserRound },
    { id: "report", href: "/admin/report", label: "日報・実績", icon: BarChart3 },
    { id: "settings", href: "/admin/settings", label: "事業所設定", icon: Settings },
  ],
  fuzoku: [
    { id: "shift-input", href: "/admin/weekly", label: "シフト入力", icon: CalendarDays },
    { id: "shift-list", href: "/admin/view", label: "シフト一覧", icon: ClipboardList },
    { id: "shift-single", href: "/admin/schedule", label: "単日登録", icon: CalendarPlus2 },
    { id: "special-shift", href: "/admin/shifts/special", label: "特別シフト募集", icon: Megaphone },
    { id: "cast-manage", href: "/admin/casts", label: "キャスト管理", icon: Users },
    { id: "report", href: "/admin/report", label: "レポート", icon: BarChart3 },
    { id: "settings", href: "/admin/settings", label: "システム設定", icon: Settings },
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
    .map((item, idx) => {
      let label = item.label;
      if (item.href === "/admin/casts") label = `${customTerms.term_cast}管理`;
      if (item.href === "/admin/report") label = "レポート";

      const setting = menuSettings?.[item.id];
      if (setting?.isHidden === true) return null;
      const overrideLabel = setting?.label?.trim();
      const order = typeof setting?.order === "number" && Number.isFinite(setting.order) ? setting.order : idx;
      return { ...item, label: overrideLabel || label, _order: order, _idx: idx };
    })
    .filter((item): item is NavItem & { _order: number; _idx: number } => item !== null)
    .sort((a, b) => (a._order === b._order ? a._idx - b._idx : a._order - b._order))
    .map(({ _order: _dropOrder, _idx: _dropIdx, ...item }) => item);
  const homeHref = businessType === "welfare_b" ? "/admin/casts" : "/admin/weekly";
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [storeMenuOpen, setStoreMenuOpen] = useState(false);
  const storeMenuRef = useRef<HTMLDivElement | null>(null);

  const currentLabel =
    stores.find((s) => s.id === activeStoreId)?.name ??
    (isSuperAdmin ? "店舗を選択" : "店舗を取得できません");

  useEffect(() => {
    setMobileMenuOpen(false);
    setStoreMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!storeMenuOpen) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (storeMenuRef.current && !storeMenuRef.current.contains(e.target as Node)) {
        setStoreMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setStoreMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [storeMenuOpen]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileMenuOpen]);

  const handleStoreSelect = async (storeId: string) => {
    setStoreMenuOpen(false);
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
        return;
      }
      router.refresh();
    } catch (err) {
      console.error(err);
      alert("店舗の切り替えに失敗しました");
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
              <div className="relative min-w-0 sm:max-w-md" ref={storeMenuRef}>
                <button
                  type="button"
                  onClick={() => setStoreMenuOpen((o) => !o)}
                  aria-haspopup="listbox"
                  aria-expanded={storeMenuOpen}
                  className="flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-current/20 bg-white/80 px-3 text-sm font-medium text-slate-900 shadow-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                  title={currentLabel}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Store className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                    <span className="truncate">{currentLabel}</span>
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${
                      storeMenuOpen ? "rotate-180" : ""
                    }`}
                    aria-hidden
                  />
                </button>

                {storeMenuOpen && (
                  <ul
                    role="listbox"
                    aria-label="表示する店舗"
                    className="absolute left-0 top-[calc(100%+0.375rem)] z-[70] max-h-[min(60vh,22rem)] w-full min-w-[14rem] overflow-auto rounded-xl border border-slate-200 bg-white py-1 text-slate-900 shadow-xl ring-1 ring-black/5"
                  >
                    {stores.length === 0 ? (
                      <li className="px-3 py-2.5 text-sm text-slate-500">
                        切り替え可能な店舗がありません
                      </li>
                    ) : (
                      stores.map((s) => {
                        const isActive = s.id === activeStoreId;
                        return (
                          <li key={s.id} role="option" aria-selected={isActive}>
                            <button
                              type="button"
                              onClick={() => handleStoreSelect(s.id)}
                              className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors ${
                                isActive
                                  ? "bg-blue-50 font-semibold text-blue-900"
                                  : "text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              <Store
                                className={`h-4 w-4 shrink-0 ${
                                  isActive ? "text-blue-500" : "text-slate-400"
                                }`}
                                aria-hidden
                              />
                              <span className="truncate">{s.name}</span>
                              {isActive && (
                                <Check className="ml-auto h-4 w-4 shrink-0 text-blue-600" aria-hidden />
                              )}
                            </button>
                          </li>
                        );
                      })
                    )}
                  </ul>
                )}
              </div>
            ) : (
              <div
                className="flex h-11 min-w-0 max-w-full items-center gap-2 rounded-lg border border-current/20 bg-white/40 px-3 text-sm font-medium sm:max-w-md"
                title={currentLabel}
              >
                <Store className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
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
