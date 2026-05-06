import type { ReactNode } from "react";
import { headers } from "next/headers";
import AdminNav from "@/components/AdminNav";
import { ActiveStoreProvider } from "@/contexts/ActiveStoreContext";
import { tryGetActiveStoreIdFromServerCookies } from "@/lib/current-store-server";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getStoreAdminStoreIdFromUser } from "@/lib/roles";
import { isSuperAdminUser } from "@/lib/super-admin";
import { BUSINESS_THEME, normalizeBusinessType } from "@/lib/business-ui";
import { resolveCustomTerms } from "@/lib/custom-terms";
import { isUndefinedColumnError } from "@/lib/postgrest-error";

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
  let isSuperAdmin = false;
  let businessType: "cabaret" | "welfare_b" | "bar" = "cabaret";
  let customTerms = resolveCustomTerms(null);
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    isSuperAdmin = isSuperAdminUser(user);

    const admin = createServiceRoleClient();
    if (isSuperAdmin) {
      const { data } = await admin.from("stores").select("id, name").order("name");
      stores = data ?? [];
    } else {
      const sid = getStoreAdminStoreIdFromUser(user);
      if (sid) {
        const { data } = await admin.from("stores").select("id, name").eq("id", sid).maybeSingle();
        stores = data ? [data] : [];
      }
    }

    if (activeStoreId) {
      const btWithTerms = await admin
        .from("stores")
      .select("business_type, custom_terms")
        .eq("id", activeStoreId)
        .maybeSingle();
      let btRow = btWithTerms.data as { business_type?: string | null; custom_terms?: unknown } | null;
      if (btWithTerms.error && isUndefinedColumnError(btWithTerms.error, "custom_terms")) {
        const legacy = await admin
          .from("stores")
          .select("business_type")
          .eq("id", activeStoreId)
          .maybeSingle();
        btRow = legacy.data as { business_type?: string | null; custom_terms?: unknown } | null;
      }
      const bt = btRow?.business_type;
      businessType = normalizeBusinessType(bt);
      customTerms = resolveCustomTerms(btRow?.custom_terms);
    }
  } catch {
    // SUPABASE_SERVICE_ROLE_KEY 未設定時など
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

  const theme = BUSINESS_THEME[businessType];

  return (
    <ActiveStoreProvider activeStoreId={activeStoreId}>
      <div className={`flex min-h-dvh min-h-[100dvh] flex-col ${theme.pageBackgroundClass}`}>
        <AdminNav
          stores={stores}
          activeStoreId={activeStoreId}
          isSuperAdmin={isSuperAdmin}
          businessType={businessType}
          customTerms={customTerms}
        />
        <main className="flex-1 w-full px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-5 sm:pt-6 lg:px-8 lg:pt-8 print:p-0 print:pb-0">
          <div
            className={`mx-auto w-full max-w-6xl overflow-hidden rounded-xl border shadow-sm sm:rounded-2xl min-h-[min(50vh,calc(100dvh-10rem))] print:overflow-visible print:rounded-none print:border-0 print:shadow-none print:min-h-0 ${theme.cardAccentClass}`}
          >
            {children}
          </div>
        </main>
      </div>
    </ActiveStoreProvider>
  );
}
