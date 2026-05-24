import type { HealthStatus } from "@zmail/shared";

export async function fetchHealth(fetcher: typeof fetch = fetch): Promise<HealthStatus> {
  const response = await fetcher("/api/health");

  return response.json();
}
