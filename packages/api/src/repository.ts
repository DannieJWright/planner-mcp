import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { planSchema, type Component, type Plan, type PlanSummary, type StatusItem, type TextItem } from "./domain.js";

type PlanRow = {
  reference: string;
  title: string;
  description: string;
  tags: string;
  status: Plan["status"];
};

type ComponentRow = {
  id: number;
  ref: string;
  title: string;
  description: string;
};

type ItemRow = {
  kind: string;
  ref: string;
  title: string;
  details: string;
  status: StatusItem["status"] | null;
};

const itemFields = {
  requirement: "requirements",
  constraint: "constraints",
  decision: "decisions",
  knowledge_gap: "knowledgeGaps",
  finding: "findings",
  note: "notes",
  question: "questions",
} as const;

export class PlanRepository {
  readonly database: DatabaseSync;

  constructor(filename = process.env.PLANNER_DB_PATH ?? "planner.sqlite") {
    this.database = new DatabaseSync(filename);
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS plans (
        reference TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        tags TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS components (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_reference TEXT NOT NULL REFERENCES plans(reference) ON DELETE CASCADE,
        ref TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        position INTEGER NOT NULL,
        UNIQUE(plan_reference, ref)
      );
      CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        component_id INTEGER NOT NULL REFERENCES components(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        ref TEXT NOT NULL,
        title TEXT NOT NULL,
        details TEXT NOT NULL,
        status TEXT,
        position INTEGER NOT NULL
      );
    `);
  }

  save(planInput: Plan): string {
    const plan = planSchema.parse(planInput);
    const reference = plan.reference === "New" ? `PLAN-${randomUUID()}` : plan.reference;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        INSERT INTO plans(reference, title, description, tags, status)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(reference) DO UPDATE SET
          title = excluded.title,
          description = excluded.description,
          tags = excluded.tags,
          status = excluded.status,
          updated_at = CURRENT_TIMESTAMP
      `).run(reference, plan.title, plan.description, JSON.stringify(plan.tags), plan.status);
      this.database.prepare("DELETE FROM components WHERE plan_reference = ?").run(reference);
      const insertComponent = this.database.prepare(`
        INSERT INTO components(plan_reference, ref, title, description, position)
        VALUES (?, ?, ?, ?, ?)
      `);
      const insertItem = this.database.prepare(`
        INSERT INTO items(component_id, kind, ref, title, details, status, position)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      plan.components.forEach((component, componentPosition) => {
        const result = insertComponent.run(reference, component.ref, component.title, component.description, componentPosition);
        const groups: Array<[keyof typeof itemFields, Array<TextItem | StatusItem>]> = [
          ["requirement", component.requirements],
          ["constraint", component.constraints],
          ["decision", component.decisions],
          ["knowledge_gap", component.knowledgeGaps],
          ["finding", component.findings],
          ["note", component.notes],
          ["question", component.questions],
        ];
        groups.forEach(([kind, items]) => items.forEach((item, position) => {
          insertItem.run(result.lastInsertRowid, kind, item.ref, item.title, item.details, "status" in item ? item.status : null, position);
        }));
      });
      this.database.exec("COMMIT");
      return reference;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  list(): PlanSummary[] {
    const rows = this.database.prepare("SELECT reference, title, description, tags, status FROM plans ORDER BY updated_at DESC, reference").all() as unknown as PlanRow[];
    return rows.map((row) => ({ ...row, tags: JSON.parse(row.tags) as string[] }));
  }

  get(reference: string): Plan | undefined {
    const row = this.database.prepare("SELECT reference, title, description, tags, status FROM plans WHERE reference = ?").get(reference) as PlanRow | undefined;
    if (!row) return undefined;
    const componentRows = this.database.prepare("SELECT id, ref, title, description FROM components WHERE plan_reference = ? ORDER BY position").all(reference) as unknown as ComponentRow[];
    const components = componentRows.map((componentRow): Component => {
      const component: Component = {
        ref: componentRow.ref,
        title: componentRow.title,
        description: componentRow.description,
        requirements: [],
        constraints: [],
        decisions: [],
        knowledgeGaps: [],
        findings: [],
        notes: [],
        questions: [],
      };
      const items = this.database.prepare("SELECT kind, ref, title, details, status FROM items WHERE component_id = ? ORDER BY kind, position").all(componentRow.id) as unknown as ItemRow[];
      for (const item of items) {
        const field = itemFields[item.kind as keyof typeof itemFields];
        if (!field) throw new Error(`Unknown item kind in database: ${item.kind}`);
        if (field === "decisions" || field === "knowledgeGaps") {
          component[field].push({ ref: item.ref, title: item.title, details: item.details, status: item.status! });
        } else {
          component[field].push({ ref: item.ref, title: item.title, details: item.details });
        }
      }
      return component;
    });
    return planSchema.parse({ ...row, tags: JSON.parse(row.tags), components });
  }

  close(): void {
    this.database.close();
  }
}
