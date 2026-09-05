import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { planSchema, type ActionItem, type Component, type Plan, type PlanSummary, type TextItem } from "./domain.js";
import type { ItemRowValues } from "./models/descriptor.js";
import { newPlanReference, planRefPrefix } from "./models/plan.js";
import { componentDescriptor } from "./models/component.js";
import { persistedItemSectionsFor } from "./models/registry.js";

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

type ItemRow = ItemRowValues & { id: number; kind: string };

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
    const reference = plan.reference === newPlanReference ? `${planRefPrefix}${randomUUID()}` : plan.reference;
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
      const insertFinding = this.database.prepare(`
        INSERT INTO knowledge_gap_findings(knowledge_gap_id, ref, title, details, position)
        VALUES (?, ?, ?, ?, ?)
      `);
      plan.components.forEach((component, componentPosition) => {
        const result = insertComponent.run(reference, component.ref, component.title, component.description, componentPosition);
        // The `items` table joins to components by foreign key, so only sections owned by
        // a component can be stored in it here. A heading-item section on another node type
        // that must persist declares its own table and row mapping (see docs/MODELS.md).
        const record = component as unknown as Record<string, Array<Record<string, unknown>>>;
        for (const section of persistedItemSectionsFor(componentDescriptor)) {
          record[section.key]!.forEach((item, position) => {
            const values = section.model.toRow(item);
            const inserted = insertItem.run(
              result.lastInsertRowid,
              section.dbKind!,
              values.ref,
              values.title,
              values.details,
              values.status,
              position,
            );
            // A nested prose subsection is stored as a single named row, so its
            // heading text never has to be spelled here.
            section.subsections.forEach((subsection, subsectionPosition) => {
              insertFinding.run(
                inserted.lastInsertRowid,
                subsection.key,
                subsection.heading,
                (item[subsection.key] as string | undefined) ?? "",
                subsectionPosition,
              );
            });
          });
        }
      });
      // TODO(action-items): action-item section persistence is hard-coded per table below,
      // not descriptor-driven like component items. A heading-item section registered on an
      // action item with a dbKind shows up in persistedItemSections() but is silently dropped
      // here and on read-back; making it persist needs its own DDL plus save/get row mapping,
      // or this block generalized the way component persistence already is (docs/MODELS.md).
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
    const findingsStatement = this.database.prepare(
      "SELECT ref, details FROM knowledge_gap_findings WHERE knowledge_gap_id = ? ORDER BY position",
    );
    // Rows in `items` can only carry the persistence kinds of sections owned by a
    // component; anything else is unknown to this table and reported as such.
    const persistedSections = persistedItemSectionsFor(componentDescriptor);
    const sectionsByKind = new Map(persistedSections.map((section) => [section.dbKind!, section]));
    const components = componentRows.map((componentRow): Component => {
      const record: Record<string, unknown> = {
        ref: componentRow.ref,
        title: componentRow.title,
        description: componentRow.description,
      };
      for (const section of persistedSections) record[section.key] = [];

      const items = this.database
        .prepare("SELECT id, kind, ref, title, details, status FROM items WHERE component_id = ? ORDER BY kind, position")
        .all(componentRow.id) as unknown as ItemRow[];
      for (const item of items) {
        const section = sectionsByKind.get(item.kind);
        if (!section) throw new Error(`Unknown item kind in database: ${item.kind}`);
        const subsections: Record<string, string[]> = {};
        if (section.subsections.length > 0) {
          for (const subsection of section.subsections) subsections[subsection.key] = [];
          // Rows written before subsections were named carry an item-style ref such as
          // `1.A.2`. They belong to the section's first subsection, which is what the
          // pre-refactor reader assumed for every row it found.
          const fallback = section.subsections[0]!.key;
          const rows = findingsStatement.all(item.id) as unknown as Array<{ ref: string; details: string }>;
          for (const row of rows) {
            const key = section.subsections.some((subsection) => subsection.key === row.ref) ? row.ref : fallback;
            subsections[key]!.push(row.details);
          }
        }
        (record[section.key] as unknown[]).push(section.model.fromRow(item, subsections));
      }
      return record as unknown as Component;
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
