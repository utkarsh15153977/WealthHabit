import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  checkDatabaseConnection,
  createLifecycle,
  startServer,
  type Logger,
  type PrismaLike,
  type ServerLike,
} from '../src/lifecycle.js';
import { sanitizeErrorMessage } from '../src/utils/redact.js';

interface Recorder {
  logger: Logger;
  logs: string[];
  errors: string[];
}

function createRecorder(): Recorder {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logger: {
      log: (...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      },
      error: (...args: unknown[]) => {
        errors.push(args.map(String).join(' '));
      },
    },
    logs,
    errors,
  };
}

interface Harness {
  order: string[];
  prisma: PrismaLike & {
    $queryRaw: ReturnType<typeof vi.fn>;
    $disconnect: ReturnType<typeof vi.fn>;
  };
  server: ServerLike & {
    close: ReturnType<typeof vi.fn>;
    closeIdleConnections: ReturnType<typeof vi.fn>;
  };
  exit: ReturnType<typeof vi.fn>;
  logger: Logger;
  logs: string[];
  errors: string[];
}

function createHarness(
  options: { closeCallsBack?: boolean } = {}
): Harness {
  const closeCallsBack = options.closeCallsBack ?? true;
  const order: string[] = [];

  const $queryRaw = vi.fn(() => Promise.resolve([{ '?column?': 1 }]));
  const $disconnect = vi.fn(() => {
    order.push('disconnect');
    return Promise.resolve();
  });

  const server = {
    close: vi.fn((callback?: (error?: Error) => void) => {
      order.push('close');
      if (closeCallsBack) {
        callback?.();
      }
      return server;
    }),
    closeIdleConnections: vi.fn(() => {
      order.push('closeIdle');
    }),
  };

  const exit = vi.fn((code: number) => {
    order.push(`exit:${code}`);
  });

  const recorder = createRecorder();

  return {
    order,
    prisma: { $queryRaw, $disconnect },
    server,
    exit,
    logger: recorder.logger,
    logs: recorder.logs,
    errors: recorder.errors,
  };
}

describe('sanitizeErrorMessage', () => {
  it('strips URL credentials but keeps the host', () => {
    const sanitized = sanitizeErrorMessage(
      "Can't reach database server at `db.internal:5432` url=postgresql://wealthhabit:s3cr3t@db.internal:5432/wealthhabit"
    );
    expect(sanitized).toContain('postgresql://[redacted]@db.internal:5432/wealthhabit');
    expect(sanitized).not.toContain('s3cr3t');
    expect(sanitized).not.toContain('wealthhabit:s3cr3t');
  });

  it('strips bearer tokens and JWT-shaped values', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnopqrstuvwxyz012345';
    const sanitized = sanitizeErrorMessage(
      `Authorization Bearer ${jwt} rejected`
    );
    expect(sanitized).not.toContain(jwt);
    expect(sanitized).toContain('Bearer [redacted]');
  });

  it('strips PASSWORD/SECRET/TOKEN/KEY assignments', () => {
    const sanitized = sanitizeErrorMessage(
      'config invalid: password=hunter2, apiKey=abc123, refresh_token: rt_999'
    );
    expect(sanitized).not.toContain('hunter2');
    expect(sanitized).not.toContain('abc123');
    expect(sanitized).not.toContain('rt_999');
    expect(sanitized).toContain('password=[redacted]');
    expect(sanitized).toContain('apiKey=[redacted]');
    expect(sanitized).toContain('refresh_token=[redacted]');
  });

  it('strips quoted and JSON-shaped secret assignments', () => {
    const sanitized = sanitizeErrorMessage(
      'provider config {"password": "hunter2", "apiKey": "abc123"} header "Bearer zzz999"'
    );

    expect(sanitized).not.toContain('hunter2');
    expect(sanitized).not.toContain('abc123');
    expect(sanitized).not.toContain('zzz999');
    expect(sanitized).toContain('password=[redacted]');
    expect(sanitized).toContain('apiKey=[redacted]');
    expect(sanitized).toContain('Bearer [redacted]');
  });
});

describe('checkDatabaseConnection', () => {
  it('runs SELECT 1 and reports success', async () => {
    const prisma: PrismaLike = {
      $queryRaw: vi.fn((query: TemplateStringsArray) => {
        expect(query.join('')).toBe('SELECT 1');
        return Promise.resolve([{ '?column?': 1 }]);
      }),
      $disconnect: vi.fn(() => Promise.resolve()),
    };

    const result = await checkDatabaseConnection(prisma, 1000);
    expect(result).toEqual({ ok: true });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns a sanitized error when the database is unreachable', async () => {
    const prisma: PrismaLike = {
      $queryRaw: vi.fn(() =>
        Promise.reject(
          new Error(
            "Can't reach database server at `127.0.0.1:5999` (password=hunter2)"
          )
        )
      ),
      $disconnect: vi.fn(() => Promise.resolve()),
    };

    const result = await checkDatabaseConnection(prisma, 1000);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Can't reach database server");
    expect(result.error).not.toContain('hunter2');
  });

  it('fails with a clear timeout when the check hangs', async () => {
    const prisma: PrismaLike = {
      $queryRaw: vi.fn(() => new Promise<never>(() => {})),
      $disconnect: vi.fn(() => Promise.resolve()),
    };

    const result = await checkDatabaseConnection(prisma, 30);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Database connectivity check timed out after 30ms');
  });
});

