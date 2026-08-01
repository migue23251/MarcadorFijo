import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

export default defineConfig(async ({ mode }) => {
  // loadEnv merges .env / .env.<mode> files into a plain object.
  // The third argument '' means: load ALL variables (not just VITE_* prefixed ones).
  // When pnpm runs this build, cwd() is artifacts/football-bets/ — but the .env
  // file lives in the monorepo root (two levels up). We try both locations so the
  // key is found regardless of where the build is invoked from.
  const envFromCwd  = loadEnv(mode, process.cwd(), '');
  const envFromRoot = loadEnv(mode, path.resolve(import.meta.dirname, '..', '..'), '');
  const env = { ...envFromRoot, ...envFromCwd }; // cwd wins if both have the key

  // Shell env takes precedence over .env file (keeps Replit Secrets working).
  const clerkPubKey = process.env.CLERK_PUBLISHABLE_KEY ?? env['CLERK_PUBLISHABLE_KEY'] ?? '';

  // PORT and BASE_PATH are only required at dev/preview time, not during `vite build`.
  const isBuild = process.env.npm_lifecycle_event === 'build';

  const rawPort = process.env.PORT ?? env['PORT'];
  if (!rawPort && !isBuild) {
    throw new Error('PORT environment variable is required but was not provided.');
  }
  const port = Number(rawPort ?? '3000');
  if (!isBuild && (Number.isNaN(port) || port <= 0)) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  const basePath = process.env.BASE_PATH ?? env['BASE_PATH'];
  if (!basePath && !isBuild) {
    throw new Error('BASE_PATH environment variable is required but was not provided.');
  }
  const resolvedBase = basePath ?? '/';

  const nodeEnv = process.env.NODE_ENV ?? env['NODE_ENV'] ?? mode;

  return {
    base: resolvedBase,
    plugins: [
      react(),
      tailwindcss({ optimize: false }),
      runtimeErrorOverlay(),
      ...(nodeEnv !== 'production' && process.env.REPL_ID !== undefined
        ? [
            await import('@replit/vite-plugin-cartographer').then((m) =>
              m.cartographer({
                root: path.resolve(import.meta.dirname, '..'),
              }),
            ),
            await import('@replit/vite-plugin-dev-banner').then((m) =>
              m.devBanner(),
            ),
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
        '@assets': path.resolve(
          import.meta.dirname,
          '..',
          '..',
          'attached_assets',
        ),
      },
      dedupe: ['react', 'react-dom'],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, 'dist/public'),
      emptyOutDir: true,
    },
    define: {
      // Forward the public key to the frontend bundle at build/dev time.
      // CLERK_PUBLISHABLE_KEY is a public key (pk_test_/pk_live_) — safe to embed.
      // Loaded from shell env first, then .env file as fallback.
      'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify(clerkPubKey),
    },
    server: {
      port,
      strictPort: true,
      host: '0.0.0.0',
      allowedHosts: true,
      fs: {
        strict: true,
      },
    },
    preview: {
      port,
      host: '0.0.0.0',
      allowedHosts: true,
    },
  };
});
