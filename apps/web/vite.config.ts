import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { logoDataUri } from '../../packages/shared/src/brand';
import { colors } from '../../packages/shared/src/tokens';

/** Inject token based values (theme color, favicon) into index.html. */
function designTokens(): Plugin {
  return {
    name: 'shifubot-design-tokens',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) =>
        html.replaceAll('%SHIFU_THEME_COLOR%', colors.background).replaceAll('%SHIFU_FAVICON%', logoDataUri()),
    },
  };
}

/**
 * Dev only: forward API and auth requests to the Bun server with fetch.
 * (Vite's built in http-proxy does not work reliably on the Bun runtime.)
 */
function devApiProxy(target: string, prefixes: string[]): Plugin {
  return {
    name: 'shifubot-dev-api-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '/';
        if (!prefixes.some((prefix) => url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`))) {
          return next();
        }
        try {
          const chunks: Buffer[] = [];
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            await new Promise<void>((resolve, reject) => {
              req.on('data', (chunk: Buffer) => chunks.push(chunk));
              req.on('end', resolve);
              req.on('error', reject);
            });
          }
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (value === undefined || key === 'host' || key === 'connection') continue;
            headers.set(key, Array.isArray(value) ? value.join(', ') : value);
          }
          headers.set('x-forwarded-for', req.socket.remoteAddress ?? '127.0.0.1');
          const response = await fetch(`${target}${url}`, {
            method: req.method,
            headers,
            body: chunks.length ? Buffer.concat(chunks) : undefined,
            redirect: 'manual',
          });
          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            if (key !== 'set-cookie' && key !== 'content-encoding' && key !== 'content-length') res.setHeader(key, value);
          });
          const cookies = response.headers.getSetCookie();
          if (cookies.length) res.setHeader('set-cookie', cookies);
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          res.statusCode = 502;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: { code: 'bot_offline', message: `API server at ${target} is not reachable: ${String(error)}` } }));
        }
      });
    },
  };
}

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const DEV_PORT = 5173;
const apiPort = Number(process.env.SERVER_PORT || process.env.PORT || 3000);
// Never proxy to Vite itself (some launchers set PORT to the dev server port).
const apiTarget = process.env.API_PROXY_TARGET ?? `http://127.0.0.1:${apiPort === DEV_PORT ? 3000 : apiPort}`;

export default defineConfig({
  plugins: [react(), tailwindcss(), designTokens(), devApiProxy(apiTarget, ['/api', '/auth', '/healthz'])],
  envDir: repoRoot,
  server: {
    port: DEV_PORT,
    fs: { allow: [repoRoot] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 800,
  },
});
