import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  /**
   * geo-tz ships geobuf data loaded via fs at runtime. Bundling it into the
   * server graph yields empty timezone arrays → error.geocode_timezone_unavailable.
   * Keep it external so Node resolves the package data files correctly.
   */
  serverExternalPackages: ["geo-tz"],
};

export default withNextIntl(nextConfig);
