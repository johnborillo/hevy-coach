'use client';

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { CalendarDays, Clock3, Dumbbell } from 'lucide-react';
import { DayPicker } from 'react-day-picker';

import type { CalendarWorkout } from '@/lib/hevy';
import type { WeightUnit } from '@/lib/storage';

function displayWeight(valueKg: number, unit: WeightUnit) {
  const value = unit === 'kg' ? valueKg : valueKg * 2.20462;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;
}

function displayVolume(valueKg: number, unit: WeightUnit) {
  const value = unit === 'kg' ? valueKg : valueKg * 2.20462;
  return `${Math.round(value).toLocaleString()} ${unit}`;
}

function toDate(day: string) {
  return new Date(`${day}T12:00:00`);
}

function setLabel(
  set: CalendarWorkout['exercises'][number]['sets'][number],
  unit: WeightUnit,
) {
  const load = set.weightKg ? displayWeight(set.weightKg, unit) : null;
  if (load && set.reps) return `${load} × ${set.reps}`;
  if (load) return load;
  if (set.reps) return `${set.reps} reps`;
  return 'Logged set';
}

function typeLabel(type: string) {
  if (type === 'normal') return '';
  return type.replaceAll('_', ' ');
}

export function WorkoutCalendar({
  workouts,
  unit,
  initialDate,
  onSelectedDateChange,
}: {
  workouts: CalendarWorkout[];
  unit: WeightUnit;
  initialDate?: string | null;
  onSelectedDateChange?: (date: string) => void;
}) {
  const initialDay =
    initialDate ?? workouts[0]?.date ?? format(new Date(), 'yyyy-MM-dd');
  const [selected, setSelected] = useState(() => toDate(initialDay));
  const [month, setMonth] = useState(() => toDate(initialDay));
  const workoutsByDay = useMemo(() => {
    const grouped = new Map<string, CalendarWorkout[]>();
    for (const workout of workouts) {
      grouped.set(workout.date, [
        ...(grouped.get(workout.date) ?? []),
        workout,
      ]);
    }
    return grouped;
  }, [workouts]);
  const workoutDates = useMemo(
    () => [...workoutsByDay.keys()].map(toDate),
    [workoutsByDay],
  );
  const selectedKey = format(selected, 'yyyy-MM-dd');
  const selectedWorkouts = workoutsByDay.get(selectedKey) ?? [];

  return (
    <section className="calendar-layout">
      <article className="calendar-panel">
        <div className="panel-heading compact">
          <div>
            <p className="eyebrow">TRAINING CALENDAR</p>
            <h2>Workout days</h2>
          </div>
          <CalendarDays />
        </div>
        <p className="calendar-help">
          Select a highlighted day to inspect every exercise and set synced from
          Hevy.
        </p>
        <DayPicker
          mode="single"
          month={month}
          onMonthChange={setMonth}
          selected={selected}
          onSelect={(day) => {
            if (!day) return;
            setSelected(day);
            onSelectedDateChange?.(format(day, 'yyyy-MM-dd'));
          }}
          showOutsideDays
          weekStartsOn={0}
          modifiers={{ workout: workoutDates }}
          modifiersClassNames={{ workout: 'workout-day' }}
          aria-label="Workout history calendar"
        />
        <div className="calendar-legend">
          <span>
            <i /> Workout logged
          </span>
          <small>{workouts.length} synced sessions available</small>
        </div>
      </article>

      <article className="day-log-panel">
        <header className="day-log-heading">
          <div>
            <p className="eyebrow">DAILY LOG</p>
            <h2>{format(selected, 'EEEE, MMMM d')}</h2>
          </div>
          {selectedWorkouts.length > 0 && (
            <span className="session-count">
              {selectedWorkouts.length} session
              {selectedWorkouts.length === 1 ? '' : 's'}
            </span>
          )}
        </header>

        {selectedWorkouts.length ? (
          <div className="day-workouts">
            {selectedWorkouts.map((workout) => (
              <section key={workout.id} className="logged-workout">
                <header>
                  <div>
                    <span>{workout.time}</span>
                    <h3>{workout.title}</h3>
                  </div>
                  <div className="workout-summary-strip">
                    <span>
                      <Clock3 /> {workout.durationMinutes} min
                    </span>
                    <span>
                      <Dumbbell /> {workout.workingSets} working sets
                    </span>
                    <span>{displayVolume(workout.volumeKg, unit)} volume</span>
                  </div>
                </header>
                <div className="logged-exercises">
                  {workout.exercises.map((exercise, exerciseIndex) => (
                    <div
                      className="logged-exercise"
                      key={`${exercise.title}-${exerciseIndex}`}
                    >
                      <div className="exercise-log-heading">
                        <span>
                          {String(exerciseIndex + 1).padStart(2, '0')}
                        </span>
                        <div>
                          <strong>{exercise.title}</strong>
                          <small>{exercise.muscle}</small>
                        </div>
                      </div>
                      <div className="set-ledger">
                        {exercise.sets.map((set, setIndex) => (
                          <div
                            className={set.type === 'warmup' ? 'warmup' : ''}
                            key={`${setIndex}-${set.type}-${set.weightKg}-${set.reps}`}
                          >
                            <span>Set {setIndex + 1}</span>
                            <strong>{setLabel(set, unit)}</strong>
                            {set.rpe ? (
                              <small>RPE {set.rpe}</small>
                            ) : (
                              <small>—</small>
                            )}
                            {typeLabel(set.type) && (
                              <em>{typeLabel(set.type)}</em>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="calendar-empty">
            <CalendarDays />
            <strong>No workout logged</strong>
            <p>Choose a highlighted date to open its Hevy session details.</p>
          </div>
        )}
      </article>
    </section>
  );
}
