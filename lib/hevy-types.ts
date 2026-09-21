export type HevySet = {
  index?: number;
  type?: string;
  weight_kg?: number | null;
  reps?: number | null;
  rpe?: number | null;
  duration_seconds?: number | null;
  distance_meters?: number | null;
};

export type HevyExercise = {
  title: string;
  exercise_template_id: string;
  notes?: string | null;
  sets: HevySet[];
};

export type HevyWorkout = {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  description?: string | null;
  updated_at?: string;
  exercises: HevyExercise[];
};

export type ExerciseTemplate = {
  id: string;
  title: string;
  primary_muscle_group?: string;
  secondary_muscle_groups?: string[];
  equipment?: string;
  is_custom?: boolean;
};
