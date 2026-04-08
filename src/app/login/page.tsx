"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase-client";

/**
 * Supabase の signInWithPassword 用メールを決定する。
 * - `@` を含む → 外部メール等としてそのまま（前後のみ trim）
 * - 含まない → 内部ユーザー名として小文字化し `@raku-kyaba.internal` を付加
 */
function resolveLoginEmail(input: string): string {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.includes("@")) {
    return trimmed;
  }
  return `${trimmed.toLowerCase()}@raku-kyaba.internal`;
}

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();

    const email = resolveLoginEmail(trimmedUsername);
    if (!email) {
      setError("ユーザー名またはメールアドレスを入力してください。");
      setLoading(false);
      return;
    }
    if (!trimmedPassword) {
      setError("パスワードを入力してください。");
      setLoading(false);
      return;
    }

    try {
      const supabase = createBrowserSupabaseClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password: trimmedPassword,
      });

      if (authError) {
        console.error("[Login] エラー詳細:", authError.message);
        setError("ユーザー名またはパスワードに誤りがあります。もう一度お確かめください。");
        setLoading(false);
        return;
      }

      router.push("/admin/weekly");
      router.refresh();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[Login] エラー詳細:", errMsg);
      setError("エラーが発生しました。しばらく経ってから再度お試しください。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-8">
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        トップへ戻る
      </Link>

      <div className="w-full max-w-sm">
        <form
          onSubmit={handleSubmit}
          className="border border-slate-200 rounded-xl p-5 sm:p-8 bg-white shadow-sm"
        >
          <h1 className="text-xl sm:text-2xl font-bold text-center mb-2 text-slate-900 leading-snug">
            今まであったようでなかった出勤システム
          </h1>
          <p className="text-center text-sm text-slate-500 mb-6">ログイン</p>

          {error && (
            <p className="text-red-600 text-sm text-center mb-4 px-2" role="alert">
              {error}
            </p>
          )}

          <div className="space-y-4 sm:space-y-5">
            <div>
              <label htmlFor="username" className="block text-sm text-slate-700 mb-2 font-medium">
                ユーザー名 / メールアドレス
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="gold または example@gmail.com"
                className="w-full px-4 py-3 min-h-[44px] text-base bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 text-slate-900 placeholder-slate-400 transition-colors"
                autoComplete="username"
                disabled={loading}
              />
              <p className="text-xs text-slate-500 mt-1">※ @ が無い場合のみ @raku-kyaba.internal が付きます</p>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm text-slate-700 mb-2 font-medium">
                パスワード
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 pr-12 min-h-[44px] text-base bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 text-slate-900 placeholder-slate-400 transition-colors"
                  autoComplete="current-password"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-800 transition-colors disabled:opacity-50"
                  disabled={loading}
                  aria-label={showPassword ? "パスワードを隠す" : "パスワードを表示"}
                >
                  {showPassword ? <EyeOff size={18} strokeWidth={1.5} /> : <Eye size={18} strokeWidth={1.5} />}
                </button>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-5 sm:mt-6 py-3 min-h-[48px] rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          >
            {loading ? "ログイン中..." : "ログイン"}
          </button>
        </form>
      </div>
    </div>
  );
}
