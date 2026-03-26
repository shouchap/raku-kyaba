"use client";

import { useCallback, useEffect, useState } from "react";

type StoreListRow = {
  id: string;
  name: string;
  created_at: string;
};

type StoreDetail = {
  id: string;
  name: string;
  line_channel_id: string | null;
  line_channel_secret: string;
  line_channel_access_token: string | null;
  line_bot_user_id: string | null;
  admin_line_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export default function AdminStoresPage() {
  const [stores, setStores] = useState<StoreListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<"success" | "error" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StoreDetail | null>(null);
  const [saving, setSaving] = useState(false);

  const [newName, setNewName] = useState("");
  const [newSecret, setNewSecret] = useState("");
  const [newToken, setNewToken] = useState("");

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/stores", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "一覧の取得に失敗しました");
      setStores(data.stores ?? []);
    } catch (e) {
      console.error(e);
      setMessage("error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const startEdit = async (id: string) => {
    setEditingId(id);
    setDetail(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/stores/${id}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "取得に失敗しました");
      setDetail(data.store as StoreDetail);
    } catch (e) {
      console.error(e);
      setEditingId(null);
      setMessage("error");
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDetail(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          line_channel_secret: newSecret.trim(),
          line_channel_access_token: newToken.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "作成に失敗しました");
      setNewName("");
      setNewSecret("");
      setNewToken("");
      setMessage("success");
      await loadList();
    } catch (err) {
      console.error(err);
      setMessage("error");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    setSaving(true);
    setMessage(null);
    try {
      const body: Record<string, unknown> = {
        name: detail.name.trim(),
        line_channel_secret: detail.line_channel_secret.trim(),
        line_channel_access_token: detail.line_channel_access_token?.trim() ?? "",
        line_channel_id: detail.line_channel_id?.trim() || null,
        line_bot_user_id: detail.line_bot_user_id?.trim() || null,
        admin_line_user_id: detail.admin_line_user_id?.trim() || null,
      };
      const res = await fetch(`/api/admin/stores/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "更新に失敗しました");
      setMessage("success");
      setEditingId(null);
      setDetail(null);
      await loadList();
    } catch (err) {
      console.error(err);
      setMessage("error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 sm:p-8 text-center text-gray-500 text-sm">読み込み中...</div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-8">
      <div>
        <h1 className="text-lg sm:text-xl font-bold text-gray-900">店舗管理</h1>
        <p className="text-xs sm:text-sm text-gray-600 mt-1">
          全店舗の登録・LINE 連携情報の編集（スーパー管理者専用）
        </p>
      </div>

      <section className="border border-gray-200 rounded-lg p-4 sm:p-5 bg-gray-50/50">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">新規店舗</h2>
        <form onSubmit={handleCreate} className="space-y-3 max-w-lg">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              店舗名 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
              className="w-full min-h-[44px] px-3 border border-gray-300 rounded-md text-sm"
              placeholder="例: Club GOLD"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              LINE Channel Secret <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              value={newSecret}
              onChange={(e) => setNewSecret(e.target.value)}
              required
              autoComplete="new-password"
              className="w-full min-h-[44px] px-3 border border-gray-300 rounded-md text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              LINE Channel Access Token
            </label>
            <textarea
              value={newToken}
              onChange={(e) => setNewToken(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-xs font-mono"
              placeholder="長いトークン文字列"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "作成中..." : "店舗を追加"}
          </button>
        </form>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-800 mb-3">登録済み店舗</h2>
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100 text-left text-xs text-gray-600">
              <tr>
                <th className="px-3 py-2 font-medium">店舗名</th>
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">作成日</th>
                <th className="px-3 py-2 font-medium w-28">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {stores.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-gray-500">
                    店舗がありません
                  </td>
                </tr>
              ) : (
                stores.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50/80">
                    <td className="px-3 py-2 font-medium text-gray-900">{s.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500 break-all max-w-[200px]">
                      {s.id}
                    </td>
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                      {new Date(s.created_at).toLocaleString("ja-JP")}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => startEdit(s.id)}
                        className="text-blue-600 hover:underline text-xs font-medium"
                      >
                        編集
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editingId && detail && (
        <section className="border border-amber-200 rounded-lg p-4 sm:p-5 bg-amber-50/40">
          <div className="flex items-center justify-between gap-2 mb-4">
            <h2 className="text-sm font-semibold text-gray-900">店舗を編集</h2>
            <button
              type="button"
              onClick={cancelEdit}
              className="text-xs text-gray-600 hover:text-gray-900"
            >
              閉じる
            </button>
          </div>
          <form onSubmit={handleUpdate} className="space-y-3 max-w-2xl">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">店舗名</label>
              <input
                type="text"
                value={detail.name}
                onChange={(e) => setDetail({ ...detail, name: e.target.value })}
                required
                className="w-full min-h-[44px] px-3 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                LINE Channel Secret
              </label>
              <input
                type="password"
                value={detail.line_channel_secret}
                onChange={(e) =>
                  setDetail({ ...detail, line_channel_secret: e.target.value })
                }
                required
                autoComplete="new-password"
                className="w-full min-h-[44px] px-3 border border-gray-300 rounded-md text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                LINE Channel Access Token
              </label>
              <textarea
                value={detail.line_channel_access_token ?? ""}
                onChange={(e) =>
                  setDetail({ ...detail, line_channel_access_token: e.target.value })
                }
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-xs font-mono"
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  LINE Channel ID（任意）
                </label>
                <input
                  type="text"
                  value={detail.line_channel_id ?? ""}
                  onChange={(e) =>
                    setDetail({ ...detail, line_channel_id: e.target.value || null })
                  }
                  className="w-full min-h-[40px] px-3 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  LINE Bot User ID（任意）
                </label>
                <input
                  type="text"
                  value={detail.line_bot_user_id ?? ""}
                  onChange={(e) =>
                    setDetail({ ...detail, line_bot_user_id: e.target.value || null })
                  }
                  className="w-full min-h-[40px] px-3 border border-gray-300 rounded-md text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                管理者 LINE User ID（任意・レガシー通知用）
              </label>
              <input
                type="text"
                value={detail.admin_line_user_id ?? ""}
                onChange={(e) =>
                  setDetail({ ...detail, admin_line_user_id: e.target.value || null })
                }
                className="w-full min-h-[40px] px-3 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-amber-700 text-white text-sm font-medium rounded-md hover:bg-amber-800 disabled:opacity-50"
            >
              {saving ? "保存中..." : "変更を保存"}
            </button>
          </form>
        </section>
      )}

      {message === "success" && (
        <p className="text-green-600 text-sm font-medium">完了しました</p>
      )}
      {message === "error" && (
        <p className="text-red-600 text-sm">処理に失敗しました。権限と入力内容を確認してください。</p>
      )}
    </div>
  );
}
