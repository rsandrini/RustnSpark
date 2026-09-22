import { describe, expect, it, jest } from '@jest/globals';
import type { Logger as PinoLogger } from 'pino';
import { PinoLoggerService } from './pino-logger.service.js';

function makePinoMock() {
  return {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  };
}

describe('PinoLoggerService', () => {
  it('forwards log() to pino info with the context carried over', () => {
    const pino = makePinoMock();
    const service = new PinoLoggerService(pino as unknown as PinoLogger);

    service.log('hello', 'MyService');

    expect(pino.info).toHaveBeenCalledWith({ context: 'MyService' }, 'hello');
  });

  it('forwards error() to pino error', () => {
    const pino = makePinoMock();
    const service = new PinoLoggerService(pino as unknown as PinoLogger);

    service.error('boom', 'MyService');

    expect(pino.error).toHaveBeenCalledWith({ context: 'MyService' }, 'boom');
  });

  it('forwards warn/debug/verbose to their pino counterparts', () => {
    const pino = makePinoMock();
    const service = new PinoLoggerService(pino as unknown as PinoLogger);

    service.warn('w');
    service.debug('d');
    service.verbose('v');

    expect(pino.warn).toHaveBeenCalledWith({ context: undefined }, 'w');
    expect(pino.debug).toHaveBeenCalledWith({ context: undefined }, 'd');
    expect(pino.trace).toHaveBeenCalledWith({ context: undefined }, 'v');
  });
});
