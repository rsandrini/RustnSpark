import { Catch, type ArgumentsHost, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';

export class ConfigTuningApiError extends HttpException {
  constructor(body: Record<string, unknown>, status: number) {
    super(body, status);
  }
}

@Catch(ConfigTuningApiError)
export class ConfigTuningApiErrorFilter implements ExceptionFilter {
  catch(exception: ConfigTuningApiError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    response.status(exception.getStatus()).json(exception.getResponse());
  }
}
