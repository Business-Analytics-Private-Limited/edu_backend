import { describe, expect, it } from 'vitest';
import { redisConnection } from './config';

describe('redisConnection', () => {
  it('turns a URL into BullMQ connection options', () => {
    expect(redisConnection('redis://localhost:6379')).toEqual({ host: 'localhost', port: 6379 });
    expect(redisConnection('redis://user:p%40ss@cache.internal:6380')).toEqual({
      host: 'cache.internal',
      port: 6380,
      username: 'user',
      password: 'p@ss',
    });
  });
});