describe('process handlers', () => {
  it('logs a sanitized reason and exits non-zero on unhandledRejection', async () => {
    const harness = createHarness();
    const target = new EventEmitter();
    const lifecycle = createLifecycle({
      prisma: harness.prisma,
      exit: harness.exit,
      logger: harness.logger,
    });
    lifecycle.registerProcessHandlers(target);
    lifecycle.attachServer(harness.server);

    target.emit(
      'unhandledRejection',
      new Error(
        'query failed url=postgresql://user:pw@db.internal:5432/app Bearer abc.def'
      )
    );

    const code = await lifecycle.finished;
    expect(code).toBe(1);
    expect(harness.exit).toHaveBeenCalledTimes(1);
    expect(harness.exit).toHaveBeenCalledWith(1);
    expect(harness.server.close).toHaveBeenCalledTimes(1);
    expect(harness.prisma.$disconnect).toHaveBeenCalledTimes(1);
    expect(harness.order).toEqual(['closeIdle', 'close', 'disconnect', 'exit:1']);

    const logged = harness.errors.join('\n');
    expect(logged).toContain('Unhandled promise rejection');
    expect(logged).not.toContain('pw@');
    expect(logged).not.toContain('abc.def');
  });

  it('logs the stack and exits non-zero on uncaughtException', async () => {
    const harness = createHarness();
    const target = new EventEmitter();
    const lifecycle = createLifecycle({
      prisma: harness.prisma,
      exit: harness.exit,
      logger: harness.logger,
    });
    lifecycle.registerProcessHandlers(target);
    lifecycle.attachServer(harness.server);

    const error = new Error('boom');
    target.emit('uncaughtException', error);

    const code = await lifecycle.finished;
    expect(code).toBe(1);
    expect(harness.exit).toHaveBeenCalledWith(1);

    const logged = harness.errors.join('\n');
    expect(logged).toContain('Uncaught exception');
    expect(logged).toContain('boom');
    expect(logged).toContain('at '); // stack frames present
    expect(harness.order).toEqual(['closeIdle', 'close', 'disconnect', 'exit:1']);
  });

  it('shuts down only once for repeated signals (idempotent)', async () => {
    const harness = createHarness();
    const target = new EventEmitter();
    const lifecycle = createLifecycle({
      prisma: harness.prisma,
      exit: harness.exit,
      logger: harness.logger,
    });
    lifecycle.registerProcessHandlers(target);
    lifecycle.attachServer(harness.server);

    target.emit('SIGTERM');
    target.emit('SIGTERM');
    target.emit('SIGINT');

    const code = await lifecycle.finished;
    expect(code).toBe(0);
    expect(lifecycle.isShuttingDown()).toBe(true);
    expect(harness.server.close).toHaveBeenCalledTimes(1);
    expect(harness.server.closeIdleConnections).toHaveBeenCalledTimes(1);
    expect(harness.prisma.$disconnect).toHaveBeenCalledTimes(1);
    expect(harness.exit).toHaveBeenCalledTimes(1);
    expect(harness.exit).toHaveBeenCalledWith(0);
    expect(harness.order).toEqual(['closeIdle', 'close', 'disconnect', 'exit:0']);

    const logged = harness.logs.join('\n');
    expect(logged).toContain('Shutting down gracefully (SIGTERM)');
    expect(logged).toContain('Shutdown already in progress; ignoring SIGTERM');
    expect(logged).toContain('Shutdown already in progress; ignoring SIGINT');
  });

  it('escalates the exit code when a fatal reason arrives mid-shutdown', async () => {
    const harness = createHarness();
    const target = new EventEmitter();
    const lifecycle = createLifecycle({
      prisma: harness.prisma,
      exit: harness.exit,
      logger: harness.logger,
    });
    lifecycle.registerProcessHandlers(target);
    lifecycle.attachServer(harness.server);

    target.emit('SIGTERM');
    void lifecycle.shutdown('uncaughtException', 1);

    const code = await lifecycle.finished;
    expect(code).toBe(1);
    expect(harness.exit).toHaveBeenCalledTimes(1);
    expect(harness.exit).toHaveBeenCalledWith(1);
    expect(harness.errors.join('\n')).toContain('escalating exit code to 1');
  });

  it('disconnects Prisma before exiting after active requests drain', async () => {
    const harness = createHarness();
    const lifecycle = createLifecycle({
      prisma: harness.prisma,
      exit: harness.exit,
      logger: harness.logger,
    });
    lifecycle.attachServer(harness.server);

    await lifecycle.shutdown('SIGTERM', 0);

    const code = await lifecycle.finished;
    expect(code).toBe(0);
    expect(harness.order).toEqual(['closeIdle', 'close', 'disconnect', 'exit:0']);
    expect(harness.logs).toContain('Prisma disconnected');
    expect(harness.logs).toContain('Graceful shutdown complete');
  });

  it('forces a non-zero exit but still disconnects Prisma first when close hangs', async () => {
    const harness = createHarness({ closeCallsBack: false });
    const lifecycle = createLifecycle({
      prisma: harness.prisma,
      exit: harness.exit,
      logger: harness.logger,
      forceExitDelayMs: 30,
    });
    lifecycle.attachServer(harness.server);
    lifecycle.registerProcessHandlers(new EventEmitter());

    void lifecycle.shutdown('SIGTERM', 0);

    const code = await lifecycle.finished;
    expect(code).toBe(1);
    expect(harness.prisma.$disconnect).toHaveBeenCalledTimes(1);
    expect(harness.exit).toHaveBeenCalledTimes(1);
    expect(harness.exit).toHaveBeenCalledWith(1);
    expect(harness.order).toEqual(['closeIdle', 'close', 'disconnect', 'exit:1']);
    expect(harness.errors.join('\n')).toContain('Shutdown forced after 30ms');
  });

  it('completes shutdown even if the Prisma disconnect hangs (bounded)', async () => {
    const harness = createHarness();
    harness.prisma.$disconnect.mockReturnValue(new Promise<never>(() => {}));
    const lifecycle = createLifecycle({
      prisma: harness.prisma,
      exit: harness.exit,
      logger: harness.logger,
      disconnectTimeoutMs: 30,
    });
    lifecycle.attachServer(harness.server);

    await lifecycle.shutdown('SIGTERM', 0);

    const code = await lifecycle.finished;
    expect(code).toBe(0);
    expect(harness.errors.join('\n')).toContain('Prisma disconnect failed');
    expect(harness.errors.join('\n')).toContain('timed out after 30ms');
    expect(harness.exit).toHaveBeenCalledWith(0);
  });

  it('stops handling signals after unregisterProcessHandlers', () => {
    const harness = createHarness();
    const target = new EventEmitter();
    const lifecycle = createLifecycle({
      prisma: harness.prisma,
      exit: harness.exit,
      logger: harness.logger,
    });
    const unregister = lifecycle.registerProcessHandlers(target);
    unregister();

    target.emit('SIGTERM');

    expect(lifecycle.isShuttingDown()).toBe(false);
    expect(harness.exit).not.toHaveBeenCalled();
    expect(harness.server.close).not.toHaveBeenCalled();
  });
});

