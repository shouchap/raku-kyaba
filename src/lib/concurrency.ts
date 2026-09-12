/**
 * 同時実行数を制限しつつ Promise.allSettled 相当の結果を返す。
 * 1件の失敗は他件の実行を止めない。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const n = items.length;
  if (n === 0) return [];

  const limit = Math.max(1, Math.min(Math.floor(concurrency) || 1, n));
  const results: PromiseSettledResult<R>[] = new Array(n);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= n) return;
      try {
        const value = await mapper(items[i] as T, i);
        results[i] = { status: "fulfilled", value };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}
