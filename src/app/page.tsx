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
      <main className="flex flex-1 flex-col px-3 pb-6 pt-5 sm:px-6 sm:pt-7">
        <div className="relative mx-auto w-full max-w-[1024px]">
          <Image
            src="/タイトル.png"
            alt="もう無能な部下 怒らなくて良いんです"
            width={1024}
            height={575}
            className="h-auto w-full select-none"
            priority
            unoptimized
            sizes="(max-width: 1024px) 100vw, 1024px"
          />

          <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 w-[min(100%-1rem,36rem)] -translate-x-1/2 -translate-y-1/2 px-2 sm:w-full sm:max-w-xl sm:px-0">
            <form
              onSubmit={handleSubmit}
              className="pointer-events-auto w-full rounded-2xl border border-gray-100/90 bg-white/92 p-3 shadow-xl backdrop-blur-[3px] sm:p-4"
            >
              <h1 className="mb-2 text-center text-[11px] font-semibold tracking-[0.08em] text-slate-900 sm:mb-3 sm:text-xs">
                RAKU-RAKU STAFF PORTAL
              </h1>

              {error && (
                <p className="mb-2 px-0.5 text-center text-[10px] leading-snug text-red-600 sm:text-xs" role="alert">
                  {error}
                </p>
              )}

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-x-4 sm:gap-y-2">
                <div className="min-w-0">
                  <label
                    htmlFor="username"
                    className="mb-1 block text-[10px] font-medium text-slate-700 sm:text-[11px]"
                  >
                    ユーザー名 / メールアドレス
                  </label>
                  <input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="gold または example@gmail.com"
                    className="min-h-[38px] w-full rounded-md border border-gray-200 bg-white px-2.5 py-2 text-xs text-slate-900 placeholder:text-gray-400 transition-colors focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
                    autoComplete="username"
                    disabled={loading}
                  />
                </div>

                <div className="min-w-0">
                  <label
                    htmlFor="password"
                    className="mb-1 block text-[10px] font-medium text-slate-700 sm:text-[11px]"
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
                      className="min-h-[38px] w-full rounded-md border border-gray-200 bg-white px-2.5 py-2 pr-10 text-xs text-slate-900 placeholder:text-gray-400 transition-colors focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
                      autoComplete="current-password"
                      disabled={loading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((p) => !p)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-500 transition-colors hover:text-slate-800 disabled:opacity-50"
                      disabled={loading}
                      aria-label={showPassword ? "パスワードを隠す" : "パスワードを表示"}
                    >
                      {showPassword ? (
                        <EyeOff size={15} strokeWidth={1.5} />
                      ) : (
                        <Eye size={15} strokeWidth={1.5} />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-3 min-h-[38px] w-full rounded-md bg-slate-900 py-2 text-xs font-medium tracking-wide text-white transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 touch-manipulation sm:mt-4"
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