describe('startServer', () => {
  it('verifies the database before listening', async () => {
    const harness = createHarness();
    const listen = vi.fn(() => harness.server);

    const result = await startServer({
      listen,
      prisma: harness.prisma,
      exit: harness.exit,
      logger: harness.logger,
      signalTarget: new EventEmitter(),
      dbCheckTimeoutMs: 1000,
    });

    expect(result.started).toBe(true);
    expect(result.databaseOk).toBe(true);
    expect(result.server).toBe(harness.server);
    expect(listen).toHaveBeenCalledTimes(1);
    expect(harness.prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(harness.logs.join('\n')).toContain(
      'Database connection verified (startup check)'
    );
    expect(harness.exit).not.toHaveBeenCalled();
  });

  it('does not listen, logs a sanitized error, and exits non-zero when the database is unreachable', async () => {
    const harness = createHarness();
    harness.prisma.$queryRaw.mockRejectedValue(
      new Error(
        'connect ECONNREFUSED 127.0.0.1:5999 (password=hunter2)'
      )
    );
    const listen = vi.fn(() => harness.server);

    const result = await startServer({
      listen,
      prisma: harness.prisma,
      exit: harness.exit,
      logger: harness.logger,
      signalTarget: new EventEmitter(),
      dbCheckTimeoutMs: 1000,
    });

    expect(result.started).toBe(false);
    expect(result.databaseOk).toBe(false);
    expect(result.server).toBeNull();
    expect(listen).not.toHaveBeenCalled();
    expect(harness.exit).toHaveBeenCalledTimes(1);
    expect(harness.exit).toHaveBeenCalledWith(1);
    expect(harness.prisma.$disconnect).toHaveBeenCalledTimes(1);
    expect(harness.order).toEqual(['disconnect', 'exit:1']);

    const logged = harness.errors.join('\n');
    expect(logged).toContain('Startup failed');
    expect(logged).toContain('ECONNREFUSED');
    expect(logged).not.toContain('hunter2');
    expect(harness.logs.join('\n')).toContain(
      'Shutting down gracefully (startup database check failed)'
    );
    expect(harness.logs.join('\n')).toContain('Prisma disconnected');
  });
});
