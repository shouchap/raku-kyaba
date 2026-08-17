/**
 * 管理画面レイアウトが毎ナビゲーションで実行していた stores 参照の短期キャッシュ。
 *
 * レイアウトは `force-dynamic` のため、ページを開くたびに service-role で
 * 店舗一覧・業態・用語・メニュー設定を取得していた。表示のたびに数百 ms かかるが
 * これらはほぼ変化しないため、プロセス内に短時間だけ保持する。
 */

const TTL_MS = 30_000;

type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

export async function getCachedAdminShellValue<T>(
  key: string,
  load: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.value as T;
  }

  const value = await load();
  store.set(key, { value, expiresAt: now + TTL_MS });
  return value;
}

/** 設定変更後に即時反映させたいときに呼ぶ */
export function clearAdminShellCache(): void {
  store.clear();
}
