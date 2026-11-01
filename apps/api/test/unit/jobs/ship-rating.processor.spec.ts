import { describe, expect, it, jest } from '@jest/globals';
import { ShipRatingProcessor } from '../../../src/jobs/processors/ship-rating.processor.js';
import type { ShipRatingService } from '../../../src/stats/ship-rating.service.js';

describe('ShipRatingProcessor', () => {
  it('refreshes every pilot rating and reports how many ships were rated', async () => {
    const refreshAll = jest.fn<ShipRatingService['refreshAll']>().mockResolvedValue(7);
    const processor = new ShipRatingProcessor({ refreshAll } as unknown as ShipRatingService);

    await expect(processor.process()).resolves.toEqual({ rated: 7 });
    expect(refreshAll).toHaveBeenCalledTimes(1);
  });
});
