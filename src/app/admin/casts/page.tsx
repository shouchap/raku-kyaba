"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase-client";
import { useActiveStoreId } from "@/contexts/ActiveStoreContext";
import { normalizeDefaultHospitalNames } from "@/lib/welfare-line-flex";
import type { CastEmploymentType } from "@/types/entities";

type Cast = {
  id: string;
  name: string;
  store_id: string;
  line_user_id?: string;
  is_admin?: boolean;
  employment_type?: CastEmploymentType | null;
  is_guide_target?: boolean;
  /** 福祉: かかりつけ病院（LINE 通院報告・複数可） */
  default_hospital_names?: string[] | null;
  created_at?: string;
};

type Store = {
  id: string;
  name: string;
  business_type?: string | null;
};

const EMPLOYMENT_OPTIONS: { value: CastEmploymentType; label: string }[] = [
  { value: "admin", label: "管理者" },
  { value: "regular", label: "レギュラー" },
  { value: "part_time", label: "バイト" },
  { value: "employee", label: "従業員" },
];

export default function AdminCastsPage() {
  const activeStoreId = useActiveStoreId();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [casts, setCasts] = useState<Cast[]>([]);
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editIsAdmin, setEditIsAdmin] = useState(false);
  const [editEmployment, setEditEmployment] = useState<CastEmploymentType>("part_time");
  const [editIsGuideTarget, setEditIsGuideTarget] = useState(false);
  const [editHospitalNames, setEditHospitalNames] = useState<string[]>([""]);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState<"success" | "error" | null>(null);

  const fetchCasts = useCallback(async () => {
    setLoading(true);
    const storeId = activeStoreId;
    try {
      const [castsRes, storesRes] = await Promise.all([
        supabase
          .from("casts")
          .select("id, name, store_id, line_user_id, is_admin, employment_type, is_guide_target, default_hospital_names")
          .eq("store_id", storeId)
          .eq("is_active", true)
          .order("name"),
        supabase.from("stores").select("id, name, business_type").eq("id", storeId).single(),
      ]);
      if (castsRes.data) setCasts(castsRes.data as Cast[]);
      if (storesRes.data) setStore(storesRes.data as Store);
    } catch (err) {
      console.error(err);
      setMessage("error");
    } finally {
      setLoading(false);
    }
  }, [supabase, activeStoreId]);

  useEffect(() => {
    fetchCasts();
  }, [fetchCasts]);

  const handleStartEdit = (cast: Cast) => {
    setEditingId(cast.id);
    setEditName(cast.name.trim());
    setEditIsAdmin(cast.is_admin ?? false);
    const em = cast.employment_type;
    setEditEmployment(
      em === "admin" || em === "regular" || em === "part_time" || em === "employee" ? em : "part_time"
    );
    setEditIsGuideTarget(cast.is_guide_target === true);
    const names = normalizeDefaultHospitalNames(cast.default_hospital_names);
    setEditHospitalNames(names.length > 0 ? [...names] : [""]);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditIsAdmin(false);
    setEditEmployment("part_time");
    setEditIsGuideTarget(false);
    setEditHospitalNames([""]);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    const newName = editName.trim();
    if (!newName) {
      handleCancelEdit();
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const payload: Record<string, unknown> = {
        name: newName,
        is_admin: editIsAdmin,
        employment_type: editEmployment,
        is_guide_target: editIsGuideTarget,
      };
      if (store?.business_type === "welfare_b") {
        payload.default_hospital_names = normalizeDefaultHospitalNames(editHospitalNames);
      }
      const { error } = await supabase
        .from("casts")
        .update(payload)
        .eq("id", editingId)
        .eq("store_id", activeStoreId);
      if (error) throw error;
      setCasts((prev) =>
        prev.map((c) =>
          c.id === editingId
            ? {
                ...c,
                name: newName,
                is_admin: editIsAdmin,
                employment_type: editEmployment,
                is_guide_target: editIsGuideTarget,
                ...(store?.business_type === "welfare_b"
                  ? {
                      default_hospital_names: normalizeDefaultHospitalNames(editHospitalNames),
                    }
                  : {}),
              }
            : c
        )
      );
      setMessage("success");
    } catch (err) {
      console.error(err);
      setMessage("error");
    } finally {
      setSaving(false);
      setEditingId(null);
      setEditName("");
      setEditIsAdmin(false);
      setEditEmployment("part_time");
      setEditIsGuideTarget(false);
      setEditHospitalNames([""]);
    }
  };

  const handleDelete = async (cast: Cast) => {
    const ok = window.confirm(
      `「${cast.name}」さんを削除しますか？\n関連するシフト・出勤記録も削除されます。`
    );
    if (!ok) return;
    if (cast.id === editingId) {
      handleCancelEdit();
    }
    setDeletingId(cast.id);
    setMessage(null);
    try {
      const { error } = await supabase
        .from("casts")
        .delete()
        .eq("id", cast.id)
        .eq("store_id", activeStoreId);
      if (error) throw error;
      setCasts((prev) => prev.filter((c) => c.id !== cast.id));
      setMessage("success");
    } catch (err) {
      console.error(err);
      setMessage("error");
    } finally {
      setDeletingId(null);
    }
  };

  const employmentLabel = (c: Cast | null): string => {
    if (!c) return "";
    const em = c.employment_type;
    if (em === "admin") return "管理者";
    if (em === "regular") return "レギュラー";
    if (em === "part_time") return "バイト";
    if (em === "employee") return "従業員";
    return "バイト";
  };

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center px-4 py-12">
        <p className="text-gray-500 text-sm sm:text-base">読み込み中...</p>
      </div>
    );
  }

  const isWelfare = store?.business_type === "welfare_b";
  const listTitle = isWelfare ? "利用者一覧" : "キャスト一覧";
  const editPanelTitle = isWelfare ? "利用者情報の編集" : "キャスト情報の編集";

  return (
    <div className="w-full p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-lg sm:text-xl font-bold text-gray-900 mb-1 sm:mb-2">
          {isWelfare ? "利用者管理" : "キャスト管理"}
        </h1>
        <p className="text-xs sm:text-sm text-gray-600">{store?.name ?? "店舗"}</p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch lg:gap-8">
        {/* 左: 一覧（約 40%） */}
        <section
          className="flex w-full min-w-0 flex-[2] flex-col rounded-xl border border-gray-200 bg-white shadow-sm"
          aria-labelledby="casts-list-heading"
        >
          <div className="border-b border-gray-100 px-4 py-3 sm:px-5">
            <h2 id="casts-list-heading" className="text-sm font-semibold text-gray-900">
              {listTitle}
            </h2>
          </div>
          <ul className="max-h-[min(70vh,720px)] divide-y divide-gray-100 overflow-y-auto overscroll-contain">
            {casts.length === 0 ? (
              <li className="px-4 py-10 text-center text-sm text-gray-500 sm:px-5">
                {isWelfare
                  ? "利用者が登録されていません。LINEで友だち追加すると自動登録されます。"
                  : "キャストが登録されていません。LINEで友だち追加すると自動登録されます。"}
              </li>
            ) : (
              casts.map((cast) => {
                const selected = editingId === cast.id;
                return (
                  <li
                    key={cast.id}
                    className={`flex flex-wrap items-center gap-2 px-3 py-3 sm:gap-3 sm:px-4 ${
                      selected
                        ? "bg-sky-50/90 border-l-4 border-sky-300"
                        : "hover:bg-gray-50/90"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 sm:text-base">
                      {cast.name}
                    </span>
                    {!isWelfare && (
                      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {employmentLabel(cast)}
                      </span>
                    )}
                    {cast.is_admin && (
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        👑 通知
                      </span>
                    )}
                    <div className="ml-auto flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(cast)}
                        disabled={deletingId !== null}
                        className="min-h-[40px] rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-800 hover:bg-white disabled:opacity-50 sm:text-sm touch-manipulation"
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(cast)}
                        disabled={deletingId !== null}
                        className="min-h-[40px] rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 sm:text-sm touch-manipulation"
                      >
                        {deletingId === cast.id ? "削除中..." : "削除"}
                      </button>
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </section>

        {/* 右: 編集フォーム（約 60%） */}
        <section
          className="flex w-full min-w-0 flex-[3] flex-col rounded-xl border border-gray-200 bg-white shadow-sm"
          aria-labelledby="casts-edit-heading"
        >
          <div className="border-b border-gray-100 px-4 py-3 sm:px-5">
            <h2 id="casts-edit-heading" className="text-sm font-semibold text-gray-900">
              {editPanelTitle}
            </h2>
          </div>

          <div className="flex min-h-[min(70vh,640px)] flex-1 flex-col p-4 sm:p-5">
            {!editingId ? (
              <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50/70 px-4 py-16 text-center">
                <p className="max-w-sm text-sm leading-relaxed text-gray-500">
                  左の一覧から「編集」を押すと、ここに{isWelfare ? "利用者" : "キャスト"}
                  情報のフォームが表示されます。
                </p>
              </div>
            ) : (
              <div className="flex flex-1 flex-col gap-6">
                <div className="flex w-full flex-col gap-4">
                  <label className="block w-full">
                    <span className="mb-1.5 block text-xs font-medium text-gray-600">
                      {isWelfare ? "利用者名" : "名前"}
                    </span>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveEdit();
                        if (e.key === "Escape") handleCancelEdit();
                      }}
                      className="w-full min-h-[44px] rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                      placeholder={isWelfare ? "利用者名" : "名前"}
                      autoFocus
                    />
                  </label>

                  <label className="block w-full">
                    <span className="mb-1.5 block text-xs font-medium text-gray-600">
                      権限・勤務形態
                    </span>
                    <select
                      value={editEmployment}
                      onChange={(e) =>
                        setEditEmployment(e.target.value as CastEmploymentType)
                      }
                      className="w-full min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-base outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                    >
                      {EMPLOYMENT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex w-full cursor-pointer items-start gap-3 rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-3">
                    <input
                      type="checkbox"
                      checked={editIsAdmin}
                      onChange={(e) => setEditIsAdmin(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-amber-500 focus:ring-amber-500"
                    />
                    <span className="text-sm leading-snug text-gray-700">管理者通知を受け取る</span>
                  </label>

                  <label className="flex w-full cursor-pointer items-start gap-3 rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-3">
                    <input
                      type="checkbox"
                      checked={editIsGuideTarget}
                      onChange={(e) => setEditIsGuideTarget(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-emerald-600 focus:ring-emerald-600"
                    />
                    <span className="text-sm leading-snug text-gray-700">
                      案内数ヒアリングの対象にする（営業終了時にLINE送信）
                    </span>
                  </label>

                  {isWelfare && (
                    <div className="block w-full">
                      <span className="mb-1.5 block text-xs font-medium text-gray-600">
                        かかりつけ病院（通院報告の候補）
                      </span>
                      <div className="flex flex-col gap-2">
                        {editHospitalNames.map((row, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <input
                              type="text"
                              value={row}
                              onChange={(e) => {
                                const v = e.target.value;
                                setEditHospitalNames((prev) => {
                                  const next = [...prev];
                                  next[idx] = v;
                                  return next;
                                });
                              }}
                              placeholder="例：〇〇総合病院"
                              className="min-h-[44px] flex-1 min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-base outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                              autoComplete="organization"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setEditHospitalNames((prev) =>
                                  prev.length <= 1 ? [""] : prev.filter((_, i) => i !== idx)
                                )
                              }
                              className="shrink-0 min-h-[44px] min-w-[44px] rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-700 hover:bg-gray-50 touch-manipulation"
                              title="この行を削除"
                              aria-label="削除"
                            >
                              ❌
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditHospitalNames((p) => [...p, ""])}
                        className="mt-3 min-h-[40px] rounded-lg border border-dashed border-gray-300 bg-gray-50/80 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 touch-manipulation"
                      >
                        ＋ 追加
                      </button>
                    </div>
                  )}
                </div>

                <div className="mt-auto flex w-full flex-wrap gap-3 border-t border-gray-100 pt-5">
                  <button
                    type="button"
                    onClick={handleSaveEdit}
                    disabled={saving}
                    className="min-h-[44px] min-w-[6rem] rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 touch-manipulation"
                  >
                    {saving ? "保存中..." : "保存"}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    disabled={saving}
                    className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50 touch-manipulation"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {message === "success" && (
        <p className="mt-6 text-sm font-medium text-green-600">完了しました</p>
      )}
      {message === "error" && (
        <p className="mt-6 text-sm text-red-600">処理に失敗しました。再度お試しください。</p>
      )}
    </div>
  );
}
