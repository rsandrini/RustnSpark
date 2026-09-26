import request from 'supertest';
import { expect } from '@jest/globals';

/**
 * New pilots get their starter kit loose (D44): most gameplay tests want a flying ship, so they
 * assemble the kit through the same endpoint the Hangar's "Auto layout" button uses.
 */
export async function assembleStarterKit(
  server: Parameters<typeof request>[0],
  token: string,
  shipId: string,
  partInstanceIds?: string[],
): Promise<void> {
  const response = await request(server)
    .post(`/v1/ships/${shipId}/auto-assemble`)
    .set('Authorization', `Bearer ${token}`)
    .send(partInstanceIds === undefined ? {} : { partInstanceIds });
  expect(response.status).toBe(200);
}
