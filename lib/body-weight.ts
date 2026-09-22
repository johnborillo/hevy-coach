export type BodyWeightPoint = {
  id: string;
  measuredAt: string;
  weightKg: number;
  source: 'hevy' | 'manual';
};

export function summarizeBodyWeight(
  points: BodyWeightPoint[],
  now = new Date(),
) {
  const values = points
    .map((point) => ({ ...point, time: new Date(point.measuredAt).getTime() }))
    .filter((point) => Number.isFinite(point.time))
    .sort((a, b) => a.time - b.time);
  const past = values.filter((point) => point.time <= now.getTime());
  const recent = past.filter(
    (point) => now.getTime() - point.time <= 7 * 86_400_000,
  );
  const average7d = recent.length
    ? recent.reduce((sum, point) => sum + point.weightKg, 0) / recent.length
    : (past.at(-1)?.weightKg ?? null);
  const fourWeek = past.filter(
    (point) => now.getTime() - point.time <= 28 * 86_400_000,
  );
  let slopeKgPerWeek: number | null = null;
  if (fourWeek.length >= 2) {
    const first = fourWeek[0];
    const last = fourWeek.at(-1)!;
    const weeks = Math.max((last.time - first.time) / (7 * 86_400_000), 1 / 7);
    slopeKgPerWeek =
      Math.round(((last.weightKg - first.weightKg) / weeks) * 100) / 100;
  }
  return {
    average7d: average7d == null ? null : Math.round(average7d * 100) / 100,
    slopeKgPerWeek,
    latest: past.at(-1)?.weightKg ?? null,
  };
}
