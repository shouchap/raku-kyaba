import { createServiceRoleClient } from "@/lib/supabase-service";
import { isValidStoreId } from "@/lib/current-store";
import { addCalendarDaysJst, getTodayJst } from "@/lib/date-utils";
import { ShiftSubmitForm } from "./ShiftSubmitForm";

export const dynamic = "force-dynamic";

function computeWeekDatesFromTomorrow(): string[] {
  const today = getTodayJst();
  const tomorrow = addCalendarDaysJst(today, 1);
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    dates.push(addCalendarDaysJst(tomorrow, i));
  }
  return dates;
}

export default async function ShiftSubmitPage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string; success?: string }>;
}) {
  const sp = await searchParams;
  const storeId = sp.storeId?.trim() ?? "";
  const showSuccess = sp.success === "1";

  if (!isValidStoreId(storeId)) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8">
        <h1 className="text-xl font-bold text-slate-900">シフト提出</h1>
        <p className="mt-4 text-sm text-slate-600">
          URL に <code className="rounded bg-slate-100 px-1">storeId</code>{" "}
          を付けてアクセスしてください（例: <span className="break-all">?storeId=店舗のUUID</span>）。
        </p>
      </div>
    );
  }

  const dates = computeWeekDatesFromTomorrow();

  let storeName = "";
  let allowed = false;
  let casts: { id: string; name: string }[] = [];
  let loadError: string | null = null;

  try {
    const admin = createServiceRoleClient();
    const { data: store, error: sErr } = await admin
      .from("stores")
      .select("name, allow_shift_submission")
      .eq("id", storeId)
      .maybeSingle();

    if (sErr || !store) {
      loadError = "店舗を取得できませんでした。";
    } else {
      storeName = (store.name as string) ?? "";
      allowed = store.allow_shift_submission === true;
    }

    if (!loadError && allowed) {
      const { data: castsData, error: cErr } = await admin
        .from("casts")
        .select("id, name")
        .eq("store_id", storeId)
        .eq("is_active", true)
        .order("name");

      if (cErr) {
        loadError = "キャスト一覧の取得に失敗しました。";
      } else {
        casts = (castsData ?? []) as { id: string; name: string }[];
      }
    }
  } catch (e) {
    console.error("[ShiftSubmitPage]", e);
    loadError = "サーバー設定エラーです。";
  }

  return (
    <ShiftSubmitForm
      storeId={storeId}
      storeName={storeName}
      casts={casts}
      dates={dates}
      allowed={allowed}
      loadError={loadError}
      initialSuccess={showSuccess}
    />
  );
}
