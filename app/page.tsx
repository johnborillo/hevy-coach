import { TrainingDashboard } from '@/components/training-dashboard';
import { getDashboardData } from '@/lib/hevy';
import { requestUserId } from '@/lib/request-user';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const data = await getDashboardData(requestUserId(await headers()));

  return <TrainingDashboard data={data} />;
}
