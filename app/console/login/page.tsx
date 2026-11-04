import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "../../../components/client-ui.tsx";
import { currentStaff, supabaseConfigured } from "../../../src/web/auth.ts";
import { signInAction } from "../actions.ts";

export const metadata = { title: "ログイン" };

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await currentStaff()) redirect("/console");
  const { error } = await searchParams;
  return (
    <main className="login">
      <span className="o-tag">
        <em>◉</em> ORBIT / CONSOLE
      </span>
      <h1>ログイン</h1>
      <p className="muted small">登録された社内メンバーのメールアドレスに、ログイン用のリンクを送ります。</p>
      {error && <p className="notice bad">リンクの有効期限が切れたか、登録されていないアドレスです。もう一度お試しください。</p>}
      {!supabaseConfigured() && <p className="notice bad">ログインの設定（Supabase の URL とキー）がまだ登録されていません。</p>}
      <ActionForm action={signInAction} className="c-section">
        <label className="field">
          <span>メールアドレス</span>
          <input type="email" name="email" id="email" autoComplete="email" required />
        </label>
        <div className="actions">
          <SubmitButton>リンクを送る</SubmitButton>
        </div>
      </ActionForm>
    </main>
  );
}
