import { sanitizeErrorMessage } from './utils/redact.js';

export interface Logger {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface PrismaLike {
  $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  $disconnect(): Promise<void>;
}

export interface ServerLike {
  close(callback?: (error?: Error) => void): unknown;
  closeIdleConnections?: () => void;
}

export interface SignalTarget {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown;
}

export const DEFAULT_FORCE_EXIT_DELAY_MS = 10000;
export const DEFAULT_DISCONNECT_TIMEOUT_MS = 5000;
export const DEFAULT_DB_CHECK_TIMEOUT_MS = 10000;

export function describeError(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.stack ?? `${reason.name}: ${reason.message}`;
  }
  if (typeof reason === 'string') {
    return reason;
  }
  return Object.prototype.toString.call(reason);
}

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) {
    return `${reason.name}: ${reason.message}`;
  }
  return describeError(reason);
}

async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export interface DatabaseCheckResult {
  ok: boolean;
  error?: string;
}

export async function checkDatabaseConnection(
  prisma: PrismaLike,
  timeoutMs: number = DEFAULT_DB_CHECK_TIMEOUT_MS
): Promise<DatabaseCheckResult> {
  try {
    await withTimeout(
      prisma.$queryRaw`SELECT 1`,
      timeoutMs,
      'Database connectivity check'
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: sanitizeErrorMessage(errorMessage(error)) };
  }
}

export interface LifecycleOptions {
  prisma: PrismaLike;
  exit: (code: number) => void;
  logger?: Logger;
  forceExitDelayMs?: number;
  disconnectTimeoutMs?: number;
}

export interface Lifecycle {
  attachServer(server: ServerLike): void;
  registerProcessHandlers(target?: SignalTarget): () => void;
  shutdown(reason: string, exitCode?: number): Promise<void>;
  isShuttingDown(): boolean;
  finished: Promise<number>;
}

export function createLifecycle(options: LifecycleOptions): Lifecycle {
  const { prisma, exit } = options;
  const logger: Logger = options.logger ?? console;
  const forceExitDelayMs =
    options.forceExitDelayMs ?? DEFAULT_FORCE_EXIT_DELAY_MS;
  const disconnectTimeoutMs =
    options.disconnectTimeoutMs ?? DEFAULT_DISCONNECT_TIMEOUT_MS;

  let server: ServerLike | null = null;
  let shuttingDown = false;
  let exited = false;
  let exitCode = 0;
  let forceTimer: ReturnType<typeof setTimeout> | null = null;
  let disconnectPromise: Promise<void> | null = null;

  let resolveFinished: (code: number) => void = () => undefined;
  const finished = new Promise<number>((resolve) => {
    resolveFinished = resolve;
  });

  function finish(code: number): void {
    if (exited) {
      return;
    }
    exited = true;
    resolveFinished(code);
    exit(code);
  }

  function disconnectOnce(): Promise<void> {
    if (!disconnectPromise) {
      disconnectPromise = (async () => {
        try {
          await withTimeout(
            prisma.$disconnect(),
            disconnectTimeoutMs,
            'Prisma disconnect'
          );
          logger.log('Prisma disconnected');
        } catch (error) {
          logger.error(
            `Prisma disconnect failed: ${sanitizeErrorMessage(errorMessage(error))}`
          );
        }
      })();
    }
    return disconnectPromise;
  }

  async function forceShutdown(): Promise<void> {
    if (exited) {
      return;
    }
    logger.error(
      `Shutdown forced after ${forceExitDelayMs}ms; connections did not drain in time`
    );
    await disconnectOnce();
    finish(exitCode !== 0 ? exitCode : 1);
  }

  async function shutdown(reason: string, code = 0): Promise<void> {
    if (shuttingDown) {
      if (code > exitCode) {
        exitCode = code;
        logger.error(
          `Shutdown in progress; escalating exit code to ${exitCode} (${reason})`
        );
      } else {
        logger.log(`Shutdown already in progress; ignoring ${reason}`);
      }
      return;
    }
    shuttingDown = true;
    exitCode = code;
    logger.log(`Shutting down gracefully (${reason})`);

    forceTimer = setTimeout(() => {
      void forceShutdown();
    }, forceExitDelayMs);

    try {
      server?.closeIdleConnections?.();
    } catch {
      // ignore closeIdleConnections errors; close still proceeds
    }

    const activeServer = server;
    if (activeServer) {
      await new Promise<void>((resolve) => {
        try {
          activeServer.close(() => resolve());
        } catch {
          resolve();
        }
      });
    }

    await disconnectOnce();

    if (forceTimer) {
      clearTimeout(forceTimer);
      forceTimer = null;
    }
    logger.log('Graceful shutdown complete');
    finish(exitCode);
  }

  function attachServer(nextServer: ServerLike): void {
    server = nextServer;
  }

  function registerProcessHandlers(target: SignalTarget = process): () => void {
    const onSigterm = (): void => {
      void shutdown('SIGTERM', 0);
    };
    const onSigint = (): void => {
      void shutdown('SIGINT', 0);
    };
    const onUnhandledRejection = (reason: unknown): void => {
      logger.error(
        `Unhandled promise rejection: ${sanitizeErrorMessage(describeError(reason))}`
      );
      void shutdown('unhandledRejection', 1);
    };
    const onUncaughtException = (error: unknown): void => {
      logger.error(
        `Uncaught exception: ${sanitizeErrorMessage(describeError(error))}`
      );
      void shutdown('uncaughtException', 1);
    };

    target.on('SIGTERM', onSigterm);
    target.on('SIGINT', onSigint);
    target.on('unhandledRejection', onUnhandledRejection);
    target.on('uncaughtException', onUncaughtException);

    return () => {
      target.removeListener('SIGTERM', onSigterm);
      target.removeListener('SIGINT', onSigint);
      target.removeListener('unhandledRejection', onUnhandledRejection);
      target.removeListener('uncaughtException', onUncaughtException);
    };
  }

  function isShuttingDown(): boolean {
    return shuttingDown;
  }

  return {
    attachServer,
    registerProcessHandlers,
    shutdown,
    isShuttingDown,
    finished,
  };
}

export interface StartServerOptions {
  listen: () => ServerLike;
  prisma: PrismaLike;
  exit: (code: number) => void;
  logger?: Logger;
  signalTarget?: SignalTarget;
  dbCheckTimeoutMs?: number;
  forceExitDelayMs?: number;
  disconnectTimeoutMs?: number;
}

export interface StartServerResult {
  started: boolean;
  databaseOk: boolean;
  server: ServerLike | null;
  lifecycle: Lifecycle;
}

export async function startServer(
  options: StartServerOptions
): Promise<StartServerResult> {
  const logger: Logger = options.logger ?? console;
  const lifecycle = createLifecycle({
    prisma: options.prisma,
    exit: options.exit,
    logger,
    forceExitDelayMs: options.forceExitDelayMs,
    disconnectTimeoutMs: options.disconnectTimeoutMs,
  });

  lifecycle.registerProcessHandlers(options.signalTarget);

  const check = await checkDatabaseConnection(
    options.prisma,
    options.dbCheckTimeoutMs
  );
  if (!check.ok) {
    logger.error(
      `Startup failed: the database is unavailable (${check.error})`
    );
    await lifecycle.shutdown('startup database check failed', 1);
    return { started: false, databaseOk: false, server: null, lifecycle };
  }

  logger.log('Database connection verified (startup check)');
  const server = options.listen();
  lifecycle.attachServer(server);
  return { started: true, databaseOk: true, server, lifecycle };
}
