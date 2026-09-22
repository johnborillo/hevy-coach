import type { ExerciseTemplate } from './hevy-types';
import { muscleLabel, resolveMuscles, type Muscle } from './muscles';

export const SLOT_PATTERNS = [
  'horizontal_press',
  'vertical_press',
  'hinge',
  'squat',
  'row',
  'pulldown',
  'isolation',
] as const;

export type SlotPattern = (typeof SLOT_PATTERNS)[number];

export type ExerciseSlot = {
  id: string;
  userId?: string;
  name: string;
  primaryMuscle: Muscle;
  pattern: SlotPattern | null;
  templateIds: string[];
};

export type SlotSuggestion = {
  key: string;
  name: string;
  primaryMuscle: Muscle;
  pattern: SlotPattern;
  templateIds: string[];
  exerciseTitles: string[];
};

const PATTERN_LABELS: Record<SlotPattern, string> = {
  horizontal_press: 'Press',
  vertical_press: 'Vertical press',
  hinge: 'Hinge',
  squat: 'Squat',
  row: 'Row',
  pulldown: 'Pulldown',
  isolation: 'Isolation',
};

function normalizedTitle(title: string) {
  return title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function inferSlotPattern(title: string): SlotPattern {
  const value = normalizedTitle(title);
  if (/shoulder press|overhead press|military press|arnold press/.test(value)) {
    return 'vertical_press';
  }
  if (/pulldown|pull up|chin up|assisted pull/.test(value)) {
    return 'pulldown';
  }
  if (/row|rear delt row/.test(value)) return 'row';
  if (
    /deadlift|romanian|rdl|good morning|hip thrust|back extension/.test(value)
  ) {
    return 'hinge';
  }
  if (/squat|leg press|hack squat|lunge|split squat|step up/.test(value)) {
    return 'squat';
  }
  if (/press|bench|chest fly|pec deck|dip/.test(value)) {
    return 'horizontal_press';
  }
  return 'isolation';
}

function suggestionName(primaryMuscle: Muscle, pattern: SlotPattern) {
  const muscle = muscleLabel(primaryMuscle);
  return `${muscle} ${PATTERN_LABELS[pattern]}`;
}

export function suggestSlots(templates: ExerciseTemplate[]): SlotSuggestion[] {
  const groups = new Map<string, SlotSuggestion>();
  for (const template of templates) {
    const primaryMuscle = resolveMuscles(template).primary;
    const pattern = inferSlotPattern(template.title);
    const key = `${primaryMuscle}:${pattern}`;
    const existing = groups.get(key);
    if (existing) {
      existing.templateIds.push(template.id);
      existing.exerciseTitles.push(template.title);
      continue;
    }
    groups.set(key, {
      key,
      name: suggestionName(primaryMuscle, pattern),
      primaryMuscle,
      pattern,
      templateIds: [template.id],
      exerciseTitles: [template.title],
    });
  }
  return [...groups.values()]
    .filter((suggestion) => suggestion.templateIds.length >= 2)
    .sort((a, b) => a.name.localeCompare(b.name));
}
