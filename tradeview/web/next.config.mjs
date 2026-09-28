// Next.js config (§14). The production/dev server is server/src/index.js, which mounts Next on the same origin as
// /api and /ws. For frontend-only development against a separately running backend, set TRADEVIEW_API_PROXY
// (e.g. TRADEVIEW_API_PROXY=http://127.0.0.1:8787 npx next dev) and /api + /ws are rewritten to it.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(here, '..');
const apiProxy = process.env.TRADEVIEW_API_PROXY ? process.env.TRADEVIEW_API_PROXY.replace(/\/+$/, '') : '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Imperative charts/editors must not be mounted twice in development.
  reactStrictMode: false,
  poweredByHeader: false,
  // Do not generate AGENTS.md / CLAUDE.md into the project on `next dev`.
  agentRules: false,
  // npm workspaces: dependencies are hoisted to the repository root.
  outputFileTracingRoot: workspaceRoot,
  turbopack: { root: workspaceRoot },
  transpilePackages: ['monaco-editor'],
  async rewrites() {
    if (!apiProxy) return [];
    return [
      { source: '/api/:path*', destination: `${apiProxy}/api/:path*` },
      { source: '/ws', destination: `${apiProxy}/ws` },
    ];
  },
  async headers() {
    return [
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Service-Worker-Allowed', value: '/' }] },
      { source: '/manifest.webmanifest', headers: [{ key: 'Content-Type', value: 'application/manifest+json' }] },
    ];
  },
};

export default nextConfig;
