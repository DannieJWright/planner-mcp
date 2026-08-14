import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { planSchema, type ActionItem, type Component, type Plan, type PlanSummary, type StatusItem, type TextItem } from "./domain.js";

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
  id: number;
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
      CREATE TABLE IF NOT EXISTS knowledge_gap_findings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        knowledge_gap_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        ref TEXT NOT NULL,
        title TEXT NOT NULL,
        details TEXT NOT NULL,
        position INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS action_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_reference TEXT NOT NULL REFERENCES plans(reference) ON DELETE CASCADE,
        ref TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        context TEXT NOT NULL,
        position INTEGER NOT NULL,
        UNIQUE(plan_reference, ref)
      );
      CREATE TABLE IF NOT EXISTS action_acceptance_criteria (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action_item_id INTEGER NOT NULL REFERENCES action_items(id) ON DELETE CASCADE,
        ref TEXT NOT NULL,
        title TEXT NOT NULL,
        details TEXT NOT NULL,
        position INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS action_trigger_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action_item_id INTEGER NOT NULL REFERENCES action_items(id) ON DELETE CASCADE,
        ref TEXT NOT NULL,
        title TEXT NOT NULL,
        position INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS action_assignees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action_item_id INTEGER NOT NULL REFERENCES action_items(id) ON DELETE CASCADE,
        assignee TEXT NOT NULL,
        position INTEGER NOT NULL
      );
      UPDATE items SET kind = 'note' WHERE kind = 'finding';
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
      this.database.prepare("DELETE FROM action_items WHERE plan_reference = ?").run(reference);
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
          ["note", component.notes],
          ["question", component.questions],
        ];
        groups.forEach(([kind, items]) => items.forEach((item, position) => {
          insertItem.run(result.lastInsertRowid, kind, item.ref, item.title, item.details, "status" in item ? item.status : null, position);
        }));
        component.knowledgeGaps.forEach((gap, position) => {
          const gapResult = insertItem.run(result.lastInsertRowid, "knowledge_gap", gap.ref, gap.title, gap.details, gap.status, position);
          this.database.prepare(`
            INSERT INTO knowledge_gap_findings(knowledge_gap_id, ref, title, details, position)
            VALUES (?, ?, ?, ?, ?)
          `).run(gapResult.lastInsertRowid, "findings", "Findings", gap.findings, 0);
        });
      });
      const insertAction = this.database.prepare(`
        INSERT INTO action_items(plan_reference, ref, title, status, context, position)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      plan.actionItems.forEach((action, position) => {
        const actionResult = insertAction.run(reference, action.ref, action.title, action.status, action.context, position);
        action.acceptanceCriteria.forEach((criterion, itemPosition) => this.database.prepare(`
          INSERT INTO action_acceptance_criteria(action_item_id, ref, title, details, position) VALUES (?, ?, ?, ?, ?)
        `).run(actionResult.lastInsertRowid, criterion.ref, criterion.title, criterion.details, itemPosition));
        action.triggerSources.forEach((source, itemPosition) => this.database.prepare(`
          INSERT INTO action_trigger_sources(action_item_id, ref, title, position) VALUES (?, ?, ?, ?)
        `).run(actionResult.lastInsertRowid, source.ref, source.title, itemPosition));
        action.assignees.forEach((assignee, itemPosition) => this.database.prepare(`
          INSERT INTO action_assignees(action_item_id, assignee, position) VALUES (?, ?, ?)
        `).run(actionResult.lastInsertRowid, assignee, itemPosition));
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
        notes: [],
        questions: [],
      };
      const items = this.database.prepare("SELECT id, kind, ref, title, details, status FROM items WHERE component_id = ? ORDER BY kind, position").all(componentRow.id) as unknown as ItemRow[];
      for (const item of items) {
        const field = itemFields[item.kind as keyof typeof itemFields];
        if (!field) throw new Error(`Unknown item kind in database: ${item.kind}`);
        if (field === "knowledgeGaps") {
          const findings = (this.database.prepare("SELECT details FROM knowledge_gap_findings WHERE knowledge_gap_id = ? ORDER BY position").all(item.id) as unknown as Array<{ details: string }>).map(({ details }) => details).join("\n\n");
          component.knowledgeGaps.push({ ref: item.ref, title: item.title, details: item.details, status: item.status! as Component["knowledgeGaps"][number]["status"], findings });
        } else if (field === "decisions") {
          component[field].push({ ref: item.ref, title: item.title, details: item.details, status: item.status! as Component["decisions"][number]["status"] });
        } else {
          component[field].push({ ref: item.ref, title: item.title, details: item.details });
        }
      }
      return component;
    });
    const actionRows = this.database.prepare("SELECT id, ref, title, status, context FROM action_items WHERE plan_reference = ? ORDER BY position").all(reference) as unknown as Array<ActionItem & { id: number }>;
    const actionItems = actionRows.map((action): ActionItem => ({
      ref: action.ref,
      title: action.title,
      status: action.status,
      context: action.context,
      acceptanceCriteria: this.database.prepare("SELECT ref, title, details FROM action_acceptance_criteria WHERE action_item_id = ? ORDER BY position").all(action.id) as unknown as TextItem[],
      triggerSources: this.database.prepare("SELECT ref, title FROM action_trigger_sources WHERE action_item_id = ? ORDER BY position").all(action.id) as unknown as ActionItem["triggerSources"],
      assignees: (this.database.prepare("SELECT assignee FROM action_assignees WHERE action_item_id = ? ORDER BY position").all(action.id) as unknown as Array<{ assignee: string }>).map(({ assignee }) => assignee),
    }));
    return planSchema.parse({ ...row, tags: JSON.parse(row.tags), components, actionItems });
  }

  delete(reference: string): boolean {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database.prepare("DELETE FROM plans WHERE reference = ?").run(reference);
      this.database.exec("COMMIT");
      return result.changes > 0;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.database.close();
  }
}
