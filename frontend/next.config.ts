import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // App autenticado e renderizado no cliente: sem cache de componentes no servidor.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
