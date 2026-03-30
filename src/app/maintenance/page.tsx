import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "メンテナンス中 | 楽キャバ",
  robots: { index: false, follow: false },
};

export default function MaintenancePage() {
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-gradient-to-b from-slate-50 via-white to-slate-100 px-6 py-16">
      <div className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white/90 shadow-xl shadow-slate-200/50 backdrop-blur-sm px-8 py-12 text-center">
        <div
          className="mx-auto mb-8 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-900 text-3xl shadow-inner"
          aria-hidden
        >
          🔧
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
          システムメンテナンス中です
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-slate-600">
          現在、サービスを一時的に停止しております。
          <br />
          終了までしばらくお待ちください。
        </p>
        <div className="mt-10 h-px w-full bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
        <p className="mt-6 text-xs text-slate-400">
          ご不便をおかけして申し訳ございません。
        </p>
      </div>
    </div>
  );
}
