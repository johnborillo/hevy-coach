# Hevy Coach

A private training-intelligence companion for Hevy. It keeps Hevy as the workout logger and adds progress analysis, time-boxed workout planning, and evidence-first coaching.

## Run locally

1. Copy `.env.example` to `.env.local`.
2. Add your Hevy Pro API key as `HEVY_API_KEY`.
3. Run `npm install` and `npm run dev`.

The app shows a clearly marked sample workspace until a key is configured.

## Security

Real secrets belong in `.env.local` or the hosting provider's encrypted environment settings. Never commit the API key or place it in browser code.

## Current scope

- Reads up to 120 recent workouts and the available exercise templates.
- Calculates progress, training distribution, workout frequency, and session duration.
- Builds time-boxed workout drafts from exercise history.
- Provides deterministic, evidence-first coaching summaries.

Routine write-back and a generative coach are intentionally deferred until the read-only connection has been validated against real data.
