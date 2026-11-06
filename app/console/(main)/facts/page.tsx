import { ActionForm, SubmitButton } from "../../../../components/client-ui.tsx";
import { DONE_MESSAGES, jpDateTime, ymdSlash } from "../../../../components/format.ts";
import { getRepo } from "../../../../src/web/index.ts";
import { addFactAction, createRequestAction, reviewSubmissionAction } from "../../actions.ts";

export const metadata = { title: "正解データ" };

const REQ_STATUS: Record<string, string> = { open: "記入待ち", submitted: "記入済み・確認待ち", answered: "反映済み", unknown: "顧客も不明", cancelled: "取り消し" };

export default async function Facts({ searchParams }: { searchParams: Promise<{ client?: string; done?: string }> }) {
  const repo = getRepo();
  const clients = await repo.listClients();
  const { client, done } = await searchParams;
  const current = clients.find((c) => c.id === client) ?? [...clients].sort((a, b) => b.pendingSubmissions - a.pendingSubmissions)[0];
  const o = current ? await repo.factsOverview(current.id) : null;
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const pending = o?.submissions.filter((s) => s.status === "pending") ?? [];
  return (
    <>
      <div className="c-title">
        <h1>正解データ</h1>
        <nav className="tabs-inline" aria-label="顧客">
          {clients.map((c) => (
            <a key={c.id} href={`/console/facts?client=${c.id}`} aria-current={c.id === current?.id ? "page" : undefined}>
              {c.name}
              {c.pendingSubmissions > 0 && <span className="todo mono"> {c.pendingSubmissions}</span>}
            </a>
          ))}
        </nav>
      </div>
      {done && DONE_MESSAGES[done] && (
        <p className="notice ok" role="status">
          {DONE_MESSAGES[done]}
        </p>
      )}
      {!o ? (
        <p className="muted">顧客が登録されていません。</p>
      ) : (
        <>
          <section className="c-section" data-accent="yellow">
            <header>
              <h2>顧客からの記入（確認待ち {pending.length}件）</h2>
            </header>
            {pending.length === 0 ? (
              <p className="muted">確認待ちはありません。</p>
            ) : (
              pending.map((s) => (
                <article key={s.id} className="review">
                  <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
                    <span className="who">
                      {s.entityName} ・ {s.factLabel} ・ 記入 <span className="mono">{jpDateTime(s.submittedAt)}</span>
                    </span>
                    <p className="said">{s.input.value.split("|").join("・")}</p>
                    <dl className="kv">
                      <dt>いつから</dt>
                      <dd className="mono">{s.input.validFrom ? ymdSlash(s.input.validFrom) : "—"}</dd>
                      <dt>公表日</dt>
                      <dd className="mono">{s.input.publicFrom ? ymdSlash(s.input.publicFrom) : "公表済み"}</dd>
                      <dt>確認URL</dt>
                      <dd className="mono">{s.input.sourceUrl ? <a href={s.input.sourceUrl} target="_blank" rel="noreferrer">{s.input.sourceUrl}</a> : "なし（顧客の申告として記録）"}</dd>
                      <dt>補足</dt>
                      <dd>{s.input.note || "—"}</dd>
                    </dl>
                  </div>
                  <ActionForm action={reviewSubmissionAction.bind(null, o.clientId, s.id)}>
                    <div className="choices">
                      <SubmitButton name="intent" value="approve">承認</SubmitButton>
                      <SubmitButton name="intent" value="approve-close" primary={false}>古い値を終了して承認</SubmitButton>
                    </div>
                    <label className="field">
                      <span>差し戻す理由（顧客に表示）</span>
                      <input type="text" name="note" id={`reject-${s.id}`} />
                    </label>
                    <SubmitButton name="intent" value="reject" primary={false}>差し戻す</SubmitButton>
                  </ActionForm>
                </article>
              ))
            )}
          </section>

          <section className="c-section" data-accent="yellow">
            <header>
              <h2>登録済みの正解データ</h2>
              <span className="small muted">取り消し線は過去の値（「古い」判定に使います）</span>
            </header>
            <div className="table-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th>項目</th>
                    <th>値</th>
                    <th>有効期間</th>
                    <th>出典</th>
                    <th>確認日</th>
                  </tr>
                </thead>
                <tbody>
                  {o.facts.map((f, i) => {
                    const old = f.validTo !== null || !f.current;
                    return (
                      <tr key={`${f.entityId}-${f.key}-${f.validFrom}-${i}`} style={old ? { color: "var(--ink-3)" } : undefined}>
                        <td className="nowrap">{f.factLabel}</td>
                        <td style={old ? { textDecoration: "line-through" } : undefined}>{f.display}</td>
                        <td className="mono nowrap small">
                          {f.validFrom ? ymdSlash(f.validFrom) : "—"} 〜 {f.validTo ? ymdSlash(f.validTo) : "現在"}
                          {f.publicFrom && <span className="flag old" style={{ marginLeft: 6 }}>公表 {ymdSlash(f.publicFrom)}</span>}
                        </td>
                        <td className="small">
                          {f.sourceType === "client_provided" ? (
                            <span className="flag plain">顧客の申告</span>
                          ) : (
                            <a className="mono" href={f.sourceUrl ?? "#"} target="_blank" rel="noreferrer">
                              {f.sourceUrl ? new URL(f.sourceUrl).hostname : "—"}
                            </a>
                          )}
                        </td>
                        <td className="mono small nowrap">{ymdSlash(f.checkedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <div className="two-col" style={{ gap: 36 }}>
            <section className="c-section" data-accent="yellow">
              <header>
                <h2>1件登録する（社内）</h2>
              </header>
              <ActionForm action={addFactAction} className="form-grid">
                <label className="field wide">
                  <span>項目</span>
                  <select name="target" id="fact-target" required defaultValue="">
                    <option value="" disabled>選んでください</option>
                    {o.targets.map((t) =>
                      o.factKeys.filter((k) => k.industry === t.industry).map((k) => (
                        <option key={`${t.id}::${k.key}`} value={`${t.id}::${k.key}`}>
                          {t.name} ・ {k.label}
                        </option>
                      )),
                    )}
                  </select>
                </label>
                <label className="field wide">
                  <span>値</span>
                  <input type="text" name="value" id="fact-value" required />
                  <small>一覧は「A|B|C」、日付は 2026-10-15、リリースは「作品名|2026-10-15」</small>
                </label>
                <label className="field">
                  <span>いつから</span>
                  <input type="date" name="validFrom" id="fact-from" />
                </label>
                <label className="field">
                  <span>いつまで（過去の値のみ）</span>
                  <input type="date" name="validTo" id="fact-to" />
                </label>
                <label className="field wide">
                  <span>出典URL</span>
                  <input type="url" name="sourceUrl" id="fact-url" required placeholder="https://" />
                </label>
                <label className="field">
                  <span>確認日</span>
                  <input type="date" name="checkedAt" id="fact-checked" required defaultValue={today} />
                </label>
                <label className="field">
                  <span>公表日（未発表の場合）</span>
                  <input type="date" name="publicFrom" id="fact-public" />
                </label>
                <div className="actions wide">
                  <SubmitButton>登録する</SubmitButton>
                  <span className="small faint">まとめて登録する場合は CSV（npm run facts:import）</span>
                </div>
              </ActionForm>
            </section>

            <section className="c-section" data-accent="yellow">
              <header>
                <h2>顧客に記入を依頼する</h2>
              </header>
              <ActionForm action={createRequestAction.bind(null, o.clientId)} className="form-grid">
                <label className="field wide">
                  <span>項目</span>
                  <select name="target" id="req-target" required defaultValue="">
                    <option value="" disabled>選んでください</option>
                    {o.targets.map((t) =>
                      o.factKeys.filter((k) => k.industry === t.industry).map((k) => (
                        <option key={`${t.id}::${k.key}`} value={`${t.id}::${k.key}`}>
                          {t.name} ・ {k.label}
                        </option>
                      )),
                    )}
                  </select>
                </label>
                <label className="field wide">
                  <span>依頼の理由（顧客に表示）</span>
                  <textarea name="reason" id="req-reason" required placeholder="例: 公式サイトとSNSで人数が食い違っています" />
                </label>
                <div className="actions wide">
                  <SubmitButton>依頼する</SubmitButton>
                </div>
              </ActionForm>
              <div className="table-wrap">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>項目</th>
                      <th>状態</th>
                      <th>依頼</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.requests.map((r) => (
                      <tr key={r.id}>
                        <td>{r.factLabel}</td>
                        <td className={r.status === "submitted" ? "todo" : undefined}>{REQ_STATUS[r.status]}</td>
                        <td className="small faint">
                          {r.requestedByName} ・ <span className="mono">{jpDateTime(r.requestedAt)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      )}
    </>
  );
}
