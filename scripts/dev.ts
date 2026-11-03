/**
 * `bun dev`: runs the bot + API with --watch and the Vite dev server together.
 * Open http://localhost:5173 (set PUBLIC_URL=http://localhost:5173 in .env for OAuth).
 */
export {};

const apiPort =process.env.SERVER_PORT || process.env.PORT || '3000';

const processes = [
  Bun.spawn(['bun', '--watch', 'apps/bot/src/index.ts'], {
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
  }),
  Bun.spawn(['bun', '--bun', 'vite'], {
    cwd: 'apps/web',
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, API_PROXY_TARGET: `http://127.0.0.1:${apiPort}` },
  }),
];

const stop = () => {
  for (const child of processes) child.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const code = await Promise.race(processes.map((child) => child.exited));
console.error(`A dev process exited with code ${code}. Stopping the others.`);
stop();
