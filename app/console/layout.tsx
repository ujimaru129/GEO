/** 運営コンソール全体（ログイン画面を含む）を ORBIT の盤面で包む */
export default function ConsoleRoot({ children }: { children: React.ReactNode }) {
  return <div className="orbit orbit-console">{children}</div>;
}
