import { describe, expect, it } from 'vitest';
import { flagNotes, painSuppressedExerciseTemplateIds } from '../lib/notes';
import { composeWeeklyReview, type FindingContext } from '../lib/findings';
import type { HevyWorkout } from '../lib/hevy-types';

function workout(
  id: string,
  date: string,
  notes: string | null = null,
): HevyWorkout {
  return {
    id,
    title: 'Upper day',
    start_time: `${date}T12:00:00.000Z`,
    end_time: `${date}T13:00:00.000Z`,
    exercises: [
      {
        title: 'Shoulder Press',
        exercise_template_id: 'shoulder-press',
        notes,
        sets: [{ type: 'normal', weight_kg: 30, reps: 8, rpe: 9 }],
      },
    ],
  };
}

describe('Hevy note ingestion', () => {
  it('flags an exact pain note with a workout citation and safe recommendation', () => {
    const [finding] = flagNotes(
      workout('workout-1', '2026-09-14', 'Left shoulder pinched on the press'),
      '2026-09-14T00:00:00.000Z',
    );

    expect(finding).toMatchObject({
      kind: 'NOTE_FLAGGED',
      severity: 'watch',
      citations: ['workout-1'],
      subject: { key: 'workout-1:shoulder-press:0' },
      evidence: {
        note: 'Left shoulder pinched on the press',
        category: 'pain',
        workoutDate: '2026-09-14',
        exerciseTemplateId: 'shoulder-press',
      },
    });
    expect(finding.recommendation).toContain('joint-friendlier');
    expect(finding.recommendation).not.toContain('diagnos');
  });

  it('keeps pain suppression active for the note session and the next two exposures', () => {
    const sessions = [
      workout('workout-1', '2026-09-01', 'shoulder pinched'),
      workout('workout-2', '2026-09-04'),
      workout('workout-3', '2026-09-08'),
    ];
    expect(painSuppressedExerciseTemplateIds(sessions)).toEqual([
      'shoulder-press',
    ]);
    expect(
      painSuppressedExerciseTemplateIds([
        ...sessions,
        workout('workout-4', '2026-09-12'),
      ]),
    ).toEqual([]);
  });

  it('removes a stalled finding while the associated pain note is active', () => {
    const context: FindingContext = {
      weekStart: '2026-09-14T00:00:00.000Z',
      weekEnd: '2026-09-21T00:00:00.000Z',
      summary: { sessions: 1, planned: 4, directSets: 3, prs: 0 },
      progressionStates: [
        {
          exerciseTemplateId: 'shoulder-press',
          slotId: null,
          title: 'Shoulder Press',
          variationChangeAt: null,
          sessionsAnalyzed: 6,
          lastPerformedAt: '2026-09-14T12:00:00.000Z',
          modalLoadKg: 30,
          repsAtModalLoad: [8, 8, 8],
          targetRepRange: [6, 10],
          rpeCoverage: 1,
          lastSetRpe: [9, 9.5],
          rpeSlope: 0.3,
          performanceIndex: [90, 90, 89, 88, 87, 86],
          performanceSlopePct: -1.5,
          sessionsSinceImprovement: 4,
          status: 'stalled',
          recommendation: 'reduce_load',
          rationale: 'Recent effort is high.',
        },
      ],
      records: [],
      muscles: [],
      balance: [],
      adherencePct: 25,
      plannedSessionsPerWeek: 4,
      sessionsInPriorWeek: 1,
      volumeChangePercent: 0,
      phase: 'maintain',
      activeBlockKind: null,
      citations: ['workout-1'],
      noteFlags: flagNotes(
        workout('workout-1', '2026-09-14', 'shoulder pinched'),
        '2026-09-14T00:00:00.000Z',
      ),
      painSuppressedExerciseTemplateIds: ['shoulder-press'],
      painSuppressedSlotIds: [],
    };
    const review = composeWeeklyReview(context);
    expect(review.act.some((item) => item.kind === 'EXERCISE_STALLED')).toBe(false);
    expect(review.watch.some((item) => item.kind === 'NOTE_FLAGGED')).toBe(true);
  });
});
