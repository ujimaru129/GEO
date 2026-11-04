// 社内メンバーの認証。Supabase のメールログイン（マジックリンク）＋ staff_members の許可リスト。
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getRepo, isDemo } from "./index.ts";
import type { Staff } from "./repo.ts";
import { DEMO_STAFF_EMAIL } from "./repo-demo.ts";

export function supabaseConfigured() {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** デモモードで社内画面を開いてよいか（本番ビルドでは ALLOW_DEMO=1 のときだけ） */
export function demoConsoleAllowed() {
  return isDemo() && (process.env.NODE_ENV !== "production" || process.env.ALLOW_DEMO === "1");
}

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server Component からは cookie を書けない。更新は proxy.ts が行う
        }
      },
    },
  });
}

/** ログイン中の社内メンバー。いなければ null */
export async function currentStaff(): Promise<Staff | null> {
  if (demoConsoleAllowed()) return getRepo().staffByEmail(DEMO_STAFF_EMAIL);
  if (isDemo() || !supabaseConfigured()) return null;
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email;
  if (!email) return null;
  return getRepo().staffByEmail(email);
}

/** Server Action の先頭で必ず呼ぶ（画面を経由しない POST も防ぐ） */
export async function requireStaff(): Promise<Staff> {
  const s = await currentStaff();
  if (!s) throw new Error("社内メンバーとしてログインしてください");
  return s;
}
