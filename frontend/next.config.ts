import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Clientes e emissoras viraram "Cadastros" (compartilhados por todos os robôs); links antigos continuam valendo.
  async redirects() {
    return [
      { source: "/nfse/clientes", destination: "/cadastros/clientes", permanent: true },
      { source: "/nfse/emissoras", destination: "/cadastros/emissoras", permanent: true },
      { source: "/cadastros", destination: "/cadastros/clientes", permanent: false },
    ];
  },
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
