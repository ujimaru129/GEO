import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "../../../../src/web/auth.ts";
import { getRepo } from "../../../../src/web/index.ts";

/** メールのリンクから戻ってきたときにセッションを確立し、許可リストを確認する */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const fail = NextResponse.redirect(new URL("/console/login?error=1", request.url));
  if (!code) return fail;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  const email = data.user?.email;
  if (error || !email || !(await getRepo().staffByEmail(email))) {
    await supabase.auth.signOut();
    return fail;
  }
  return NextResponse.redirect(new URL("/console", request.url));
}
