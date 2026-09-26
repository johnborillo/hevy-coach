"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, ChevronRight, Database, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { CoachMessageFlags } from "@/lib/coach-options";
import type { CalendarWorkout, DashboardData } from "@/lib/hevy";
import type { WeightUnit } from "@/lib/storage";

export type WorkoutSource = {
  kind: "workout";
  id: string;
  date: string;
  exercise: string;
};

export type SummarySource = {
  kind: "summary";
  field: string;
};

export type CoachSource = WorkoutSource | SummarySource;

const SUMMARY_LABELS: Record<string, string> = {
  stats: "Training summary",
  recentworkouts: "Recent workouts",
  workload: "Eight-week workload",
  workloadweeks: "Eight-week workload",
  exercisestats: "Exercise performance",
  weeklyreview: "Weekly review",
  primarystrengthtrend: "Strength trend",
  muscledistribution: "Muscle distribution",
  latestworkout: "Latest workout",
  workoutcoverage: "Workout coverage",
};

function highlightUnverifiedExcerpt(excerpt: string, tokens: string[]) {
  const escaped = tokens
    .filter(Boolean)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!escaped.length) return excerpt;
  const matcher = new RegExp(`(${escaped.join('|')})`, 'gi');
  return excerpt.split(matcher).map((part, index) =>
    tokens.some((token) => token.toLowerCase() === part.toLowerCase()) ? (
      <strong key={`${part}-${index}`}>{part}</strong>
    ) : (
      part
    ),
  );
}

function normalizeField(value: string) {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

function sourceKey(source: CoachSource) {
  return source.kind === "workout" ? `workout:${source.id}:${source.date}:${source.exercise}` : `summary:${normalizeField(source.field)}`;
}

function shortDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function displayWeight(valueKg: number, unit: WeightUnit, digits = 1) {
  const value = unit === "kg" ? valueKg : valueKg * 2.20462;
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
  })} ${unit}`;
}

function displayVolume(valueKg: number, unit: WeightUnit) {
  const value = unit === "kg" ? valueKg : valueKg * 2.20462;
  return `${Math.round(value).toLocaleString()} ${unit}`;
}

function decorateCitations(content: string, revealing: boolean) {
  const workouts = content.replace(/\[Hevy:\s*(?:workout\/)?([^·\]]+?)\s*·\s*(20\d{2}-\d{2}-\d{2})\s*·\s*([^\]]+?)\]/gi, (_match, rawId: string, date: string, exercise: string) => {
    const source: WorkoutSource = {
      kind: "workout",
      id: rawId.trim(),
      date,
      exercise: exercise.trim(),
    };
    const compactDate = shortDate(date).replace(`, ${date.slice(0, 4)}`, "");
    return `[${compactDate} · ${source.exercise}](#hevy-workout=${encodeURIComponent(JSON.stringify(source))})`;
  });

  const summaries = workouts.replace(/\[Hevy summary:\s*([^\]]+?)\]/gi, (_match, field: string) => {
    const normalized = normalizeField(field);
    const label = SUMMARY_LABELS[normalized] ?? "Training data";
    return `[${label}](#hevy-summary=${encodeURIComponent(field.trim())})`;
  });

  return revealing ? summaries.replace(/\[Hevy(?: summary)?:[^\]]*$/i, "") : summaries;
}

function sourceFromHref(href?: string): CoachSource | null {
  if (!href) return null;
  if (href.startsWith("#hevy-workout=")) {
    try {
      const parsed = JSON.parse(decodeURIComponent(href.slice("#hevy-workout=".length))) as WorkoutSource;
      return parsed.kind === "workout" ? parsed : null;
    } catch {
      return null;
    }
  }
  if (href.startsWith("#hevy-summary=")) {
    return {
      kind: "summary",
      field: decodeURIComponent(href.slice("#hevy-summary=".length)),
    };
  }
  return null;
}

function setDescription(set: CalendarWorkout["exercises"][number]["sets"][number], unit: WeightUnit) {
  const parts: string[] = [];
  if (set.weightKg !== null) parts.push(displayWeight(set.weightKg, unit));
  if (set.reps !== null) parts.push(`${set.reps} reps`);
  if (set.rpe !== null) parts.push(`RPE ${set.rpe}`);
  if (set.type !== "normal") parts.push(set.type.replaceAll("_", " "));
  return parts.join(" · ") || "Logged set";
}

function findWorkout(data: DashboardData, source: WorkoutSource) {
  const normalizedExercise = source.exercise.toLowerCase();
  return data.calendarWorkouts.find((workout) => {
    const idMatches = source.id.length > 0 && (workout.id === source.id || workout.id.startsWith(source.id) || source.id.startsWith(workout.id));
    const dateAndExerciseMatch = workout.date === source.date && workout.exercises.some((exercise) => exercise.title.toLowerCase() === normalizedExercise);
    return idMatches || dateAndExerciseMatch;
  });
}

