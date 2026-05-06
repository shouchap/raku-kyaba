import type { ReactNode } from "react";
import Link from "next/link";

const ITEMS = [
  { href: "/admin/settings/store", label: "店舗基本設定" },
  { href: "/admin/settings/line", label: "LINE連携・通知" },
  { href: "/admin/settings/features", label: "業態別機能" },
  { href: "/admin/settings/admins", label: "権限・管理者" },
];

export default function AdminSettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="app-card h-fit p-3">
          <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            システム設定
          </p>
          <nav className="space-y-1">
            {ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block rounded-lg border border-transparent px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-200 hover:bg-slate-50"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>
        <section className="min-w-0">{children}</section>
      </div>
    </div>
  );
}
