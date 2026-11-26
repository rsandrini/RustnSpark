export type GoodsGroup = 'ore' | 'scrap' | 'cores';

const CORE_IDS: ReadonlySet<string> = new Set(['core_fragment']);

/** The goods screen section a held material belongs to: scrap, the cores and fragments, or ore. */
export function goodsGroupOf(materialId: string): GoodsGroup {
  if (materialId === 'scrap') return 'scrap';
  if (CORE_IDS.has(materialId)) return 'cores';
  return 'ore';
}

const ORDER: readonly GoodsGroup[] = ['ore', 'scrap', 'cores'];

/** The holdings split by group, in display order; a group with nothing in it is left out. */
export function groupGoods<T extends { materialId: string }>(
  holdings: readonly T[],
): Array<{ group: GoodsGroup; items: T[] }> {
  return ORDER.map((group) => ({
    group,
    items: holdings.filter((holding) => goodsGroupOf(holding.materialId) === group),
  })).filter((entry) => entry.items.length > 0);
}
