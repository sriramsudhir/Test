// Vite config for the chart-core demo page: `npx vite web/test` (from repo root) or `npx vite test` (from web/).
// Redirects every import of src/api/client.js to the in-memory mock so the demo runs without a server.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const mock = path.join(here, 'mock-client.js');

export default {
  root: here,
  plugins: [
    {
      name: 'tradeview-mock-api-client',
      enforce: 'pre',
      resolveId(source, importer) {
        if (/(^|\/)api\/client\.js$/.test(source) && importer && !importer.startsWith(here)) return mock;
        return null;
      },
    },
  ],
  server: { port: 5199, strictPort: true, fs: { allow: [path.resolve(here, '../..')] } },
  logLevel: 'info',
};
