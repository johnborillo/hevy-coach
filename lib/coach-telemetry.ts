export const COACH_TURN_PHASES = [
  'authz',
  'saveUser',
  'loadData',
  'notes',
  'llm.pass0',
  'llm.pass1',
  'validate',
  'saveAssistant',
] as const;

export type CoachTurnPhase = (typeof COACH_TURN_PHASES)[number];

export type TurnTiming = {
  phases: Partial<Record<CoachTurnPhase, number>>;
  totalMs: number;
};

type Clock = () => number;

export class TurnTimer {
  private readonly startedAt: number;
  private readonly phaseStarts = new Map<CoachTurnPhase, number>();
  private readonly phaseDurations = new Map<CoachTurnPhase, number>();

  constructor(private readonly now: Clock = () => Date.now()) {
    this.startedAt = now();
  }

  start(phase: CoachTurnPhase) {
    if (!this.phaseStarts.has(phase)) this.phaseStarts.set(phase, this.now());
    return this;
  }

  end(phase: CoachTurnPhase) {
    const startedAt = this.phaseStarts.get(phase);
    if (startedAt === undefined) return this;
    this.phaseStarts.delete(phase);
    const duration = Math.max(0, this.now() - startedAt);
    this.phaseDurations.set(
      phase,
      (this.phaseDurations.get(phase) ?? 0) + duration,
    );
    return this;
  }

  serialize(): TurnTiming {
    const phases = {} as Partial<Record<CoachTurnPhase, number>>;
    for (const phase of COACH_TURN_PHASES) {
      const startedAt = this.phaseStarts.get(phase);
      const elapsed =
        startedAt === undefined ? 0 : Math.max(0, this.now() - startedAt);
      const duration = (this.phaseDurations.get(phase) ?? 0) + elapsed;
      if (duration > 0) phases[phase] = duration;
    }
    return {
      phases,
      totalMs: Math.max(0, this.now() - this.startedAt),
    };
  }

  serverTiming() {
    const { phases, totalMs } = this.serialize();
    const entries = Object.entries(phases).map(
      ([phase, duration]) =>
        `${phase.replace(/[^a-zA-Z0-9_-]/g, '_')};dur=${duration}`,
    );
    entries.push(`total;dur=${totalMs}`);
    return entries.join(', ');
  }
}
