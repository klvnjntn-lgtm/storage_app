import { OsrmService } from './osrm.service';

// table() against a stubbed OSRM /table response: a depot and two stops,
// 600s / 5000m between every pair, with the given snap distance per point.
function stubTable(snapMeters: number[]) {
  const n = snapMeters.length;
  const grid = (v: number) =>
    Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : v)));
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      code: 'Ok',
      durations: grid(600),
      distances: grid(5000),
      sources: snapMeters.map((distance) => ({ distance })),
    }),
  } as Response);
  return snapMeters.map((_, i) => ({ lat: 1.1 + i / 100, lng: 104 }));
}

describe('OsrmService.table', () => {
  afterEach(() => jest.restoreAllMocks());

  it('leaves kerbside pins (within 50m of the road) unchanged', async () => {
    const points = stubTable([10, 50, 30]);
    const m = await new OsrmService().table(points);
    expect(m.durations).toEqual([
      [0, 600, 600],
      [600, 0, 600],
      [600, 600, 0],
    ]);
    expect(m.distances[0][1]).toBe(5000);
  });

  it('adds an off-road leg into and out of a pin far from any mapped road', async () => {
    // Stop 2 is 550m from the road it snapped to: 500m beyond kerbside,
    // x1.3 detour = 650m, at 15 km/h = 156s each way.
    const points = stubTable([0, 0, 550]);
    const m = await new OsrmService().table(points);
    expect(m.durations[0][2]).toBe(600 + 156);
    expect(m.durations[2][1]).toBe(600 + 156);
    expect(m.distances[1][2]).toBe(5000 + 650);
    // Legs not touching that pin, and the diagonal, are unaffected.
    expect(m.durations[0][1]).toBe(600);
    expect(m.durations[2][2]).toBe(0);
  });

  it('still rejects a pin further than 1km from any road', async () => {
    const points = stubTable([0, 1200, 0]);
    await expect(new OsrmService().table(points)).rejects.toMatchObject({ indices: [1] });
  });
});
