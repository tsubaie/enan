import { expect, it } from 'vitest';
import { groupTail } from '../rows';
import { testConfig, testController, testRow, type TestRow } from './fixtures';
// EP-B27: the tile that would leave a hole beside it is marked, per group, so it can span its row.
const row = (id: string, score: number) => ({
  item: testRow(id, id, score),
  leaving: false,
  entering: false,
});
const band = (item: TestRow) => (item.score > 5 ? 'High' : 'Low');
const tails = (scores: number[]) => {
  const rows = scores.map((score, index) => row(String(index), score));
  const surface = { config: testConfig({ group: band }), controller: testController() };
  return rows.map((_, index) => groupTail(surface, rows, index));
};
it('EP-B27 a lone tile and the last tile of an odd group are marked, per group', () => {
  // Low: one tile. High: three tiles, the third ends the group in an odd place.
  expect(tails([1, 9, 9, 9])).toEqual(['alone', undefined, undefined, 'odd']);
  // An even group leaves no hole.
  expect(tails([9, 9])).toEqual([undefined, undefined]);
});
