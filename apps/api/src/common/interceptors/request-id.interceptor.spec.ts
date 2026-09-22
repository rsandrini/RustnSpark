import { describe, expect, it, jest } from '@jest/globals';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { REQUEST_ID_HEADER, RequestIdInterceptor } from './request-id.interceptor.js';

function makeContext(request: Record<string, unknown>, response: Record<string, unknown>) {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

function makeHandler(): CallHandler {
  return { handle: () => of('ok') };
}

describe('RequestIdInterceptor', () => {
  it('reuses the request id already assigned by the pino http middleware', () => {
    const setHeader = jest.fn();
    const request = { id: 'from-pino' };
    const context = makeContext(request, { setHeader });

    new RequestIdInterceptor().intercept(context, makeHandler());

    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'from-pino');
  });

  it('generates a request id when none was assigned yet', () => {
    const setHeader = jest.fn();
    const request: { id?: string } = {};
    const context = makeContext(request, { setHeader });

    new RequestIdInterceptor().intercept(context, makeHandler());

    expect(request.id).toEqual(expect.any(String));
    expect(request.id).not.toBe('');
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, request.id);
  });
});
