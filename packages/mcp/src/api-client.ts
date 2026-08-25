export type PlanSummary = {
  reference: string;
  title: string;
  description: string;
  tags: string[];
  status: "Draft" | "In Progress" | "Done" | "Closed";
};

export type PlanValidationFailures = {
  ordering: Array<{ section: string; failure: string }>;
};

export type ReferenceChange =
  | { change: "renamed"; kind: string; from: string; to: string }
  | { change: "added"; kind: string; to: string; handle?: string; title: string; parent?: string }
  | { change: "removed"; kind: string; from: string };

export type ReferenceChanges = {
  shifted: boolean;
  changes: ReferenceChange[];
};

export type PlanWriteResult = {
  reference: string;
  validationFailures: PlanValidationFailures;
  referenceChanges: ReferenceChanges;
};

export type ItemGroup = {
  ref: string;
  title: string;
  items: Array<{ ref: string; title: string; details: string; status: string; findings?: string }>;
};

export type ItemQueryResult = {
  plan: { reference: string; title: string };
  components: ItemGroup[];
};

export type ItemQueryOptions = {
  status?: string;
  format?: "json" | "markdown";
};

const markdownHeaders = { "content-type": "text/markdown" };

export class PlannerApiClient {
  constructor(
    private readonly baseUrl = process.env.PLANNER_API_URL ?? "http://127.0.0.1:3000",
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async expectOk(response: Response): Promise<Response> {
    if (!response.ok) throw new Error(`Planner API returned ${response.status}: ${await response.text()}`);
    return response;
  }

  private itemQueryUrl(path: string, reference: string, options: ItemQueryOptions | undefined): string {
    const query = new URLSearchParams();
    if (options?.status) query.set("status", options.status);
    if (options?.format) query.set("format", options.format);
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return `${this.baseUrl}/plans/${encodeURIComponent(reference)}/${path}${suffix}`;
  }

  private async fetchItems(path: string, reference: string, options?: ItemQueryOptions): Promise<ItemQueryResult | string> {
    const response = await this.expectOk(await this.fetcher(this.itemQueryUrl(path, reference, options)));
    if (options?.format === "markdown") return response.text();
    return await response.json() as ItemQueryResult;
  }

  async listPlans(): Promise<PlanSummary[]> {
    const response = await this.fetcher(`${this.baseUrl}/plans`);
    if (!response.ok) throw new Error(`Planner API returned ${response.status}: ${await response.text()}`);
    const result = await response.json() as { plans?: PlanSummary[] };
    if (!Array.isArray(result.plans)) throw new Error("Planner API returned an invalid plan list");
    return result.plans;
  }

  async deletePlan(reference: string): Promise<void> {
    const response = await this.fetcher(`${this.baseUrl}/plans/${encodeURIComponent(reference)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(`Planner API returned ${response.status}: ${await response.text()}`);
  }

  /** Full-document ingest: `PUT /plans`. Creates a plan when the frontmatter reference is `New`. */
  async uploadPlan(markdown: string): Promise<PlanWriteResult> {
    const response = await this.expectOk(await this.fetcher(`${this.baseUrl}/plans`, { method: "PUT", headers: markdownHeaders, body: markdown }));
    return await response.json() as PlanWriteResult;
  }

  /** Partial-document merge: `PATCH /plans/:reference`. */
  async patchPlan(reference: string, markdown: string): Promise<PlanWriteResult> {
    const response = await this.expectOk(await this.fetcher(`${this.baseUrl}/plans/${encodeURIComponent(reference)}`, { method: "PATCH", headers: markdownHeaders, body: markdown }));
    return await response.json() as PlanWriteResult;
  }

  async removeComponent(reference: string, componentRef: string): Promise<PlanWriteResult> {
    const response = await this.expectOk(await this.fetcher(
      `${this.baseUrl}/plans/${encodeURIComponent(reference)}/components/${encodeURIComponent(componentRef)}`,
      { method: "DELETE" },
    ));
    return await response.json() as PlanWriteResult;
  }

  async listKnowledgeGaps(reference: string, options?: ItemQueryOptions): Promise<ItemQueryResult | string> {
    return this.fetchItems("knowledge-gaps", reference, options);
  }

  async listDecisions(reference: string, options?: ItemQueryOptions): Promise<ItemQueryResult | string> {
    return this.fetchItems("decisions", reference, options);
  }
}