function SummaryDetails({ field, data, unit }: { field: string; data: DashboardData; unit: WeightUnit }) {
  const normalized = normalizeField(field);

  if (normalized === "weeklyreview") {
    return (
      <div className="coach-source-sections">
        <div>
          <span>Wins</span>
          {data.weeklyReview.wins.map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
        <div>
          <span>Watch</span>
          {data.weeklyReview.watch.map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
        <div>
          <span>Next</span>
          {data.weeklyReview.nextSteps.map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
      </div>
    );
  }

  if (normalized === "recentworkouts") {
    return (
      <div className="coach-source-rows">
        {data.recentWorkouts.map((workout) => (
          <div key={`${workout.date}-${workout.title}`}>
            <span>{workout.date}</span>
            <strong>{workout.title}</strong>
            <small>
              {workout.workingSets} sets · {displayVolume(workout.volumeKg, unit)}
            </small>
          </div>
        ))}
      </div>
    );
  }

  if (normalized === "exercisestats") {
    return (
      <div className="coach-source-rows coach-source-scroll">
        {data.exerciseStats.slice(0, 12).map((exercise) => (
          <div key={exercise.exercise}>
            <span>{exercise.sessions} sessions</span>
            <strong>{exercise.exercise}</strong>
            <small>
              {exercise.workingSets} sets · {exercise.bestE1rmKg ? `${displayWeight(exercise.bestE1rmKg, unit)} e1RM` : "No e1RM"} · {exercise.change >= 0 ? "+" : ""}
              {exercise.change}% · {exercise.progressionStatus.replaceAll("_", " ")}
            </small>
          </div>
        ))}
      </div>
    );
  }

  if (normalized === "stats") {
    return (
      <div className="coach-source-metrics">
        <div>
          <span>Sessions / 30d</span>
          <strong>{data.stats.sessions30d}</strong>
        </div>
        <div>
          <span>Working sets / 7d</span>
          <strong>{data.stats.workingSets7d}</strong>
        </div>
        <div>
          <span>Volume / 30d</span>
          <strong>{displayVolume(data.stats.totalVolume30dKg, unit)}</strong>
        </div>
        <div>
          <span>Average session</span>
          <strong>{data.stats.avgSessionMinutes} min</strong>
        </div>
      </div>
    );
  }

  if (normalized === "workload" || normalized === "workloadweeks") {
    return (
      <div className="coach-source-rows">
        {data.workloadWeeks.map((week) => (
          <div key={week.label}>
            <span>{week.label}</span>
            <strong>
              {week.sessions} session{week.sessions === 1 ? "" : "s"}
            </strong>
            <small>
              {week.sets} sets · {displayVolume(week.volumeKg, unit)}
            </small>
          </div>
        ))}
      </div>
    );
  }

  if (normalized === "primarystrengthtrend") {
    const latest = data.trend.points.at(-1);
    return (
      <div className="coach-source-metrics">
        <div>
          <span>Exercise</span>
          <strong>{data.trend.exercise}</strong>
        </div>
        <div>
          <span>Change</span>
          <strong>
            {data.trend.change >= 0 ? "+" : ""}
            {data.trend.change}%
          </strong>
        </div>
        <div>
          <span>Comparable sessions</span>
          <strong>{data.trend.points.length}</strong>
        </div>
        <div>
          <span>Latest estimate</span>
          <strong>{latest ? displayWeight(latest.value, unit) : "—"}</strong>
        </div>
      </div>
    );
  }

  if (normalized === "muscledistribution") {
    return (
      <div className="coach-source-rows">
        {data.muscles.map((muscle) => (
          <div key={muscle.name}>
            <span>Last 7 days</span>
            <strong>{muscle.name}</strong>
            <small>
              {muscle.sets} direct sets · {muscle.sets - muscle.previousSets >= 0 ? "+" : ""}
              {muscle.sets - muscle.previousSets} vs prior
            </small>
          </div>
        ))}
      </div>
    );
  }

  if (normalized === "latestworkout") {
    return <p className="coach-source-copy">{data.lastWorkout}</p>;
  }

  if (normalized === "workoutcoverage") {
    const newest = data.calendarWorkouts[0]?.date;
    const oldest = data.calendarWorkouts.at(-1)?.date;
    return (
      <div className="coach-source-metrics">
        <div>
          <span>Synced sessions</span>
          <strong>{data.calendarWorkouts.length}</strong>
        </div>
        <div>
          <span>Newest</span>
          <strong>{newest ? shortDate(newest) : "—"}</strong>
        </div>
        <div>
          <span>Oldest</span>
          <strong>{oldest ? shortDate(oldest) : "—"}</strong>
        </div>
      </div>
    );
  }

  return <p className="coach-source-copy">This summary field is part of Rowan’s synchronized training context.</p>;
}

export function CoachSourcePanel({ source, data, unit, onOpenWorkout, onClose }: { source: CoachSource; data: DashboardData; unit: WeightUnit; onOpenWorkout?: (date: string) => void; onClose: () => void }) {
  if (source.kind === "summary") {
    const normalized = normalizeField(source.field);
    return (
      <aside className="coach-source-card" aria-label="Coach source details">
        <header>
          <div>
            <span>
              <Database /> Derived Hevy signal
            </span>
            <strong>{SUMMARY_LABELS[normalized] ?? "Training data"}</strong>
          </div>
          <button type="button" onClick={onClose} aria-label="Close source details">
            <X />
          </button>
        </header>
        <SummaryDetails field={source.field} data={data} unit={unit} />
        <footer>Calculated from the synchronized Hevy workouts available to Rowan.</footer>
      </aside>
    );
  }

  const workout = findWorkout(data, source);
  const exercise = workout?.exercises.find((item) => item.title.toLowerCase() === source.exercise.toLowerCase());

  return (
    <aside className="coach-source-card" aria-label="Coach source details">
      <header>
        <div>
          <span>
            <CalendarDays /> Hevy workout
          </span>
          <strong>{workout ? `${shortDate(workout.date)} · ${workout.title}` : "Reference unavailable"}</strong>
        </div>
        <button type="button" onClick={onClose} aria-label="Close source details">
          <X />
        </button>
      </header>
      {workout && exercise ? (
        <>
          <div className="coach-source-exercise">
            <div>
              <strong>{exercise.title}</strong>
              <span>
                {exercise.muscle} · {workout.time}
              </span>
            </div>
            <div className="coach-source-sets">
              {exercise.sets.map((set, index) => (
                <div key={`${index}-${set.type}-${set.weightKg}-${set.reps}`}>
                  <span>Set {index + 1}</span>
                  <strong>{setDescription(set, unit)}</strong>
                </div>
              ))}
            </div>
          </div>
          <button type="button" className="open-history-source" onClick={() => onOpenWorkout?.(workout.date)}>
            Open full day in History <ChevronRight />
          </button>
        </>
      ) : (
        <p className="coach-source-copy">This older reference cannot be matched to the workouts in the current synchronized Hevy window, so it is not being presented as evidence.</p>
      )}
    </aside>
  );
}

export function CoachMessage({ content, fallbackReason, flags, animate = false, activeSource, onSourceChange, onComplete }: { content: string; fallbackReason?: string | null; flags?: CoachMessageFlags | null; animate?: boolean; activeSource: CoachSource | null; onSourceChange: (source: CoachSource | null) => void; onComplete?: () => void }) {
  const [visible, setVisible] = useState(animate ? "" : content);

  useEffect(() => {
    if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const timer = window.setTimeout(() => {
        setVisible(content);
        onComplete?.();
      }, 0);
      return () => window.clearTimeout(timer);
    }

    let index = 0;
    const chunkSize = Math.max(4, Math.min(14, Math.ceil(content.length / 150)));
    const timer = window.setInterval(() => {
      index = Math.min(content.length, index + chunkSize);
      setVisible(content.slice(0, index));
      if (index >= content.length) {
        window.clearInterval(timer);
        onComplete?.();
      }
    }, 18);
    return () => window.clearInterval(timer);
  }, [animate, content, onComplete]);

  const revealing = animate && visible.length < content.length;
  const renderedContent = useMemo(() => decorateCitations(visible, revealing), [revealing, visible]);

  return (
    <div className="message-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => {
            const source = sourceFromHref(href);
            if (source) {
              const selected = activeSource && sourceKey(activeSource) === sourceKey(source);
              return (
                <button type="button" className="coach-source-chip" aria-expanded={Boolean(selected)} onClick={() => onSourceChange(selected ? null : source)}>
                  <Database /> {children}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            );
          },
          img: ({ alt }) => <span>[Image: {alt || "attachment"}]</span>,
        }}
      >
        {renderedContent}
      </ReactMarkdown>
      {revealing && <span className="response-cursor" aria-hidden="true" />}
      {fallbackReason && !revealing && (
        <details className="coach-fallback-details">
          <summary>
            <AlertTriangle />
            <span>Evidence engine used — show why</span>
          </summary>
          <p>{fallbackReason}</p>
        </details>
      )}
      {flags?.notice && !revealing && <p className="coach-notice">{flags.notice}</p>}
      {flags?.validation === 'unverified' && flags.unverified?.length && !revealing && (
        <aside className="coach-unverified-note">
          <p>Couldn&apos;t match these figures to your Hevy log:</p>
          <ul>
            {flags.unverified.map((item, index) => (
              <li key={`${item.excerpt}-${index}`}>
                {highlightUnverifiedExcerpt(item.excerpt, item.tokens)}
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}
