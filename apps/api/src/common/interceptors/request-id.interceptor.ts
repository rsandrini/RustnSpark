import { randomUUID } from 'node:crypto';
import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';

export const REQUEST_ID_HEADER = 'x-request-id';

type RequestWithId = { id?: string };
type ResponseWithHeader = { setHeader: (name: string, value: string) => void };

// Echoes the correlation id back to the caller and guarantees one exists even
// when the pino http middleware that normally assigns it is not in the chain (e.g. tests).
@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<ResponseWithHeader>();

    const requestId = request.id ?? randomUUID();
    request.id = requestId;
    response.setHeader(REQUEST_ID_HEADER, requestId);

    return next.handle();
  }
}
