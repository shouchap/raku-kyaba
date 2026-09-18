"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase-client";
import { useActiveStoreId } from "@/contexts/ActiveStoreContext";
import { addCalendarDaysJst, getTodayJst, getWeekdayJst } from "@/lib/date-utils";
import { sortCastsForShiftDisplay } from "@/lib/cast-display-sort";
import { normalizeDbTimeToShiftOption, getTimeOptions, parseShiftTimeStepMinutes } from "@/lib/time-options";
import { toast } from "@/components/Toast";
import { WeekRangePicker } from "@/components/WeekRangePicker";
import { PageLoading } from "@/components/PageLoading";
import { useUnsavedChangesWarning } from "@/hooks/useUnsavedChangesWarning";
import { confirmDialog } from "@/components/ConfirmDialog";
import {
  AlertCircle,
  AlertTriangle,
  CalendarCheck2,
  CheckCircle2,
  Save,
  Send,
  SlidersHorizontal,
  Users,
} from "lucide-react";

type Cast = {
  id: string;
  name: string;
  store_id: string;
  role?: string | null;
  employment_type?: "admin" | "regular" | "part_time" | "employee" | null;
};

type Store = {
  id: string;
  name: string;
  regular_holidays?: number[];
  regular_start_time?: string | null;
  is_dohan_sabaki_enabled?: boolean;
  shift_time_step_minutes?: number | null;
};

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

/** "2026-03-20" → "03/20(日)"（JST 暦日として解釈） */
function formatDateWithWeekday(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00+09:00");
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const w = WEEKDAY_JA[getWeekdayJst(dateStr)];
  return `${m}/${day}(${w})`;
}

/** モバイル用短縮 "20(日)" */
function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00+09:00");
  const day = d.getDate();
  const w = WEEKDAY_JA[getWeekdayJst(dateStr)];
  return `${day}(${w})`;
}

/** stores.regular_holidays（0=日〜6=土）と JST 暦日の曜日が一致するか */
function isRegularHolidayJst(regularHolidays: number[] | undefined, dateYmd: string): boolean {
  const closed = Array.isArray(regularHolidays) ? regularHolidays : [];
  if (closed.length === 0) return false;
  return closed.includes(getWeekdayJst(dateYmd));
}

