import { getProfile, saveProfile, type AthleteProfile } from '@/lib/storage';
import { requestUserId } from '@/lib/request-user';

export const dynamic = 'force-dynamic';

function optionalNumber(value: unknown, min: number, max: number) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max
    ? Math.round(number)
    : null;
}

function optionalDecimal(value: unknown, min: number, max: number) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max
    ? Math.round(number * 100) / 100
    : null;
}

function increment(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 50
    ? number
    : fallback;
}

function cleanProfile(value: Partial<AthleteProfile>): AthleteProfile {
  return {
    displayName: String(value.displayName || 'Athlete').slice(0, 80),
    biologicalSex: ['female', 'male', 'intersex', 'prefer_not_to_say'].includes(
      String(value.biologicalSex),
    )
      ? String(value.biologicalSex)
      : 'prefer_not_to_say',
    age: optionalNumber(value.age, 13, 100),
    heightCm: optionalDecimal(value.heightCm, 100, 250),
    weightKg: optionalDecimal(value.weightKg, 30, 350),
    weightUnit: value.weightUnit === 'kg' ? 'kg' : 'lb',
    heightUnit: value.heightUnit === 'metric' ? 'metric' : 'imperial',
    experience: ['beginner', 'intermediate', 'advanced'].includes(
      String(value.experience),
    )
      ? String(value.experience)
      : 'intermediate',
    primaryGoal: String(value.primaryGoal || 'Build muscle and strength').slice(
      0,
      300,
    ),
    targetDate: String(value.targetDate || '').slice(0, 20),
    daysPerWeek: optionalNumber(value.daysPerWeek, 1, 7) ?? 4,
    minutesPerSession: optionalNumber(value.minutesPerSession, 20, 180) ?? 60,
    equipment: String(value.equipment || 'Full gym').slice(0, 400),
    limitations: String(value.limitations || '').slice(0, 1000),
    preferences: String(value.preferences || '').slice(0, 1000),
    phase: ['cut', 'maintain', 'lean_gain', 'gain', 'recomp'].includes(
      String(value.phase),
    )
      ? (String(value.phase) as AthleteProfile['phase'])
      : 'maintain',
    phaseStartedAt: String(value.phaseStartedAt || '').slice(0, 20),
    dailyCalories: optionalNumber(value.dailyCalories, 500, 20_000),
    proteinGrams: optionalNumber(value.proteinGrams, 20, 500),
    sleepHoursTypical: optionalDecimal(value.sleepHoursTypical, 0, 24),
    dropsetWeight: optionalDecimal(value.dropsetWeight, 0, 1) ?? 0.5,
    loadIncrements: {
      barbell: increment(value.loadIncrements?.barbell, 2.5),
      dumbbell: increment(value.loadIncrements?.dumbbell, 2),
      machine: increment(value.loadIncrements?.machine, 5),
      cable: increment(value.loadIncrements?.cable, 2.5),
    },
    timezone: String(value.timezone || 'UTC').slice(0, 80),
  };
}

export async function GET(request: Request) {
  try {
    return Response.json({
      profile: await getProfile(requestUserId(request.headers)),
    });
  } catch {
    return Response.json(
      { error: 'Profile storage is temporarily unavailable.' },
      { status: 503 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const profile = cleanProfile(await request.json());
    await saveProfile(requestUserId(request.headers), profile);
    return Response.json({ profile });
  } catch {
    return Response.json(
      { error: 'Profile could not be saved.' },
      { status: 400 },
    );
  }
}
