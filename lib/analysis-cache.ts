import { ANALYSIS_ENGINE_VERSION } from './analysis-contracts';
import type { DashboardData } from './hevy';

export function stableFingerprint(value: unknown) {
  const input = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v${ANALYSIS_ENGINE_VERSION}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function snapshotContent(dashboard: DashboardData): DashboardData {
  return { ...dashboard, calendarWorkouts: [] };
}
