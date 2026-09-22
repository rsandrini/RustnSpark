import { describe, expect, it } from '@jest/globals';
import { bullConnectionOptions, PING_QUEUE_NAME } from './queues.js';

describe('PING_QUEUE_NAME', () => {
  it('is a stable queue name', () => {
    expect(PING_QUEUE_NAME).toBe('ping');
  });
});

describe('bullConnectionOptions', () => {
  it('wraps the given REDIS_URL as bullmq connection options, unchanged', () => {
    expect(bullConnectionOptions('redis://example.invalid:6379')).toEqual({
      url: 'redis://example.invalid:6379',
    });
  });
});
