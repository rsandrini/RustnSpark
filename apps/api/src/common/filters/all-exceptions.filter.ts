import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';

type ErrorMessage = string | string[] | Record<string, unknown>;

interface ErrorResponseBody {
  statusCode: number;
  message: ErrorMessage;
  requestId?: string;
}

// Stack traces never leave the process: they are logged server-side, never returned to the client, in any environment.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<{ id?: string }>();
    const response = ctx.getResponse<object>();

    const { statusCode, message } = classify(exception);
    const body: ErrorResponseBody = { statusCode, message, requestId: request.id };

    this.logger.error({ err: exception, requestId: request.id }, 'Unhandled exception');
    httpAdapter.reply(response, body, statusCode);
  }
}

// Body-parser and other Express middleware throw plain errors carrying a `status`/`statusCode`
// (e.g. 413 for an oversized payload) rather than a Nest HttpException; those are client errors
// and safe to surface as-is. Anything else collapses to a generic 500 with no exception detail.
function classify(exception: unknown): { statusCode: number; message: ErrorMessage } {
  if (exception instanceof HttpException) {
    return { statusCode: exception.getStatus(), message: extractHttpExceptionMessage(exception) };
  }

  const statusCode = extractClientErrorStatus(exception);
  if (statusCode !== undefined) {
    return { statusCode, message: exception instanceof Error ? exception.message : 'Bad request' };
  }

  return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Internal server error' };
}

function extractHttpExceptionMessage(exception: HttpException): ErrorMessage {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  if (typeof response === 'object' && response !== null) {
    if ('message' in response) return (response as { message: string | string[] }).message;
    // e.g. Terminus's ServiceUnavailableException carries the full health check result as its
    // response, with no `message` key: surface it as-is instead of collapsing it to a generic string.
    return response as Record<string, unknown>;
  }
  return exception.message;
}

function extractClientErrorStatus(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const candidate = exception as { status?: unknown; statusCode?: unknown };
  const status = candidate.status ?? candidate.statusCode;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
}
