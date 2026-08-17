"use client";

type Props = {
  /** 表示する行数。表系の画面は多めにするとガタつきが減る */
  rows?: number;
  label?: string;
};

/**
 * 「読み込み中...」の一行テキストだと、描画後にレイアウトが大きく動いて見づらいので、
 * 実際の画面に近い骨組みを出しておく。
 */
export function PageLoading({ rows = 6, label = "読み込み中" }: Props) {
  return (
    <div className="p-4 sm:p-6" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="mb-5 h-7 w-48 animate-pulse rounded-md bg-slate-200/80" />
      <div className="mb-4 h-12 w-full max-w-sm animate-pulse rounded-lg bg-slate-200/70" />
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="h-11 w-full animate-pulse bg-slate-100" />
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-t border-slate-100 px-4 py-3"
          >
            <div className="h-4 w-28 animate-pulse rounded bg-slate-200/80" />
            <div className="h-4 flex-1 animate-pulse rounded bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
