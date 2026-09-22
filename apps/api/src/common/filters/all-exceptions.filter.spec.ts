import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

function makeHost(request: Record<string, unknown>) {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const response = { status, json };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { host, response, status, json };
}

function makeAdapterHost() {
  const reply = jest.fn();
  return {
    adapterHost: { httpAdapter: { reply } } as unknown as HttpAdapterHost,
    reply,
  };
}

describe('AllExceptionsFilter', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps an HttpException to its own status and message', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { adapterHost, reply } = makeAdapterHost();
    const { host } = makeHost({ id: 'req-1' });
    const filter = new AllExceptionsFilter(adapterHost);

    filter.catch(new HttpException('nope', HttpStatus.FORBIDDEN), host);

    expect(reply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        statusCode: HttpStatus.FORBIDDEN,
        message: 'nope',
        requestId: 'req-1',
      }),
      HttpStatus.FORBIDDEN,
    );
  });

  it('maps an unknown error to a 500 without ever leaking a stack trace', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { adapterHost, reply } = makeAdapterHost();
    const { host } = makeHost({ id: 'req-2' });
    const filter = new AllExceptionsFilter(adapterHost);
    process.env.NODE_ENV = 'production';

    filter.catch(new Error('boom, with a stack'), host);

    const [, body] = reply.mock.calls[0] as [unknown, Record<string, unknown>, unknown];
    expect(body).not.toHaveProperty('stack');
    expect(body.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  it('surfaces a middleware error that already carries a 4xx status (e.g. body-parser 413)', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { adapterHost, reply } = makeAdapterHost();
    const { host } = makeHost({ id: 'req-4' });
    const filter = new AllExceptionsFilter(adapterHost);
    const payloadTooLarge = Object.assign(new Error('request entity too large'), { status: 413 });

    filter.catch(payloadTooLarge, host);

    expect(reply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ statusCode: 413, message: 'request entity too large' }),
      413,
    );
  });

  it('surfaces the full response body of an HttpException with no message key (e.g. a Terminus health failure)', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { adapterHost, reply } = makeAdapterHost();
    const { host } = makeHost({ id: 'req-5' });
    const filter = new AllExceptionsFilter(adapterHost);
    const healthResult = { status: 'error', details: { redis: { status: 'down' } } };
    const serviceUnavailable = new HttpException(healthResult, HttpStatus.SERVICE_UNAVAILABLE);

    filter.catch(serviceUnavailable, host);

    expect(reply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: healthResult,
      }),
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  });

  it('logs the exception server-side for diagnosis', () => {
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { adapterHost } = makeAdapterHost();
    const { host } = makeHost({ id: 'req-3' });
    const filter = new AllExceptionsFilter(adapterHost);

    filter.catch(new Error('boom'), host);

    expect(errorLog).toHaveBeenCalled();
  });
});
