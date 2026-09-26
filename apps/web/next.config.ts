import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El botón flotante "N" de dev tools de Next.js queda encima del board
  // en cualquier screenshot/demo — apagado a propósito, no es parte de la UI.
  devIndicators: false,
};

export default nextConfig;
