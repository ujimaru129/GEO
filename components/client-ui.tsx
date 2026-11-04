"use client";

import { usePathname } from "next/navigation";
import { useActionState, useState } from "react";
import type { ActionResult } from "../src/web/repo.ts";

export function CopyButton({ text, label = "文面をコピー" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn quiet"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? "コピーしました" : label}
    </button>
  );
}

/** 現在のパスに一致するリンクに aria-current を付ける */
export function NavLink({ href, children, exact = false }: { href: string; children: React.ReactNode; exact?: boolean }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(`${href}/`);
  return (
    <a href={href} aria-current={active ? "page" : undefined}>
      {children}
    </a>
  );
}

type FormAction = (prev: ActionResult | null, data: FormData) => Promise<ActionResult>;

/** Server Action を呼び、結果（成功メッセージ・エラー）をフォームの下に表示する */
export function ActionForm({ action, children, className }: { action: FormAction; children: React.ReactNode; className?: string }) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run} className={className} aria-busy={pending}>
      {children}
      {state && !state.ok && (
        <div className="notice bad" role="alert">
          {state.errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}
      {state?.ok && state.message && (
        <div className="notice ok" role="status">
          {state.message}
        </div>
      )}
    </form>
  );
}

export function SubmitButton({ children, primary = true, name, value }: { children: React.ReactNode; primary?: boolean; name?: string; value?: string }) {
  return (
    <button type="submit" className={`btn${primary ? " primary" : ""}`} name={name} value={value}>
      {children}
    </button>
  );
}

/** 専用URLの発行。発行直後だけURLを表示する */
export function IssueLinkForm({ action, active }: { action: FormAction; active: boolean }) {
  const [state, run, pending] = useActionState(action, null);
  const url = state?.ok && state.message ? `${typeof window === "undefined" ? "" : window.location.origin}${state.message}` : null;
  return (
    <form action={run} className="c-section" aria-busy={pending}>
      {url ? (
        <div style={{ display: "grid", gap: 8 }}>
          <span className="small">新しいURLを発行しました。この画面を閉じると再表示できません。顧客にお送りください。</span>
          <div className="token-box">{url}</div>
          <div className="actions">
            <CopyButton text={url} label="URLをコピー" />
            <a className="btn quiet" href={state!.ok ? state!.message! : "#"} target="_blank" rel="noreferrer">
              開いて確認
            </a>
          </div>
        </div>
      ) : (
        <div className="actions">
          <button type="submit" className={`btn${active ? "" : " primary"}`} disabled={pending}>
            {active ? "再発行する（古いURLは無効になります）" : "発行する"}
          </button>
        </div>
      )}
      {state && !state.ok && <p className="notice bad">{state.errors.join(" / ")}</p>}
    </form>
  );
}
