import type { ReactNode } from "react";
import { headers } from "next/headers";
import AdminNav from "@/components/AdminNav";
import { ActiveStoreProvider } from "@/contexts/ActiveStoreContext";
import { tryGetActiveStoreIdFromServerCookies } from "@/lib/current-store-server";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isSuperAdminUser } from "@/lib/super-admin";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const h = await headers();
  const pathname = h.get("x-pathname") ?? "";
  /** パスワードなしのシフト提出（middleware でも公開）。ナビ・店舗 Cookie に依存しない */
  if (pathname.startsWith("/admin/view/submit")) {
    return (
      <div className="min-h-dvh min-h-[100dvh] bg-slate-50 text-slate-900">
        {children}
      </div>
    );
  }

  const activeStoreId = await tryGetActiveStoreIdFromServerCookies();

  let stores: { id: string; name: string }[] = [];
  try {
    const admin = createServiceRoleClient();
    const { data } = await admin.from("stores").select("id, name").order("name");
    stores = data ?? [];
  } catch {
    // SUPABASE_SERVICE_ROLE_KEY 未設定時はセレクター用一覧を空に
  }

  let isSuperAdmin = false;
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    isSuperAdmin = isSuperAdminUser(user);
  } catch {
    // ignore
  }

  if (!activeStoreId) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <p className="max-w-md text-center text-sm text-red-600">
          アクティブ店舗を特定できません。環境変数 NEXT_PUBLIC_DEFAULT_STORE_ID
          を設定するか、管理者に連絡してください。
        </p>
      </div>
    );
  }

  return (
    <ActiveStoreProvider activeStoreId={activeStoreId}>
      <div className="flex min-h-dvh min-h-[100dvh] flex-col bg-slate-50 text-slate-900">
        <AdminNav
          stores={stores}
          activeStoreId={activeStoreId}
          isSuperAdmin={isSuperAdmin}
        />
        <main className="flex-1 w-full px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-5 sm:pt-6 lg:px-8 lg:pt-8">
          <div className="mx-auto w-full max-w-6xl overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm sm:rounded-2xl min-h-[min(50vh,calc(100dvh-10rem))]">
            {children}
          </div>
        </main>
      </div>
    </ActiveStoreProvider>
  );
}
