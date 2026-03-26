import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { getStoreAdminStoreIdFromUser } from "@/lib/roles";
import { isSuperAdminUser } from "@/lib/super-admin";

/** 管理API用: Cookie 経由でログインユーザーを取得 */
export async function getAuthedUserForAdminApi(): Promise<{
  user: User | null;
  error: "config" | null;
}> {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { user: null, error: "config" };
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // ignore
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { user, error: null };
}

export function canUserEditStore(user: User, storeId: string): boolean {
  if (isSuperAdminUser(user)) return true;
  const sid = getStoreAdminStoreIdFromUser(user);
  return sid === storeId;
}
