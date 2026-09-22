import type { DashboardData } from './hevy';
import type { AthleteProfile, TrainingProgram } from './storage';

function preferredWeight(valueKg: number | null, profile: AthleteProfile) {
  if (valueKg == null || !Number.isFinite(valueKg)) return null;
  const value = profile.weightUnit === 'kg' ? valueKg : valueKg * 2.2046226218;
  return `${Math.round(value * 10) / 10} ${profile.weightUnit}`;
}

export function buildProgramContext(
  profile: AthleteProfile,
  dashboard: DashboardData,
  currentProgram: TrainingProgram | null = null,
) {
  const context = {
    athlete: {
      phase: profile.phase,
      phaseStartedAt: profile.phaseStartedAt || null,
      primaryGoal: profile.primaryGoal,
      experience: profile.experience,
      equipment: profile.equipment,
      limitations: profile.limitations,
      preferences: profile.preferences,
      daysPerWeek: profile.daysPerWeek,
      minutesPerSession: profile.minutesPerSession,
      measurementPreferences: {
        weightUnit: profile.weightUnit,
        heightFormat: profile.heightUnit === 'imperial' ? 'feet_and_inches' : 'centimetres',
      },
      loadIncrementsKg: profile.loadIncrements,
    },
    findings: dashboard.weeklyReviewV2
      ? {
          wins: dashboard.weeklyReviewV2.wins,
          watch: dashboard.weeklyReviewV2.watch,
          act: dashboard.weeklyReviewV2.act,
          carriedOver: dashboard.weeklyReviewV2.carriedOver,
        }
      : null,
    progressionStates: dashboard.progressionStates
      .filter((state) => state.sessionsAnalyzed > 0)
      .map((state) => ({
        exerciseTemplateId: state.exerciseTemplateId,
        slotId: state.slotId,
        title: state.title,
        status: state.status,
        modalLoad: preferredWeight(state.modalLoadKg, profile),
        modalLoadKg: state.modalLoadKg,
        reps: state.repsAtModalLoad.slice(-6),
        rpe: state.lastSetRpe.slice(-6),
        recommendation: state.recommendation,
        rationale: state.rationale,
      })),
    muscleAudit: dashboard.muscles.map((muscle) => ({
      muscle: muscle.name,
      directSets7d: muscle.sets,
      fourWeekAverage: muscle.fourWeekAvgDirect,
      band: muscle.bandLabel,
    })),
    balance: dashboard.balance,
    adherence: dashboard.adherenceWeeks,
    activeTrainingBlock: dashboard.activeTrainingBlock
      ? {
          name: dashboard.activeTrainingBlock.name,
          kind: dashboard.activeTrainingBlock.kind,
          startsAt: dashboard.activeTrainingBlock.startsAt,
          endsAt: dashboard.activeTrainingBlock.endsAt,
        }
      : null,
    familiarExercises: dashboard.exerciseStats.slice(0, 80).map((exercise) => ({
      exerciseTemplateId: exercise.exerciseTemplateId,
      slotId: exercise.slotId,
      name: exercise.exercise,
      muscle: exercise.muscle,
      sessions: exercise.sessions,
      workingSets: exercise.workingSets,
      modalLoadKg: exercise.modalLoadKg,
      modalLoad: preferredWeight(exercise.modalLoadKg, profile),
      status: exercise.progressionStatus,
      recommendation: exercise.progressionRecommendation,
    })),
    currentProgram: currentProgram
      ? {
          id: currentProgram.id,
          title: currentProgram.title,
          days: currentProgram.days.map((day) => ({
            day: day.day,
            title: day.title,
            exercises: day.exercises.map((exercise) => ({
              exerciseTemplateId: exercise.exerciseTemplateId,
              slotId: exercise.slotId,
              name: exercise.name,
              sets: exercise.sets,
              repRange: exercise.repRange,
              progression: exercise.progression,
            })),
          })),
        }
      : null,
    instruction:
      'Preserve progressing and holding exercises unless the athlete asks otherwise. Alter stalled or regressing exposures using the supplied recommendation. Address zero or low muscles relevant to the goal, but keep week-one weekly sets within roughly 15% of the athlete’s recent four-week average. Return all loads in kilograms inside JSON.',
  };
  return JSON.stringify(context);
}

export function programGenerationPrompt(
  request: {
    goal: string;
    durationWeeks: number;
    daysPerWeek: number;
    minutesPerSession: number;
    preferences?: string;
  },
  context: string,
) {
  return `Create a complete training program as strict JSON only. Use schemaVersion 2 and this schema:
{"schemaVersion":2,"title":"string","goal":"string","durationWeeks":number,"daysPerWeek":number,"minutesPerSession":number,"overview":"string","progression":"string","deload":"string","days":[{"day":number,"title":"string","focus":"string","exercises":[{"exerciseTemplateId":"string|null","slotId":"string|null","name":"string","sets":number,"repRange":[number,number],"effort":{"type":"rir|rpe","value":"number|[number,number]"},"restSeconds":number,"startingLoadKg":"number|null","progression":{"rule":"double_progression|linear_load|rep_target_then_load|hold","loadIncrementKg":number,"triggerReps":"number|null"},"note":"string","rationale":"string"}]}]}

Request: ${JSON.stringify(request)}

Private athlete and training context:
${context}

Use null for exerciseTemplateId only when the exercise cannot be resolved to a familiar Hevy movement. Do not invent template IDs. Return JSON only.`;
}
