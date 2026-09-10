import { TrainingDashboard } from '@/components/training-dashboard';
import { getDashboardData } from '@/lib/hevy';

export const revalidate = 300;

export default async function Home() {
  const data = await getDashboardData();

  return <TrainingDashboard data={data} />;
}
