"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase-client";

const GOLD = "#D4AF37";

/** ユーザー名に内部ドメインを付加（前後の空白を自動削除） */
function toInternalEmail(username: string): string {
  const trimmed = String(username ?? "").trim().toLowerCase();
  if (!trimmed) return "";
  return `${trimmed}@raku-kyaba.internal`;
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
    setLoading(true); // 連打防止

    // ユーザー名・パスワードの両方に .trim() を適用（目に見えない空白を削除）
    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();

    const email = toInternalEmail(trimmedUsername);
    if (!email) {
      setError("ユーザー名を入力してください。");
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
    <div className="min-h-screen bg-black flex items-center justify-center overflow-hidden relative">
      {/* ゴールドの光の粒子（背景アニメーション） */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {[...Array(12)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-[#D4AF37] opacity-20 animate-gold-float"
            style={{
              width: `${4 + (i % 4) * 3}px`,
              height: `${4 + (i % 4) * 3}px`,
              left: `${(i * 7) % 100}%`,
              top: `${(i * 11) % 100}%`,
              animationDelay: `${i * 0.7}s`,
              animationDuration: `${8 + (i % 4)}s`,
            }}
          />
        ))}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `radial-gradient(circle at 50% 50%, ${GOLD} 1px, transparent 1px)`,
            backgroundSize: "40px 40px",
          }}
        />
      </div>

      {/* ログインフォーム */}
      <div className="relative z-10 w-full max-w-sm mx-4">
        <form
          onSubmit={handleSubmit}
          className="border-2 border-[#D4AF37] rounded-lg p-8 bg-black/90 backdrop-blur-sm shadow-[0_0_30px_rgba(212,175,55,0.15)]"
          style={{ borderColor: GOLD }}
        >
          <h1
            className="text-2xl font-light tracking-[0.2em] text-center mb-8 text-[#D4AF37]"
            style={{
              fontFamily: "'Cinzel', 'Georgia', serif",
            }}
          >
            Club GOLD Staff Portal
          </h1>

          {error && (
            <p className="text-red-400 text-sm text-center mb-4 px-2" role="alert">
              {error}
            </p>
          )}

          <div className="space-y-5">
            <div>
              <label
                htmlFor="username"
                className="block text-sm text-[#D4AF37]/90 mb-2 font-light tracking-wider"
              >
                ユーザー名
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="gold"
                className="w-full px-4 py-3 bg-black/80 border border-[#D4AF37]/50 rounded focus:outline-none focus:border-[#D4AF37] focus:ring-1 focus:ring-[#D4AF37]/50 text-white placeholder-gray-500 transition-colors"
                autoComplete="username"
                disabled={loading}
              />
              <p className="text-xs text-[#D4AF37]/50 mt-1">
                ※ @raku-kyaba.internal は自動付加されます
              </p>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm text-[#D4AF37]/90 mb-2 font-light tracking-wider"
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
                  className="w-full px-4 py-3 pr-12 bg-black/80 border border-[#D4AF37]/50 rounded focus:outline-none focus:border-[#D4AF37] focus:ring-1 focus:ring-[#D4AF37]/50 text-white placeholder-gray-500 transition-colors"
                  autoComplete="current-password"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[#D4AF37]/70 hover:text-[#D4AF37] transition-colors disabled:opacity-50"
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
            className="w-full mt-6 py-3 rounded border-2 border-[#D4AF37] text-[#D4AF37] font-light tracking-widest hover:bg-[#D4AF37]/10 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          >
            {loading ? "ログイン中..." : "ログイン"}
          </button>
        </form>
      </div>

    </div>
  );
}
