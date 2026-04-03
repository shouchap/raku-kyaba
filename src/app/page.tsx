"use client";

import Image from "next/image";
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
    <div className="flex min-h-screen flex-col bg-[#FFFFFF]">
      <main className="flex flex-1 flex-col px-4 pt-6 pb-6 sm:px-6 sm:pt-8">
        {/* イラスト全体を表示し、文字と絵の間の余白にフォームを重ねる */}
        <div className="relative mx-auto w-full max-w-4xl">
          <Image
            src="/タイトル.png"
            alt="もう無能な部下 怒らなくて良いんです"
            width={1200}
            height={900}
            className="h-auto w-full select-none"
            priority
            sizes="(max-width: 896px) 100vw, 896px"
          />

          <div className="pointer-events-none absolute left-1/2 top-[40%] z-10 w-[min(100%,20rem)] -translate-x-1/2 -translate-y-1/2 px-2 sm:w-full sm:max-w-sm sm:px-0">
            <form
              onSubmit={handleSubmit}
              className="pointer-events-auto w-full rounded-xl border border-gray-100 bg-white/95 p-4 shadow-md backdrop-blur-[2px] sm:p-5"
            >
              <h1 className="mb-3 text-center text-sm font-semibold tracking-[0.06em] text-slate-900 sm:mb-4 sm:text-base">
                RAKU-RAKU STAFF PORTAL
              </h1>

              {error && (
                <p className="mb-3 px-0.5 text-center text-xs text-red-600 sm:text-sm" role="alert">
                  {error}
                </p>
              )}

              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="username"
                    className="mb-1.5 block text-xs font-medium text-slate-700 sm:text-sm"
                  >
                    ユーザー名 / メールアドレス
                  </label>
                  <input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="gold または example@gmail.com"
                    className="min-h-[42px] w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-gray-400 transition-colors focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400/35 sm:min-h-[44px] sm:px-4 sm:py-3 sm:text-base"
                    autoComplete="username"
                    disabled={loading}
                  />
                  <p className="mt-1 text-[10px] leading-snug text-slate-500 sm:text-xs">
                    ※ @ が無い場合のみ @raku-kyaba.internal が付きます
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="password"
                    className="mb-1.5 block text-xs font-medium text-slate-700 sm:text-sm"
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
                      className="min-h-[42px] w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 pr-11 text-sm text-slate-900 placeholder:text-gray-400 transition-colors focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400/35 sm:min-h-[44px] sm:px-4 sm:py-3 sm:pr-12 sm:text-base"
                      autoComplete="current-password"
                      disabled={loading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((p) => !p)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-500 transition-colors hover:text-slate-800 disabled:opacity-50 sm:right-3"
                      disabled={loading}
                      aria-label={showPassword ? "パスワードを隠す" : "パスワードを表示"}
                    >
                      {showPassword ? (
                        <EyeOff size={17} strokeWidth={1.5} className="sm:h-[18px] sm:w-[18px]" />
                      ) : (
                        <Eye size={17} strokeWidth={1.5} className="sm:h-[18px] sm:w-[18px]" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-4 min-h-[44px] w-full rounded-lg bg-slate-900 py-2.5 text-sm font-medium tracking-wide text-white transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 touch-manipulation sm:mt-5 sm:min-h-[48px] sm:py-3"
              >
                {loading ? "ログイン中..." : "ログイン"}
              </button>
            </form>
          </div>
        </div>
      </main>

      <footer className="mt-auto px-4 pb-8 text-center text-[11px] leading-relaxed text-slate-400 sm:px-6 sm:text-xs">
        <p>楽キャバ ＆ HABATAKI</p>
        <p className="mt-1">© 2026 Raku-Kyaba Inc. All Rights Reserved.</p>
      </footer>
    </div>
  );
}
