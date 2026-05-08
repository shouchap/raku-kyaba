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

type MenuSettingsMap = Record<string, { label: string; isHidden: boolean; order?: number }>;

function normalizeMenuSettings(raw: unknown): MenuSettingsMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const rec = raw as Record<string, unknown>;
  const out: MenuSettingsMap = {};
  for (const [key, value] of Object.entries(rec)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    if (typeof entry.label !== "string" || typeof entry.isHidden !== "boolean") continue;
    const id = key.trim();
    const label = entry.label.trim();
    if (!id || !label) continue;
    const orderRaw = entry.order;
    const order =
      typeof orderRaw === "number" && Number.isFinite(orderRaw) ? Math.trunc(orderRaw) : undefined;
    out[id] = order === undefined ? { label, isHidden: entry.isHidden } : { label, isHidden: entry.isHidden, order };
  }
  return out;
}

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
  let businessType: "cabaret" | "welfare_b" | "bar" | "fuzoku" = "cabaret";
  let customTerms = resolveCustomTerms(null);
  let menuSettings: MenuSettingsMap = {};
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
        .select("business_type, custom_terms, menu_settings")
        .eq("id", activeStoreId)
        .maybeSingle();
      let btRow = btWithTerms.data as {
        business_type?: string | null;
        custom_terms?: unknown;
        menu_settings?: unknown;
      } | null;
      if (btWithTerms.error && isUndefinedColumnError(btWithTerms.error, "custom_terms")) {
        const legacy = await admin
          .from("stores")
          .select("business_type")
          .eq("id", activeStoreId)
          .maybeSingle();
        btRow = legacy.data as {
          business_type?: string | null;
          custom_terms?: unknown;
          menu_settings?: unknown;
        } | null;
      } else if (btWithTerms.error && isUndefinedColumnError(btWithTerms.error, "menu_settings")) {
        const noMenu = await admin
          .from("stores")
          .select("business_type, custom_terms")
          .eq("id", activeStoreId)
          .maybeSingle();
        btRow = noMenu.data as {
          business_type?: string | null;
          custom_terms?: unknown;
          menu_settings?: unknown;
        } | null;
      }
      const bt = btRow?.business_type;
      businessType = normalizeBusinessType(bt);
      customTerms = resolveCustomTerms(btRow?.custom_terms);
      menuSettings = normalizeMenuSettings(btRow?.menu_settings);
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
          menuSettings={menuSettings}
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
