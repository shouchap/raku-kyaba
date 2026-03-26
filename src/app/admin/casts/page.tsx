"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase-client";
import { useActiveStoreId } from "@/contexts/ActiveStoreContext";

type Cast = {
  id: string;
  name: string;
  store_id: string;
  line_user_id?: string;
  is_admin?: boolean;
  created_at?: string;
};

type Store = {
  id: string;
  name: string;
};

export default function AdminCastsPage() {
  const activeStoreId = useActiveStoreId();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [casts, setCasts] = useState<Cast[]>([]);
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editIsAdmin, setEditIsAdmin] = useState(false);
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
          .select("id, name, store_id, line_user_id, is_admin")
          .eq("store_id", storeId)
          .eq("is_active", true)
          .order("name"),
        supabase.from("stores").select("id, name").eq("id", storeId).single(),
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
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditIsAdmin(false);
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
      const { error } = await supabase
        .from("casts")
        .update({ name: newName, is_admin: editIsAdmin })
        .eq("id", editingId)
        .eq("store_id", activeStoreId);
      if (error) throw error;
      setCasts((prev) =>
        prev.map((c) =>
          c.id === editingId ? { ...c, name: newName, is_admin: editIsAdmin } : c
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
    }
  };

  const handleDelete = async (cast: Cast) => {
    const ok = window.confirm(
      `「${cast.name}」さんを削除しますか？\n関連するシフト・出勤記録も削除されます。`
    );
    if (!ok) return;
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <p className="text-gray-500 text-sm sm:text-base">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-4 sm:py-6 px-3 sm:px-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-4 sm:mb-6">
          <h1 className="text-lg sm:text-xl font-bold text-gray-900 mb-1 sm:mb-2">
            キャスト管理
          </h1>
          <p className="text-xs sm:text-sm text-gray-600">
            {store?.name ?? "店舗"}
          </p>
        </div>

        <div className="w-full rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
          <ul className="divide-y divide-gray-200">
            {casts.length === 0 ? (
              <li className="px-3 sm:px-4 py-6 sm:py-8 text-center text-gray-500 text-sm">
                キャストが登録されていません。LINEで友だち追加すると自動登録されます。
              </li>
            ) : (
              casts.map((cast) => (
                <li
                  key={cast.id}
                  className="flex flex-wrap items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 hover:bg-gray-50"
                >
                  {editingId === cast.id ? (
                    <>
                      <div className="flex-1 min-w-0 flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveEdit();
                            if (e.key === "Escape") handleCancelEdit();
                          }}
                          className="flex-1 min-w-0 min-h-[44px] px-3 py-2 text-base border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                          placeholder="名前"
                          autoFocus
                        />
                        <label className="flex items-center gap-2 shrink-0 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editIsAdmin}
                            onChange={(e) => setEditIsAdmin(e.target.checked)}
                            className="w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-500"
                          />
                          <span className="text-sm text-gray-700">管理者権限</span>
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={handleSaveEdit}
                        disabled={saving}
                        className="min-h-[44px] px-3 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 touch-manipulation"
                      >
                        {saving ? "保存中..." : "保存"}
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        disabled={saving}
                        className="min-h-[44px] px-3 py-2 text-sm border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 touch-manipulation"
                      >
                        キャンセル
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 min-w-0 font-medium text-gray-900 text-sm sm:text-base truncate">{cast.name}</span>
                      {cast.is_admin && (
                        <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium">
                          👑 管理者
                        </span>
                      )}
                      <div className="flex gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleStartEdit(cast)}
                          disabled={deletingId !== null}
                          className="min-h-[44px] px-3 py-2 text-xs sm:text-sm border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 touch-manipulation"
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(cast)}
                          disabled={deletingId !== null}
                          className="min-h-[44px] px-3 py-2 text-xs sm:text-sm border border-red-300 text-red-600 rounded hover:bg-red-50 disabled:opacity-50 touch-manipulation"
                        >
                          {deletingId === cast.id ? "削除中..." : "削除"}
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))
            )}
          </ul>
        </div>

        {message === "success" && (
          <p className="mt-4 text-green-600 text-sm font-medium">
            完了しました
          </p>
        )}
        {message === "error" && (
          <p className="mt-4 text-red-600 text-sm">
            処理に失敗しました。再度お試しください。
          </p>
        )}
      </div>
    </div>
  );
}
