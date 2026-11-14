import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * firebase-admin and nodemailer must stay outside the client/server bundle
   * graph: they pull in Node built-ins, and both read server-side credentials
   * at runtime.
   */
  serverExternalPackages: ["firebase-admin", "nodemailer"],
  /**
   * cacheComponents is disabled to allow route segment config (runtime, dynamic)
   * on API routes. These are required for Node.js server-side Kite Connect integration.
   *
   * turbopack is used for Tailwind CSS v4 in development.
   */
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
