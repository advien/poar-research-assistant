import type { NextConfig } from "next";

const config: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "30mb",
    },
  },
  serverExternalPackages: ["unpdf", "pdfjs-dist"],
};

export default config;
