"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
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
    <div className="min-h-screen flex items-center justify-center overflow-hidden relative bg-slate-950">
      {/* 背景: 淡いグラデーション + グリッド（汎用 SaaS 向け） */}
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% -20%, rgba(99, 102, 241, 0.18), transparent), radial-gradient(ellipse 60% 40% at 100% 100%, rgba(99, 102, 241, 0.08), transparent)",
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.35] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(148, 163, 184, 0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(148, 163, 184, 0.06) 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
        }}
      />

      <div className="relative z-10 w-full max-w-[420px] mx-4 sm:mx-6">
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-slate-700/80 bg-slate-900/90 backdrop-blur-md shadow-2xl shadow-black/40 px-6 py-8 sm:px-8 sm:py-10"
        >
          {/* ブランドブロック */}
          <header className="text-center mb-8 sm:mb-10">
            <p className="text-[11px] sm:text-xs font-medium uppercase tracking-[0.2em] text-slate-500 mb-3">
              Raku-Raku Platform
            </p>
            <h1 className="text-2xl sm:text-[1.75rem] font-semibold tracking-tight text-white leading-tight">
              Raku-Raku
            </h1>
            <p
              className="mt-2 text-sm sm:text-base font-medium text-slate-400 tracking-wide"
              style={{ letterSpacing: "0.12em" }}
            >
              STAFF PORTAL
            </p>
          </header>

          {error && (
            <p
              className="text-red-400 text-sm text-center mb-5 px-1 rounded-lg bg-red-950/50 py-2 border border-red-900/50"
              role="alert"
            >
              {error}
            </p>
          )}

          <div className="space-y-5">
            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium text-slate-300 mb-2"
              >
                ユーザー名 / メールアドレス
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ユーザー名 または メールアドレス"
                className="w-full px-4 py-3 min-h-[44px] text-base rounded-lg bg-slate-950/80 border border-slate-600/90 focus:outline-none focus:ring-2 focus:ring-offset-0 focus:ring-indigo-500/60 focus:border-indigo-500 text-white placeholder-slate-500 transition-shadow"
                autoComplete="username"
                disabled={loading}
              />
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                @ が無い場合のみ、内部ドメインが付与されます
              </p>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-slate-300 mb-2"
              >
                パスワード
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 pr-12 min-h-[44px] text-base rounded-lg bg-slate-950/80 border border-slate-600/90 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 focus:border-indigo-500 text-white placeholder-slate-500 transition-shadow"
                  autoComplete="current-password"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50 rounded-md"
                  disabled={loading}
                  aria-label={showPassword ? "パスワードを隠す" : "パスワードを表示"}
                >
                  {showPassword ? (
                    <EyeOff size={18} strokeWidth={1.5} />
                  ) : (
                    <Eye size={18} strokeWidth={1.5} />
                  )}
                </button>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-8 py-3 min-h-[48px] rounded-lg font-medium text-white bg-indigo-600 hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation text-[15px]"
          >
            {loading ? "ログイン中..." : "ログイン"}
          </button>
        </form>

        <p className="text-center text-[11px] text-slate-600 mt-6 px-2">
          © Raku-Raku
        </p>
      </div>
    </div>
  );
}
