"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase-client";

const NAV_ITEMS = [
  { href: "/admin/weekly", label: "TOP" },
  { href: "/admin/view", label: "シフト一覧" },
  { href: "/admin/schedule", label: "単日登録" },
  { href: "/admin/casts", label: "キャスト管理" },
  { href: "/admin/settings", label: "システム設定" },
] as const;

export default function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();

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
          <div className="flex flex-wrap items-center gap-1 sm:gap-2">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href + item.label}
                  href={item.href}
                  className={`px-2 py-1.5 rounded text-sm font-medium transition-colors ${
                    isActive
                      ? "text-blue-700 bg-blue-50"
                      : "text-blue-600 hover:text-blue-700 hover:bg-gray-50"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="px-2 py-1.5 rounded text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 font-medium transition-colors"
          >
            ログアウト
          </button>
        </div>
      </div>
    </nav>
  );
}
