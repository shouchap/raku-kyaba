"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, UserPlus, X } from "lucide-react";

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

const MIN_PASSWORD = 8;

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

  /** 店長アカウント発行モーダル */
  const [accountModal, setAccountModal] = useState<StoreListRow | null>(null);
  const [accUsername, setAccUsername] = useState("");
  const [accPassword, setAccPassword] = useState("");
  const [showAccPassword, setShowAccPassword] = useState(false);
  const [accSubmitting, setAccSubmitting] = useState(false);
  const [accError, setAccError] = useState<string | null>(null);
  const [accSuccess, setAccSuccess] = useState<string | null>(null);

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

  const openAccountModal = (store: StoreListRow) => {
    setAccountModal(store);
    setAccUsername("");
    setAccPassword("");
    setAccError(null);
    setAccSuccess(null);
    setShowAccPassword(false);
  };

  const closeAccountModal = () => {
    if (accSubmitting) return;
    setAccountModal(null);
    setAccError(null);
    setAccSuccess(null);
  };

  const handleIssueAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountModal) return;
    setAccSubmitting(true);
    setAccError(null);
    setAccSuccess(null);

    const u = accUsername.trim().toLowerCase();
    if (!u) {
      setAccError("ユーザー名を入力してください");
      setAccSubmitting(false);
      return;
    }
    if (u.includes("@")) {
      setAccError("@ は含めないでください（ログイン用メールは自動で付与されます）");
      setAccSubmitting(false);
      return;
    }
    if (accPassword.length < MIN_PASSWORD) {
      setAccError(`パスワードは ${MIN_PASSWORD} 文字以上にしてください`);
      setAccSubmitting(false);
      return;
    }

    try {
      const res = await fetch("/api/admin/users/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: accountModal.id,
          username: u,
          password: accPassword,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setAccError(data.error ?? "作成に失敗しました");
        setAccSubmitting(false);
        return;
      }

      setAccSuccess(
        `アカウントを発行しました。ログインID: ${data.email ?? `${u}@raku-kyaba.internal`}`
      );
      setAccUsername("");
      setAccPassword("");
    } catch (err) {
      console.error(err);
      setAccError("通信エラーが発生しました。しばらくしてから再度お試しください。");
    } finally {
      setAccSubmitting(false);
    }
  };

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
      {accountModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="account-modal-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-gray-900/50 backdrop-blur-[2px]"
            onClick={closeAccountModal}
            aria-label="閉じる"
          />
          <div className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-2xl shadow-gray-900/10">
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
              <div className="flex gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md">
                  <UserPlus className="w-5 h-5" strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <h2
                    id="account-modal-title"
                    className="text-base font-semibold text-gray-900"
                  >
                    店長アカウントを発行
                  </h2>
                  <p className="text-sm text-gray-500 mt-0.5 truncate" title={accountModal.name}>
                    {accountModal.name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeAccountModal}
                disabled={accSubmitting}
                className="shrink-0 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
                aria-label="モーダルを閉じる"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleIssueAccount} className="px-5 py-5 space-y-4">
              <p className="text-xs text-gray-600 leading-relaxed">
                発行後、店長は<strong className="text-gray-800">ユーザー名のみ</strong>
                （例: bronze）でログインできます。初回ログイン時にこの店舗へ自動で紐づきます。
              </p>

              <div>
                <label
                  htmlFor="acc-username"
                  className="block text-xs font-medium text-gray-700 mb-1.5"
                >
                  ユーザー名 <span className="text-red-500">*</span>
                </label>
                <input
                  id="acc-username"
                  type="text"
                  value={accUsername}
                  onChange={(e) => setAccUsername(e.target.value)}
                  autoComplete="off"
                  placeholder="bronze"
                  disabled={accSubmitting}
                  className="w-full min-h-[44px] px-3 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-50"
                />
                <p className="text-[11px] text-gray-500 mt-1.5 font-mono">
                  ログイン用:{" "}
                  <span className="text-indigo-700">
                    {(accUsername.trim().toLowerCase() || "ユーザー名")}
                    @raku-kyaba.internal
                  </span>
                </p>
              </div>

              <div>
                <label
                  htmlFor="acc-password"
                  className="block text-xs font-medium text-gray-700 mb-1.5"
                >
                  パスワード <span className="text-red-500">*</span>
                  <span className="text-gray-400 font-normal">（{MIN_PASSWORD}文字以上）</span>
                </label>
                <div className="relative">
                  <input
                    id="acc-password"
                    type={showAccPassword ? "text" : "password"}
                    value={accPassword}
                    onChange={(e) => setAccPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder="安全なパスワード"
                    disabled={accSubmitting}
                    className="w-full min-h-[44px] px-3 pr-11 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAccPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-700 rounded-md"
                    tabIndex={-1}
                    aria-label={showAccPassword ? "パスワードを隠す" : "パスワードを表示"}
                  >
                    {showAccPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {accError && (
                <div
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800"
                  role="alert"
                >
                  {accError}
                </div>
              )}
              {accSuccess && (
                <div
                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900"
                  role="status"
                >
                  {accSuccess}
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-1">
                <button
                  type="button"
                  onClick={closeAccountModal}
                  disabled={accSubmitting}
                  className="min-h-[44px] px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {accSuccess ? "閉じる" : "キャンセル"}
                </button>
                <button
                  type="submit"
                  disabled={accSubmitting || !!accSuccess}
                  className="min-h-[44px] px-5 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-semibold shadow-md hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:shadow-none"
                >
                  {accSuccess
                    ? "発行済み"
                    : accSubmitting
                      ? "発行中..."
                      : "アカウントを発行"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div>
        <h1 className="text-lg sm:text-xl font-bold text-gray-900">店舗管理</h1>
        <p className="text-xs sm:text-sm text-gray-600 mt-1">
          全店舗の登録・LINE 連携・<strong>店長ログイン</strong>の発行（スーパー管理者専用）
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
                <th className="px-3 py-2 font-medium whitespace-nowrap">操作</th>
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
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        <button
                          type="button"
                          onClick={() => openAccountModal(s)}
                          className="text-indigo-600 hover:text-indigo-800 hover:underline text-xs font-medium inline-flex items-center gap-1"
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                          アカウント発行
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(s.id)}
                          className="text-blue-600 hover:underline text-xs font-medium"
                        >
                          編集
                        </button>
                      </div>
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
