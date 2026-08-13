export type PlanSummary = {
  reference: string;
  title: string;
  description: string;
  tags: string[];
  status: "Draft" | "In Progress" | "Done" | "Closed";
};

export class PlannerApiClient {
  constructor(
    private readonly baseUrl = process.env.PLANNER_API_URL ?? "http://127.0.0.1:3000",
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async listPlans(): Promise<PlanSummary[]> {
    const response = await this.fetcher(`${this.baseUrl}/plans`);
    if (!response.ok) throw new Error(`Planner API returned ${response.status}: ${await response.text()}`);
    const result = await response.json() as { plans?: PlanSummary[] };
    if (!Array.isArray(result.plans)) throw new Error("Planner API returned an invalid plan list");
    return result.plans;
  }
}