export default function AdminWeeklyPage() {
  const activeStoreId = useActiveStoreId();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [casts, setCasts] = useState<Cast[]>([]);
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fixingMonth, setFixingMonth] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [notifyingOp, setNotifyingOp] = useState<{
    castId: string;
    isUpdate: boolean;
  } | null>(null);
  const [notifyStatus, setNotifyStatus] = useState<"idle" | "sending" | "done">("idle");
  const [message, setMessage] = useState<"success" | "error" | null>(null);
  /** 直近の一括保存で API / PostgREST が返したヒント（画面に短く表示） */
  const [saveErrorHint, setSaveErrorHint] = useState<string | null>(null);
  /** 未保存の入力があるか。離脱警告と保存ボタンの強調に使う */
  const [dirty, setDirty] = useState(false);
  useUnsavedChangesWarning(dirty);

  const today = useMemo(() => getTodayJst(), []);
  const [baseDate, setBaseDate] = useState(today);

  // マトリックスデータ: matrix[castId][dateStr] = "HH:mm" | ""
  const [matrix, setMatrix] = useState<Record<string, Record<string, string>>>({});
  // 退勤時刻: endMatrix[castId][dateStr] = "HH:mm" | ""
  const [endMatrix, setEndMatrix] = useState<Record<string, Record<string, string>>>({});
  // 同伴フラグ: dohan[castId][dateStr] = boolean（出勤時間がある場合のみ意味を持つ）
  const [dohan, setDohan] = useState<Record<string, Record<string, boolean>>>({});
  const [sabaki, setSabaki] = useState<Record<string, Record<string, boolean>>>({});

  // 基準日から7日間の日付配列（JST 暦日。UTC toISOString による日付ずれを防ぐ）
  const dates = useMemo(() => {
    const result: string[] = [];
    for (let i = 0; i < 7; i++) {
      result.push(addCalendarDaysJst(baseDate, i));
    }
    return result;
  }, [baseDate]);

  const shiftStep = useMemo(
    () => parseShiftTimeStepMinutes(store?.shift_time_step_minutes),
    [store?.shift_time_step_minutes]
  );
  const timeOptions = useMemo(() => getTimeOptions(shiftStep), [shiftStep]);

  // 既存シフトの取得を、キャスト一覧取得の完了を待たずに同時並行で開始するための
  // キャッシュ。key（店舗×表示週）が同じ間は同じ Promise を再利用し、二重リクエストを
  // 防ぐ（初回表示・週切り替え双方の待ち時間を短縮）。
  type RawScheduleRow = {
    cast_id: string;
    scheduled_date: string;
    scheduled_time?: string;
    scheduled_end_time?: string;
    is_dohan?: boolean;
    is_sabaki?: boolean;
  };
  const scheduleFetchRef = useRef<{ key: string; promise: Promise<RawScheduleRow[]> } | null>(null);
  const fetchSchedulesRaw = useCallback(
    (storeId: string, options?: { force?: boolean }) => {
      const key = `${storeId}|${dates.join(",")}`;
      const cached = scheduleFetchRef.current;
      if (!options?.force && cached && cached.key === key) {
        return cached.promise;
      }
      const promise = Promise.resolve(
        supabase
          .from("attendance_schedules")
          .select("cast_id, scheduled_date, scheduled_time, scheduled_end_time, is_dohan, is_sabaki")
          .eq("store_id", storeId)
          .in("scheduled_date", dates)
      ).then(({ data }) => (data ?? []) as RawScheduleRow[]);
      scheduleFetchRef.current = { key, promise };
      return promise;
    },
    [supabase, dates]
  );

  // データ取得（キャスト・店舗・既存シフトを同時開始し、表まで一度に反映）
  const fetchData = useCallback(async () => {
    setLoading(true);
    const storeId = activeStoreId;
    const schedulesPromise = fetchSchedulesRaw(storeId, { force: true });
    try {
      const [castsRes, storesResFirst] = await Promise.all([
        supabase
          .from("casts")
          .select("id, name, store_id, employment_type, role")
          .eq("store_id", storeId)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("stores")
          .select(
            "id, name, regular_holidays, regular_start_time, is_dohan_sabaki_enabled, shift_time_step_minutes"
          )
          .eq("id", storeId)
          .single(),
      ]);

      let storesRes = storesResFirst;
      if (
        storesRes.error &&
        String(storesRes.error.message ?? "").includes("shift_time_step_minutes")
      ) {
        storesRes = await supabase
          .from("stores")
          .select("id, name, regular_holidays, regular_start_time, is_dohan_sabaki_enabled")
          .eq("id", storeId)
          .single();
      }

      let nextCasts: Cast[] = [];
      if (
        castsRes.error &&
        (String(castsRes.error.message).includes("role") || castsRes.error.code === "42703")
      ) {
        const fallback = await supabase
          .from("casts")
          .select("id, name, store_id, employment_type")
          .eq("store_id", storeId)
          .eq("is_active", true)
          .order("name");
        if (fallback.data) {
          nextCasts = sortCastsForShiftDisplay(
            (fallback.data as Cast[]).map((c) => ({ ...c, role: "cast" as const }))
          );
        }
      } else if (castsRes.data) {
        nextCasts = sortCastsForShiftDisplay(castsRes.data as Cast[]);
      } else if (castsRes.error) {
        console.error(castsRes.error);
      }

      let storeRaw: Record<string, unknown> | null = null;
      if (storesRes.error?.code === "42703") {
        const legacyStoreRes = await supabase
          .from("stores")
          .select("id, name, regular_holidays, regular_start_time")
          .eq("id", storeId)
          .single();
        if (!legacyStoreRes.error && legacyStoreRes.data) {
          storeRaw = { ...(legacyStoreRes.data as Record<string, unknown>), is_dohan_sabaki_enabled: true };
        }
      } else if (storesRes.data) {
        storeRaw = storesRes.data as Record<string, unknown>;
      }

      let nextStore: Store | null = null;
      let nextStep = shiftStep;
      if (storeRaw) {
        const raw = storeRaw;
        const rh = raw.regular_holidays;
        nextStep = parseShiftTimeStepMinutes(raw.shift_time_step_minutes);
        nextStore = {
          id: String(raw.id ?? ""),
          name: String(raw.name ?? ""),
          regular_holidays: Array.isArray(rh)
            ? [...new Set(rh.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6) as number[])].sort(
                (a, b) => a - b
              )
            : [],
          regular_start_time:
            raw.regular_start_time === null || raw.regular_start_time === undefined
              ? null
              : String(raw.regular_start_time),
          is_dohan_sabaki_enabled: raw.is_dohan_sabaki_enabled !== false,
          shift_time_step_minutes: nextStep,
        };
        setStore(nextStore);
      }
      setCasts(nextCasts);

      const data = await schedulesPromise;
      const nextMatrix: Record<string, Record<string, string>> = {};
      const nextEndMatrix: Record<string, Record<string, string>> = {};
      const nextDohan: Record<string, Record<string, boolean>> = {};
      const nextSabaki: Record<string, Record<string, boolean>> = {};
      nextCasts.forEach((c) => {
        nextMatrix[c.id] = {};
        nextEndMatrix[c.id] = {};
        nextDohan[c.id] = {};
        nextSabaki[c.id] = {};
        dates.forEach((d) => {
          nextMatrix[c.id][d] = "";
          nextEndMatrix[c.id][d] = "";
          nextDohan[c.id][d] = false;
          nextSabaki[c.id][d] = false;
        });
      });
      data.forEach((row: RawScheduleRow) => {
        if (nextMatrix[row.cast_id]) {
          nextMatrix[row.cast_id][row.scheduled_date] = normalizeDbTimeToShiftOption(
            row.scheduled_time ?? null,
            nextStep
          );
          nextEndMatrix[row.cast_id][row.scheduled_date] = normalizeDbTimeToShiftOption(
            row.scheduled_end_time ?? null,
            nextStep
          );
          nextDohan[row.cast_id][row.scheduled_date] = Boolean(row.is_dohan);
          nextSabaki[row.cast_id][row.scheduled_date] = Boolean(row.is_sabaki);
        }
      });
      setMatrix(nextMatrix);
      setEndMatrix(nextEndMatrix);
      setDohan(nextDohan);
      setSabaki(nextSabaki);
      setDirty(false);
    } catch (err) {
      console.error(err);
      setMessage("error");
    } finally {
      setLoading(false);
    }
  }, [supabase, activeStoreId, fetchSchedulesRaw, dates]);

  // 既存シフトの読み込み（保存後の再表示など）
  const loadExistingSchedules = useCallback(
    async (storeId: string, castsForMatrix: Cast[] = casts, step = shiftStep) => {
      // 保存後などは必ず最新を取り直す（同一週のキャッシュを使わない）
      const data = await fetchSchedulesRaw(storeId, { force: true });

      const nextMatrix: Record<string, Record<string, string>> = {};
      const nextEndMatrix: Record<string, Record<string, string>> = {};
      const nextDohan: Record<string, Record<string, boolean>> = {};
      const nextSabaki: Record<string, Record<string, boolean>> = {};
      castsForMatrix.forEach((c) => {
        nextMatrix[c.id] = {};
        nextEndMatrix[c.id] = {};
        nextDohan[c.id] = {};
        nextSabaki[c.id] = {};
        dates.forEach((d) => {
          nextMatrix[c.id][d] = "";
          nextEndMatrix[c.id][d] = "";
          nextDohan[c.id][d] = false;
          nextSabaki[c.id][d] = false;
        });
      });
      data.forEach(
        (row: RawScheduleRow) => {
          if (nextMatrix[row.cast_id]) {
            nextMatrix[row.cast_id][row.scheduled_date] = normalizeDbTimeToShiftOption(
              row.scheduled_time ?? null,
              step
            );
            nextEndMatrix[row.cast_id][row.scheduled_date] = normalizeDbTimeToShiftOption(
              row.scheduled_end_time ?? null,
              step
            );
            nextDohan[row.cast_id][row.scheduled_date] = Boolean(row.is_dohan);
            nextSabaki[row.cast_id][row.scheduled_date] = Boolean(row.is_sabaki);
          }
        }
      );
      setMatrix(nextMatrix);
      setEndMatrix(nextEndMatrix);
      setDohan(nextDohan);
      setSabaki(nextSabaki);
      setDirty(false);
    },
    [casts, dates, shiftStep, fetchSchedulesRaw]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const updateCell = (castId: string, dateStr: string, value: string) => {
    setDirty(true);
    setMatrix((prev) => ({
      ...prev,
      [castId]: {
        ...(prev[castId] ?? {}),
        [dateStr]: value,
      },
    }));
    // 時間をクリアした場合は同伴もオフにする（整合性維持）
    if (!value.trim()) {
      setDohan((prev) => ({
        ...prev,
        [castId]: { ...(prev[castId] ?? {}), [dateStr]: false },
      }));
      setSabaki((prev) => ({
        ...prev,
        [castId]: { ...(prev[castId] ?? {}), [dateStr]: false },
      }));
    }
  };

  const updateEndCell = (castId: string, dateStr: string, value: string) => {
    setDirty(true);
    setEndMatrix((prev) => ({
      ...prev,
      [castId]: {
        ...(prev[castId] ?? {}),
        [dateStr]: value,
      },
    }));
  };

  /** 同伴トグル。出勤時間があるセルのみ有効 */
  const toggleDohan = (castId: string, dateStr: string) => {
    const time = matrix[castId]?.[dateStr]?.trim();
    if (!time) return;
    setDirty(true);
    setDohan((prev) => ({
      ...prev,
      [castId]: {
        ...(prev[castId] ?? {}),
        [dateStr]: !(prev[castId]?.[dateStr] ?? false),
      },
    }));
  };

  /** 捌きトグル。出勤時間があるセルのみ有効 */
  const toggleSabaki = (castId: string, dateStr: string) => {
    const time = matrix[castId]?.[dateStr]?.trim();
    if (!time) return;
    setDirty(true);
    setSabaki((prev) => ({
      ...prev,
      [castId]: {
        ...(prev[castId] ?? {}),
        [dateStr]: !(prev[castId]?.[dateStr] ?? false),
      },
    }));
  };

  /** レギュラーキャスト×定休日以外に、店舗設定のデフォルト出勤時刻を反映（保存は別） */
  const handleApplyRegularBulk = useCallback(() => {
    if (!store) return;
    const timeStr = normalizeDbTimeToShiftOption(store.regular_start_time, shiftStep);
    if (!timeStr) {
      toast.error(
        "システム設定で「レギュラー出勤時間」を保存してから実行してください。（— のままでは使えません）"
      );
      return;
    }
    const closed = store.regular_holidays ?? [];
    setDirty(true);
    toast.info("レギュラー出勤時間を入力しました。「一括保存する」を押すと確定します。");
    setMatrix((prev) => {
      const next: Record<string, Record<string, string>> = { ...prev };
      for (const cast of casts) {
        if (cast.employment_type !== "regular") continue;
        const row = { ...(next[cast.id] ?? {}) };
        for (const d of dates) {
          if (isRegularHolidayJst(closed, d)) {
            row[d] = "";
            continue;
          }
          row[d] = timeStr;
        }
        next[cast.id] = row;
      }
      return next;
    });
    setDohan((prev) => {
      const next: Record<string, Record<string, boolean>> = { ...prev };
      for (const cast of casts) {
        if (cast.employment_type !== "regular") continue;
        const row = { ...(next[cast.id] ?? {}) };
        for (const d of dates) {
          if (isRegularHolidayJst(closed, d)) row[d] = false;
        }
        next[cast.id] = row;
      }
      return next;
    });
    setSabaki((prev) => {
      const next: Record<string, Record<string, boolean>> = { ...prev };
      for (const cast of casts) {
        if (cast.employment_type !== "regular") continue;
        const row = { ...(next[cast.id] ?? {}) };
        for (const d of dates) {
          if (isRegularHolidayJst(closed, d)) row[d] = false;
        }
        next[cast.id] = row;
      }
      return next;
    });
  }, [store, casts, dates, shiftStep]);

  const handleFixCurrentMonth = useCallback(async () => {
    if (!store?.id) return;
    const [year, month] = baseDate.split("-").map(Number);
    if (!year || !month) return;
    const ok = await confirmDialog({
      title: `${month}月の固定シフトを一括保存しますか？`,
      message:
        "現在表示している月の1日から末日まで、レギュラーキャストの固定シフトを保存します。既存の入力は上書きされます。",
      confirmLabel: "一括保存する",
    });
    if (!ok) return;

    setFixingMonth(true);
    setMessage(null);
    setSaveErrorHint(null);
    try {
      const res = await fetch("/api/admin/weekly/fix-month", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: store.id,
          year,
          month,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || data.ok !== true) {
        throw new Error(data.error ?? "今月固定の一括保存に失敗しました");
      }
      await fetchData();
      setMessage("success");
      toast.success("今月固定シフトを反映しました。");
    } catch (e) {
      console.error(e);
      setMessage("error");
      toast.error(e instanceof Error ? e.message : "今月固定の一括保存に失敗しました");
    } finally {
      setFixingMonth(false);
    }
  }, [store, baseDate, fetchData]);

  const handleSave = async () => {
    if (!store) return;

    setSaving(true);
    setMessage(null);
    setSaveErrorHint(null);

    try {
      const res = await fetch("/api/admin/weekly/bulk-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          storeId: store.id,
          dates,
          castIds: casts.map((c) => c.id),
          matrix,
          endMatrix,
          dohan,
          sabaki,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        details?: string;
        hint?: string;
        code?: string;
        chunkOffset?: number;
        upserted?: number;
      };

      if (!res.ok || data.ok !== true) {
        console.error("[AdminWeekly] bulk-save failed", {
          httpStatus: res.status,
          error: data.error,
          message: data.message,
          code: data.code,
          details: data.details,
          hint: data.hint,
          chunkOffset: data.chunkOffset,
        });
        const hint = [data.code, data.message ?? data.error, data.details, data.hint]
          .filter((x) => x != null && String(x).trim() !== "")
          .join(" · ");
        setSaveErrorHint(hint.slice(0, 400));
        throw new Error(data.error ?? data.message ?? "保存に失敗しました");
      }

      setSaveErrorHint(null);
      setMessage("success");
      toast.success("シフトを保存しました。");
      await loadExistingSchedules(store.id);
    } catch (err) {
      console.error("[AdminWeekly] bulk-save exception", err);
      setMessage("error");
      toast.error(
        err instanceof Error ? err.message : "保存に失敗しました。通信状況を確認して再度お試しください。"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleNotify = async () => {
    setNotifying(true);
    setNotifyStatus("sending");
    try {
      const res = await fetch("/api/admin/notify-weekly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: baseDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "送信に失敗しました");
      setNotifyStatus("done");
      setTimeout(() => setNotifyStatus("idle"), 2500);
    } catch (err) {
      console.error(err);
      setNotifyStatus("idle");
      toast.error(err instanceof Error ? err.message : "送信に失敗しました");
    } finally {
      setNotifying(false);
    }
  };

  const handleNotifyIndividual = async (castId: string, isUpdate: boolean) => {
    setNotifyingOp({ castId, isUpdate });
    try {
      const res = await fetch("/api/admin/notify-individual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: baseDate,
          castId,
          is_update: isUpdate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "送信に失敗しました");
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "送信に失敗しました");
    } finally {
      setNotifyingOp(null);
    }
  };

  if (loading) {
    return <PageLoading rows={8} label="シフト入力を読み込み中" />;
  }

  return (
    <div className="w-full p-4 sm:p-6 lg:p-8">
      {/* ヘッダー */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3 sm:mb-6">
        <div>
          <h1 className="text-lg font-bold text-gray-900 sm:text-xl">週間シフト登録</h1>
          <p className="mt-1 text-sm text-gray-600">{store?.name ?? "店舗"}</p>
        </div>
        {dirty && !saving && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            未保存の変更があります
          </span>
        )}
      </div>

      {/* 基準日選択 */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:mb-5">
        <WeekRangePicker
          label="基準日（週の開始日）"
          inputId="base-date"
          baseDate={baseDate}
          onChange={setBaseDate}
        />
      </div>

      {/* 一括操作ツールバー */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:mb-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <button
              type="button"
              onClick={handleApplyRegularBulk}
              disabled={loading || !store || casts.length === 0}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 shadow-sm transition-colors hover:bg-gray-50 focus:ring-2 focus:ring-gray-400 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 touch-manipulation sm:w-auto"
            >
              <SlidersHorizontal className="h-4 w-4 text-gray-500" aria-hidden />
              レギュラー一括設定
            </button>
            <button
              type="button"
              onClick={handleFixCurrentMonth}
              disabled={loading || !store || casts.length === 0 || fixingMonth}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg border border-blue-300 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-800 shadow-sm transition-colors hover:bg-blue-100 focus:ring-2 focus:ring-blue-400 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 touch-manipulation sm:w-auto"
            >
              <CalendarCheck2 className="h-4 w-4" aria-hidden />
              {fixingMonth ? "処理中..." : "今月固定"}
            </button>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-gray-500">
          システム設定の「レギュラー出勤時間」を、勤務形態がレギュラーのキャストの定休日以外のマスに一括入力します（画面のみ。保存は「一括保存する」）。LINE
          で付いた公休・欠勤などの回答は、保存時に既存どおりマージされます。
        </p>
      </div>

      {/* 凡例 */}
      {store?.is_dohan_sabaki_enabled !== false && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-pink-500" aria-hidden />
            同伴あり
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-600" aria-hidden />
            捌きあり
          </span>
        </div>
      )}

      {/* マトリックステーブル（スマホで横スクロール） */}
      <div className="w-full overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-[400px] w-full border-collapse sm:min-w-[480px]">
          <thead>
            <tr className="bg-slate-50">
              <th className="sticky left-0 z-10 min-w-[88px] whitespace-nowrap border-b border-r border-gray-200 bg-slate-50 px-2 py-3 text-left text-xs font-semibold text-gray-700 shadow-sm sm:min-w-[112px] sm:text-sm">
                キャスト
              </th>
              {dates.map((d) => {
                const w = getWeekdayJst(d);
                const colorClass =
                  w === 0 ? "text-red-600" : w === 6 ? "text-blue-600" : "text-gray-600";
                const isToday = d === today;
                return (
                  <th
                    key={d}
                    className={`min-w-[52px] whitespace-nowrap border-b border-r border-gray-200 px-1.5 py-3 text-center text-xs font-medium sm:min-w-0 sm:text-sm ${colorClass} ${
                      isToday ? "bg-blue-50/70" : ""
                    }`}
                  >
                    <span className="sm:hidden">{formatDateShort(d)}</span>
                    <span className="hidden sm:inline">{formatDateWithWeekday(d)}</span>
                    {isToday && (
                      <span className="ml-1 hidden rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 sm:inline">
                        今日
                      </span>
                    )}
                  </th>
                );
              })}
              <th className="min-w-[56px] border-b border-r border-gray-200 px-1 py-3 text-center text-xs font-semibold text-gray-700 sm:min-w-[72px] sm:px-2 sm:text-sm">
                個別
              </th>
              <th className="min-w-[56px] border-b border-gray-200 px-1 py-3 text-center text-xs font-semibold text-gray-700 sm:min-w-[72px] sm:px-2 sm:text-sm">
                変更通知
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {casts.map((cast, rowIndex) => (
              <tr
                key={cast.id}
                className={`transition-colors hover:bg-blue-50/40 ${
                  rowIndex % 2 === 1 ? "bg-slate-50/50" : "bg-white"
                }`}
              >
                <td
                  className={`sticky left-0 z-10 min-w-[88px] whitespace-nowrap border-b border-r border-gray-200 px-2 py-2 text-xs font-medium text-gray-900 shadow-sm sm:min-w-[112px] sm:text-sm ${
                    rowIndex % 2 === 1 ? "bg-slate-50/50" : "bg-white"
                  }`}
                >
                  {cast.name}
                </td>
                {dates.map((dateStr) => {
                  const hasTime = Boolean(matrix[cast.id]?.[dateStr]?.trim());
                  const isDohanOn = dohan[cast.id]?.[dateStr] ?? false;
                  const isSabakiOn = sabaki[cast.id]?.[dateStr] ?? false;
                  const isToday = dateStr === today;
                  return (
                    <td
                      key={dateStr}
                      className={`border-b border-r border-gray-200 p-0.5 sm:p-1 ${
                        isToday ? "bg-blue-50/30" : ""
                      }`}
                    >
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1">
                          <select
                            value={matrix[cast.id]?.[dateStr] ?? ""}
                            onChange={(e) => updateCell(cast.id, dateStr, e.target.value)}
                            className="w-full min-w-[56px] sm:w-20 min-h-[40px] sm:h-10 px-1 sm:px-1.5 text-xs sm:text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                          >
                            {timeOptions.map((opt) => (
                              <option key={opt.value || "empty"} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          <span className="text-xs text-slate-400" aria-hidden>
                            〜
                          </span>
                          <select
                            value={endMatrix[cast.id]?.[dateStr] ?? ""}
                            onChange={(e) => updateEndCell(cast.id, dateStr, e.target.value)}
                            className="w-full min-w-[56px] sm:w-20 min-h-[40px] sm:h-10 px-1 sm:px-1.5 text-xs sm:text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                          >
                            {timeOptions.map((opt) => (
                              <option key={`end-${opt.value || "empty"}`} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        {/* 同伴・捌き: 出勤時間がある場合のみ */}
                        {hasTime && store?.is_dohan_sabaki_enabled !== false && (
                          <div className="flex gap-0.5">
                            <button
                              type="button"
                              onClick={() => toggleDohan(cast.id, dateStr)}
                              className={`flex-1 min-h-[28px] text-[10px] sm:text-xs px-0.5 py-0.5 rounded-md border touch-manipulation transition-colors ${
                                isDohanOn
                                  ? "bg-pink-500 border-pink-600 text-white font-medium shadow-sm"
                                  : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                              }`}
                            >
                              同伴
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleSabaki(cast.id, dateStr)}
                              className={`flex-1 min-h-[28px] text-[10px] sm:text-xs px-0.5 py-0.5 rounded-md border touch-manipulation transition-colors ${
                                isSabakiOn
                                  ? "bg-amber-600 border-amber-700 text-white font-medium shadow-sm"
                                  : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                              }`}
                            >
                              捌き
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  );
                })}
                <td className="border-b border-r border-gray-200 p-0.5 sm:p-1 text-center align-top">
                  <button
                    type="button"
                    onClick={() => handleNotifyIndividual(cast.id, false)}
                    disabled={saving || notifying || notifyingOp !== null}
                    title="この人にシフトをLINEで個別送信"
                    className="w-full text-xs sm:text-sm px-1 sm:px-1.5 py-2 sm:py-1.5 min-h-[40px] rounded-md border border-[#06C755] text-[#06C755] hover:bg-[#06C755] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation font-medium"
                  >
                    {notifyingOp?.castId === cast.id && !notifyingOp.isUpdate
                      ? "送信中..."
                      : "個別"}
                  </button>
                </td>
                <td className="border-b border-gray-200 p-0.5 sm:p-1 text-center align-top">
                  <button
                    type="button"
                    onClick={() => handleNotifyIndividual(cast.id, true)}
                    disabled={saving || notifying || notifyingOp !== null}
                    title="この人に変更をLINEで通知"
                    className="w-full text-xs sm:text-sm px-1 sm:px-1.5 py-2 sm:py-1.5 min-h-[40px] rounded-md border border-orange-500 text-orange-600 hover:bg-orange-500 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation font-medium"
                  >
                    {notifyingOp?.castId === cast.id && notifyingOp.isUpdate
                      ? "送信中..."
                      : "変更通知"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 保存結果メッセージ */}
      {message === "success" && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" aria-hidden />
          保存しました
        </div>
      )}
      {message === "error" && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <div className="flex items-center gap-2 font-medium">
            <AlertCircle className="h-4 w-4 flex-shrink-0" aria-hidden />
            保存に失敗しました。再度お試しください。
          </div>
          {saveErrorHint ? (
            <p className="mt-1.5 break-words whitespace-pre-wrap font-mono text-xs text-red-800/90">
              {saveErrorHint}
            </p>
          ) : null}
        </div>
      )}

      {/* メインアクション */}
      <div className="mt-5 flex flex-col gap-3 border-t border-gray-200 pt-5 sm:mt-6 sm:flex-row sm:gap-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || notifying}
          className={`inline-flex min-h-[48px] h-12 w-full items-center justify-center gap-2 rounded-lg px-6 text-sm font-semibold text-white shadow-sm transition-colors touch-manipulation focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-[200px] ${
            dirty
              ? "bg-blue-600 hover:bg-blue-700 focus:ring-blue-500 ring-2 ring-blue-300 ring-offset-1"
              : "bg-blue-600 hover:bg-blue-700 focus:ring-blue-500"
          }`}
        >
          <Save className="h-4 w-4" aria-hidden />
          {saving ? "保存中..." : "一括保存する"}
        </button>
        <button
          type="button"
          onClick={handleNotify}
          disabled={saving || notifying || notifyingOp !== null}
          className="inline-flex min-h-[48px] h-12 w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[#06C755] px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#05B34C] focus:ring-2 focus:ring-[#06C755] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 touch-manipulation sm:w-auto sm:min-w-[260px]"
        >
          <Send className="h-4 w-4" aria-hidden />
          {notifying
            ? notifyStatus === "done"
              ? "送信完了"
              : "送信中..."
            : "確定シフトをLINEで一斉通知"}
        </button>
      </div>

      {casts.length === 0 && (
        <div className="mt-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <Users className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
          キャストが登録されていません。先にキャストを追加してください。
        </div>
      )}
    </div>
  );
}
