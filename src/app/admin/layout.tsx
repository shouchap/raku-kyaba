import type { ReactNode } from "react";
import AdminNav from "@/components/AdminNav";
import { ActiveStoreProvider } from "@/contexts/ActiveStoreContext";
import { tryGetActiveStoreIdFromServerCookies } from "@/lib/current-store-server";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isSuperAdminEmail } from "@/lib/super-admin";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
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
    isSuperAdmin = isSuperAdminEmail(user?.email);
  } catch {
    // ignore
  }

  if (!activeStoreId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <p className="text-red-600 text-sm text-center max-w-md">
          アクティブ店舗を特定できません。環境変数 NEXT_PUBLIC_DEFAULT_STORE_ID
          を設定するか、管理者に連絡してください。
        </p>
      </div>
    );
  }

  return (
    <ActiveStoreProvider activeStoreId={activeStoreId}>
      <div className="min-h-screen bg-gray-50">
        <AdminNav
          stores={stores}
          activeStoreId={activeStoreId}
          isSuperAdmin={isSuperAdmin}
        />
        <main className="py-4 sm:py-6 px-3 sm:px-4">
          <div className="mx-auto max-w-4xl rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden min-h-[50vh]">
            {children}
          </div>
        </main>
      </div>
    </ActiveStoreProvider>
  );
}
