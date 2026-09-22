'use client';

import { useState } from 'react';
import { Plus, Save, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  formatEffort,
  formatRepRange,
  parseEffort,
  parseRepRange,
} from '@/lib/program-v2';
import type { TrainingProgram, WeightUnit } from '@/lib/storage';

type EditableProgram = Omit<TrainingProgram, 'id' | 'createdAt'>;

function cloneProgram(program: TrainingProgram): EditableProgram {
  return JSON.parse(JSON.stringify(program)) as EditableProgram;
}

export function ProgramEditor({
  program,
  weightUnit = 'kg',
  templateOptions = [],
  busy = false,
  onCancel,
  onSave,
}: {
  program: TrainingProgram;
  weightUnit?: WeightUnit;
  templateOptions?: Array<{ id: string; title: string; slotId: string | null }>;
  busy?: boolean;
  onCancel: () => void;
  onSave: (program: EditableProgram) => void;
}) {
  const [draft, setDraft] = useState(() => cloneProgram(program));

  function updateDay(
    dayIndex: number,
    patch: Partial<EditableProgram['days'][number]>,
  ) {
    setDraft((current) => ({
      ...current,
      days: current.days.map((day, index) =>
        index === dayIndex ? { ...day, ...patch } : day,
      ),
    }));
  }

  function updateExercise(
    dayIndex: number,
    exerciseIndex: number,
    patch: Partial<EditableProgram['days'][number]['exercises'][number]>,
  ) {
    setDraft((current) => ({
      ...current,
      days: current.days.map((day, currentDayIndex) =>
        currentDayIndex === dayIndex
          ? {
              ...day,
              exercises: day.exercises.map((exercise, currentExerciseIndex) =>
                currentExerciseIndex === exerciseIndex
                  ? { ...exercise, ...patch }
                  : exercise,
              ),
            }
          : day,
      ),
    }));
  }

  function addExercise(dayIndex: number) {
    updateDay(dayIndex, {
      exercises: [
        ...draft.days[dayIndex].exercises,
        {
          exerciseTemplateId: null,
          slotId: null,
          name: 'New exercise',
          sets: 3,
          repRange: [8, 12],
          effort: { type: 'rir', value: [2, 3] },
          restSeconds: 90,
          startingLoadKg: null,
          progression: {
            rule: 'double_progression',
            loadIncrementKg: 2.5,
            triggerReps: 12,
          },
          note: 'Use a controlled effort.',
          rationale: 'Added manually by the athlete.',
        },
      ],
    });
  }

  function removeExercise(dayIndex: number, exerciseIndex: number) {
    updateDay(dayIndex, {
      exercises: draft.days[dayIndex].exercises.filter(
        (_, index) => index !== exerciseIndex,
      ),
    });
  }

  return (
    <div className="program-editor">
      <header className="program-editor-header">
        <div>
          <p className="eyebrow">EDIT PROGRAM</p>
          <h2>Shape the block to fit you.</h2>
          <p>
            Change exercises, sets, reps, rest, and coaching notes. Your edits
            stay in this saved program until you choose to save them.
          </p>
        </div>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          <X />
          Cancel
        </Button>
      </header>

      <div className="program-editor-copy">
        <label>
          <span>Program title</span>
          <input
            value={draft.title}
            onChange={(event) =>
              setDraft((current) => ({ ...current, title: event.target.value }))
            }
          />
        </label>
        <label>
          <span>Overview</span>
          <textarea
            rows={3}
            value={draft.overview}
            onChange={(event) =>
              setDraft((current) => ({ ...current, overview: event.target.value }))
            }
          />
        </label>
        <div className="program-editor-principles">
          <label>
            <span>Progression</span>
            <textarea
              rows={3}
              value={draft.progression}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  progression: event.target.value,
                }))
              }
            />
          </label>
          <label>
            <span>Deload</span>
            <textarea
              rows={3}
              value={draft.deload}
              onChange={(event) =>
                setDraft((current) => ({ ...current, deload: event.target.value }))
              }
            />
          </label>
        </div>
      </div>

      <div className="editor-days">
        {draft.days.map((day, dayIndex) => (
          <section className="editor-day" key={`${day.day}-${dayIndex}`}>
            <div className="editor-day-heading">
              <div>
                <span>DAY {String(day.day).padStart(2, '0')}</span>
                <input
                  aria-label={`Day ${day.day} title`}
                  value={day.title}
                  onChange={(event) =>
                    updateDay(dayIndex, { title: event.target.value })
                  }
                />
              </div>
              <input
                aria-label={`Day ${day.day} focus`}
                value={day.focus}
                onChange={(event) =>
                  updateDay(dayIndex, { focus: event.target.value })
                }
              />
            </div>
            <div className="editor-exercises">
              {day.exercises.map((exercise, exerciseIndex) => (
                <div className="editor-exercise" key={`${exercise.name}-${exerciseIndex}`}>
                  <div className="editor-exercise-topline">
                    <span>{String(exerciseIndex + 1).padStart(2, '0')}</span>
                    <input
                      aria-label={`Day ${day.day} exercise ${exerciseIndex + 1} name`}
                      value={exercise.name}
                      onChange={(event) =>
                        updateExercise(dayIndex, exerciseIndex, {
                          name: event.target.value,
                        })
                      }
                    />
                    <button
                      type="button"
                      className="icon-button danger"
                      aria-label={`Remove ${exercise.name}`}
                      onClick={() => removeExercise(dayIndex, exerciseIndex)}
                      disabled={busy || day.exercises.length <= 1}
                    >
                      <Trash2 />
                    </button>
                  </div>
                  <label>
                    <span>Hevy movement</span>
                    <select
                      value={exercise.exerciseTemplateId ?? ''}
                      onChange={(event) => {
                        const selected = templateOptions.find(
                          (option) => option.id === event.target.value,
                        );
                        updateExercise(dayIndex, exerciseIndex, {
                          exerciseTemplateId: selected?.id || null,
                          slotId: selected?.slotId ?? null,
                          ...(selected?.title ? { name: selected.title } : {}),
                        });
                      }}
                    >
                      <option value="">
                        {templateOptions.length ? 'Select a synchronized template' : 'Sync Hevy templates first'}
                      </option>
                      {templateOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="editor-exercise-grid">
                    <label>
                      <span>Sets</span>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={exercise.sets}
                        onChange={(event) =>
                          updateExercise(dayIndex, exerciseIndex, {
                            sets: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>Reps</span>
                      <input
                        value={formatRepRange(exercise.repRange)}
                        onChange={(event) =>
                          updateExercise(dayIndex, exerciseIndex, {
                            repRange: parseRepRange(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>Effort</span>
                      <input
                        value={formatEffort(exercise.effort)}
                        onChange={(event) =>
                          updateExercise(dayIndex, exerciseIndex, {
                            effort: parseEffort(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>Rest (sec)</span>
                      <input
                        type="number"
                        min={30}
                        max={600}
                        value={exercise.restSeconds}
                        onChange={(event) =>
                          updateExercise(dayIndex, exerciseIndex, {
                            restSeconds: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>Start load ({weightUnit})</span>
                      <input
                        type="number"
                        min={0}
                        step="0.1"
                        value={
                          exercise.startingLoadKg == null
                            ? ''
                            : weightUnit === 'kg'
                              ? exercise.startingLoadKg
                              : Math.round(exercise.startingLoadKg * 2.2046226218 * 10) / 10
                        }
                        onChange={(event) =>
                          updateExercise(dayIndex, exerciseIndex, {
                            startingLoadKg:
                              event.target.value === ''
                                ? null
                                : weightUnit === 'kg'
                                  ? Number(event.target.value)
                                  : Number(event.target.value) / 2.2046226218,
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>Progression</span>
                      <select
                        value={exercise.progression.rule}
                        onChange={(event) =>
                          updateExercise(dayIndex, exerciseIndex, {
                            progression: {
                              ...exercise.progression,
                              rule: event.target.value as typeof exercise.progression.rule,
                            },
                          })
                        }
                      >
                        <option value="double_progression">Double progression</option>
                        <option value="rep_target_then_load">Rep target, then load</option>
                        <option value="linear_load">Linear load</option>
                        <option value="hold">Hold</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    <span>Coaching note</span>
                    <input
                      value={exercise.note}
                      onChange={(event) =>
                        updateExercise(dayIndex, exerciseIndex, {
                          note: event.target.value,
                        })
                      }
                    />
                  </label>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="add-exercise-button"
              onClick={() => addExercise(dayIndex)}
              disabled={busy}
            >
              <Plus />
              Add exercise
            </button>
          </section>
        ))}
      </div>

      <div className="program-editor-actions">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          <X />
          Cancel
        </Button>
        <Button type="button" onClick={() => onSave(draft)} disabled={busy}>
          <Save />
          {busy ? 'Saving…' : 'Save program'}
        </Button>
      </div>
    </div>
  );
}
