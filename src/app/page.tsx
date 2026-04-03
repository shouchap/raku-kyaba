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
      {/* 上半分：広告（イラスト）— メッセージが隠れないよう重ねず、領域内に収める */}
      <section
        aria-label="キャンペーンビジュアル"
        className="flex h-[65vh] min-h-[60vh] max-h-[70vh] w-full shrink-0 flex-col items-center justify-center px-4 pt-6 sm:px-6 sm:pt-8"
      >
        <div className="relative h-full w-full max-w-4xl min-h-0">
          <Image
            src="/タイトル.png"
            alt="もう無能な部下 怒らなくて良いんです"
            fill
            className="object-contain object-top"
            priority
            sizes="(max-width: 896px) 100vw, 896px"
          />
        </div>
      </section>

      {/* 下半分：ログイン + フッター */}
      <section className="flex flex-1 flex-col items-center px-4 pb-10 sm:px-6">
        <div className="mt-10 w-full max-w-md sm:mt-12 lg:mt-16">
          <form
            onSubmit={handleSubmit}
            className="w-full rounded-xl border border-gray-100 bg-white p-6 shadow-md sm:p-7"
          >
            <h1 className="mb-5 text-center text-base font-semibold tracking-[0.06em] text-slate-900 sm:text-lg">
              RAKU-RAKU STAFF PORTAL
            </h1>

            {error && (
              <p className="mb-4 px-1 text-center text-sm text-red-600" role="alert">
                {error}
              </p>
            )}

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="username"
                  className="mb-2 block text-sm font-medium text-slate-700"
                >
                  ユーザー名 / メールアドレス
                </label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="gold または example@gmail.com"
                  className="min-h-[44px] w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-base text-slate-900 placeholder:text-gray-400 transition-colors focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400/35"
                  autoComplete="username"
                  disabled={loading}
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  ※ @ が無い場合のみ @raku-kyaba.internal が付きます
                </p>
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="mb-2 block text-sm font-medium text-slate-700"
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
                    className="min-h-[44px] w-full rounded-lg border border-gray-200 bg-white px-4 py-3 pr-12 text-base text-slate-900 placeholder:text-gray-400 transition-colors focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400/35"
                    autoComplete="current-password"
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((p) => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-500 transition-colors hover:text-slate-800 disabled:opacity-50"
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
              className="mt-6 min-h-[48px] w-full rounded-lg bg-slate-900 py-3 text-sm font-medium tracking-wide text-white transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 touch-manipulation"
            >
              {loading ? "ログイン中..." : "ログイン"}
            </button>
          </form>

          <footer className="mt-10 text-center text-[11px] leading-relaxed text-slate-400 sm:text-xs">
            <p>楽キャバ ＆ HABATAKI</p>
            <p className="mt-1">© 2026 Raku-Kyaba Inc. All Rights Reserved.</p>
          </footer>
        </div>
      </section>
    </div>
  );
}
