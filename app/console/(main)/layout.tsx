import { redirect } from "next/navigation";
import { connection } from "next/server";
import { NavLink } from "../../../components/client-ui.tsx";
import { currentStaff } from "../../../src/web/auth.ts";
import { getRepo, isDemo } from "../../../src/web/index.ts";
import { signOutAction } from "../actions.ts";

export const metadata = { title: { default: "運営コンソール", template: "%s ｜ 運営コンソール" } };

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  // 社内画面は常にリクエストごとに描画する（ログイン状態と最新データ）
  await connection();
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  const repo = getRepo();
  const [reviews, drafts, clients] = await Promise.all([repo.pendingReviews(), repo.adviceDrafts(), repo.listClients()]);
  const pendingSubs = clients.reduce((s, c) => s + c.pendingSubmissions, 0);
  return (
    <>
      {isDemo() && <div className="demo-band">デモモード: 架空のデータです。操作はサーバーを再起動すると元に戻ります。</div>}
      <div className="console">
        <aside className="c-side">
          <div className="c-brand">
            <b>エンタメGEO</b>
            <span>運営コンソール</span>
          </div>
          <nav className="c-nav" aria-label="運営メニュー">
            <NavLink href="/console" exact>顧客一覧</NavLink>
            <NavLink href="/console/reviews">
              判定の確認{reviews.length + drafts.length > 0 && <span className="n">{reviews.length + drafts.length}</span>}
            </NavLink>
            <NavLink href="/console/facts">
              正解データ{pendingSubs > 0 && <span className="n">{pendingSubs}</span>}
            </NavLink>
            <NavLink href="/console/runs">計測とコスト</NavLink>
          </nav>
          <div className="c-user">
            <span>
              <b>{staff.name}</b>（{staff.role === "admin" ? "管理者" : "メンバー"}）
            </span>
            {!isDemo() && (
              <form action={signOutAction}>
                <button type="submit" className="btn quiet">ログアウト</button>
              </form>
            )}
          </div>
        </aside>
        <main className="c-main">{children}</main>
      </div>
    </>
  );
}
