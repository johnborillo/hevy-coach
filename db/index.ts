import { env } from 'cloudflare:workers';

export function getDatabase() {
  if (!env.DB) {
    throw new Error('The private workout database is unavailable.');
  }

  return env.DB;
}
