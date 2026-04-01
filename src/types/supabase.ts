/**
 * Supabase / ドメイン型の再エクスポート（`import … from "@/types/supabase"` 用）
 * スキーマのソースオブトゥルースは database.ts / entities.ts
 */
export type { Database, Json } from "./database";
export type { StoreBusinessType, Store, Cast, CastEmploymentType } from "./entities";
