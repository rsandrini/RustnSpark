import type { LoggerService } from '@nestjs/common';
import type { Logger as PinoLogger } from 'pino';

// Adapts a pino instance to Nest's LoggerService so framework-level logs (bootstrap,
// our own `new Logger()` calls) share the same JSON/redaction config as request logs.
export class PinoLoggerService implements LoggerService {
  constructor(private readonly logger: PinoLogger) {}

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.info({ context: lastContext(optionalParams) }, String(message));
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.error({ context: lastContext(optionalParams) }, String(message));
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.warn({ context: lastContext(optionalParams) }, String(message));
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.debug({ context: lastContext(optionalParams) }, String(message));
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.trace({ context: lastContext(optionalParams) }, String(message));
  }
}

// Nest passes the calling class/context name as the last optional argument.
function lastContext(optionalParams: unknown[]): unknown {
  return optionalParams.at(-1);
}
