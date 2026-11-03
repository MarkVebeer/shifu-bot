/**
 * Tiny structured logger. JSON lines in production, readable lines in development.
 */
const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 } as const;
export type LogLevel = keyof typeof LEVELS;
export type LogFields = Record<string, unknown>;

export interface Logger {
  trace(msg: string, fields?: LogFields): void;
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

function serialize(value: unknown): unknown {
  if (value instanceof Error) {
    const extra = value as Error & { code?: unknown; status?: unknown };
    return { name: value.name, message: value.message, code: extra.code, status: extra.status, stack: value.stack };
  }
  return value;
}

const tint = { trace: '\x1b[90m', debug: '\x1b[36m', info: '\x1b[34m', warn: '\x1b[33m', error: '\x1b[31m' } as const;

export function createLogger(options: { level: LogLevel; pretty: boolean }, bindings: LogFields = {}): Logger {
  const min = LEVELS[options.level];

  const write = (level: LogLevel, msg: string, fields?: LogFields) => {
    if (LEVELS[level] < min) return;
    const all: LogFields = { ...bindings, ...fields };
    for (const key of Object.keys(all)) all[key] = serialize(all[key]);
    const stream = LEVELS[level] >= LEVELS.warn ? process.stderr : process.stdout;
    if (options.pretty) {
      const extra = Object.keys(all).length ? ` \x1b[90m${JSON.stringify(all)}\x1b[0m` : '';
      const time = new Date().toISOString().slice(11, 19);
      stream.write(`\x1b[90m${time}\x1b[0m ${tint[level]}${level.toUpperCase().padEnd(5)}\x1b[0m ${msg}${extra}\n`);
    } else {
      stream.write(`${JSON.stringify({ time: new Date().toISOString(), level, msg, ...all })}\n`);
    }
  };

  return {
    trace: (msg, fields) => write('trace', msg, fields),
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
    child: (more) => createLogger(options, { ...bindings, ...more }),
  };
}
