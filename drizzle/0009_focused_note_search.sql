CREATE VIRTUAL TABLE IF NOT EXISTS `hevy_notes_fts` USING fts5(
  `user_id` UNINDEXED,
  `workout_id` UNINDEXED,
  `exercise_template_id` UNINDEXED,
  `exercise_title` UNINDEXED,
  `workout_date` UNINDEXED,
  `workout_title` UNINDEXED,
  `content`,
  tokenize = 'unicode61'
);--> statement-breakpoint
INSERT INTO `hevy_notes_fts` (user_id, workout_id, exercise_template_id, exercise_title, workout_date, workout_title, content)
SELECT user_id, id, NULL, NULL, substr(start_time, 1, 10), title, description
FROM hevy_workouts
WHERE deleted = 0 AND description IS NOT NULL AND trim(description) <> '';--> statement-breakpoint
INSERT INTO `hevy_notes_fts` (user_id, workout_id, exercise_template_id, exercise_title, workout_date, workout_title, content)
SELECT w.user_id, w.id,
  json_extract(exercise.value, '$.exercise_template_id'),
  json_extract(exercise.value, '$.title'),
  substr(w.start_time, 1, 10), w.title,
  json_extract(exercise.value, '$.notes')
FROM hevy_workouts AS w
JOIN json_each(w.raw_json, '$.exercises') AS exercise
WHERE w.deleted = 0
  AND json_extract(exercise.value, '$.notes') IS NOT NULL
  AND trim(json_extract(exercise.value, '$.notes')) <> '';
