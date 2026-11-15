import type { NextConfig } from "next";

const basePath = process.env["NEXT_BASE_PATH"] ?? "";

const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default config;
