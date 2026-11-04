import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // DB ドライバはバンドルせずに Node から読む
  serverExternalPackages: ["postgres"],
  // 顧客レポートは検索エンジンに載せない
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Referrer-Policy", value: "no-referrer" }] }];
  },
};

export default nextConfig;
