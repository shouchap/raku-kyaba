"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createBrowserSupabaseClient } from "@/lib/supabase-client";

const GOLD = "#D4AF37";

type Cast = {
  id: string;
  name: string;
  store_id: string;
  line_user_id?: string;
};

type Store = {
  id: string;
  name: string;
};

export default function AdminCastsPage() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [casts, setCasts] = useState<Cast[]>([]);
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState<"success" | "error" | null>(null);

  const fetchCasts = useCallback(async () => {
    setLoading(true);
    try {
      const [castsRes, storesRes] = await Promise.all([
        supabase
          .from("casts")
          .select("id, name, store_id, line_user_id")
          .eq("is_active", true)
          .order("name"),
        supabase.from("stores").select("id, name").limit(1).single(),
      ]);
      if (castsRes.data) setCasts(castsRes.data as Cast[]);
      if (storesRes.data) setStore(storesRes.data as Store);
    } catch (err) {
      console.error(err);
      setMessage("error");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchCasts();
  }, [fetchCasts]);

  const handleStartEdit = (cast: Cast) => {
    setEditingId(cast.id);
    setEditName(cast.name.trim());
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName("");
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
        .update({ name: newName })
        .eq("id", editingId);
      if (error) throw error;
      setCasts((prev) =>
        prev.map((c) => (c.id === editingId ? { ...c, name: newName } : c))
      );
      setMessage("success");
    } catch (err) {
      console.error(err);
      setMessage("error");
    } finally {
      setSaving(false);
      setEditingId(null);
      setEditName("");
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
      const { error } = await supabase.from("casts").delete().eq("id", cast.id);
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
      <div className="min-h-screen bg-black flex items-center justify-center">
        <p className="text-[#D4AF37]/80">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-[#D4AF37] py-8 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto">
        <h1
          className="text-2xl font-light tracking-[0.15em] mb-2"
          style={{ fontFamily: "'Cinzel', 'Georgia', serif" }}
        >
          キャスト管理
        </h1>
        <p className="text-sm text-[#D4AF37]/70 mb-6">
          {store?.name ?? "店舗"}
        </p>

        <Link
          href="/admin/weekly"
          className="inline-flex items-center gap-2 mb-6 px-4 py-2 border border-[#D4AF37]/50 rounded hover:bg-[#D4AF37]/10 transition-colors text-sm"
        >
          シフト登録へ
        </Link>

        <div className="border border-[#D4AF37]/50 rounded-lg overflow-hidden bg-black/80">
          <ul className="divide-y divide-[#D4AF37]/20">
            {casts.length === 0 ? (
              <li className="px-4 py-8 text-center text-[#D4AF37]/60 text-sm">
                キャストが登録されていません。LINEで友だち追加すると自動登録されます。
              </li>
            ) : (
              casts.map((cast) => (
                <li
                  key={cast.id}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-[#D4AF37]/5 transition-colors"
                >
                  {editingId === cast.id ? (
                    <>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveEdit();
                          if (e.key === "Escape") handleCancelEdit();
                        }}
                        className="flex-1 px-3 py-2 bg-black/80 border border-[#D4AF37]/50 rounded text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#D4AF37]"
                        placeholder="名前"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={handleSaveEdit}
                        disabled={saving}
                        className="px-3 py-1.5 text-xs border border-[#D4AF37] rounded hover:bg-[#D4AF37]/10 disabled:opacity-50"
                      >
                        {saving ? "保存中..." : "保存"}
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        disabled={saving}
                        className="px-3 py-1.5 text-xs border border-[#D4AF37]/50 rounded hover:bg-[#D4AF37]/5 disabled:opacity-50"
                      >
                        キャンセル
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 font-light">{cast.name}</span>
                      <button
                        type="button"
                        onClick={() => handleStartEdit(cast)}
                        disabled={deletingId !== null}
                        className="px-3 py-1.5 text-xs border border-[#D4AF37]/50 rounded hover:bg-[#D4AF37]/10 disabled:opacity-50"
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(cast)}
                        disabled={deletingId !== null}
                        className="px-3 py-1.5 text-xs border border-red-500/50 text-red-400 rounded hover:bg-red-500/10 disabled:opacity-50"
                      >
                        {deletingId === cast.id ? "削除中..." : "削除"}
                      </button>
                    </>
                  )}
                </li>
              ))
            )}
          </ul>
        </div>

        {message === "success" && (
          <p className="mt-4 text-green-400 text-sm">完了しました。</p>
        )}
        {message === "error" && (
          <p className="mt-4 text-red-400 text-sm">
            処理に失敗しました。再度お試しください。
          </p>
        )}
      </div>
    </div>
  );
}
