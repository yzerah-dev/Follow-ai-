/**
 * Tests d'isolation multi-tenant (Row Level Security) sur PostgreSQL réel.
 * Deux organisations de démonstration : A (alice owner, bruno commercial, diane lecture seule) et B (chloé owner).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { withDb, withUser, withAgent } from "@/lib/database/client";
import { resetTestDb, ids, privileged } from "./db";

let I: Awaited<ReturnType<typeof ids>>;

const TENANT_TABLES = [
  "customers", "contacts", "customer_contacts", "products", "product_images", "product_prices", "inventory_snapshots", "invoices",
  "invoice_lines", "campaigns", "campaign_products", "opportunities", "offers", "offer_lines", "conversations", "messages",
  "communication_connections", "agent_memory", "agent_runs", "agent_decisions", "creative_templates", "organization_settings",
  "organization_members", "approvals", "followup_tasks", "generated_assets", "imports", "suppression_entries",
];

beforeAll(async () => {
  await resetTestDb();
  I = await ids();
});

const expectDenied = async (p: Promise<unknown>, pattern = /row-level security|violates|permission denied|not allowed/i) => {
  await expect(p).rejects.toThrow(pattern);
};

describe("Isolation entre organisations", () => {
  it("chaque table métier est visible uniquement par son organisation", async () => {
    for (const table of TENANT_TABLES) {
      const total = await privileged(async (c) => (await c.query<{ n: number }>(`select count(*)::int n from ${table} where organization_id = $1`, [I.orgB])).rows[0]!.n);
      const seenByA = await withUser(I.bruno, async (db) => (await db.query<{ n: number }>(`select count(*)::int n from ${table} where organization_id = $1`, [I.orgB])).rows[0]!.n);
      expect(seenByA, `${table} : fuite vers l'organisation A`).toBe(0);
      if (total > 0) {
        const seenByB = await withUser(I.chloe, async (db) => (await db.query<{ n: number }>(`select count(*)::int n from ${table} where organization_id = $1`, [I.orgB])).rows[0]!.n);
        expect(seenByB, `${table} : B doit voir ses propres données`).toBe(total);
      }
    }
  });

  it("aucune organisation étrangère n'est listée", async () => {
    const orgs = await withUser(I.bruno, async (db) => (await db.query<{ id: string }>(`select id from organizations`)).rows.map((r) => r.id));
    expect(orgs).toEqual([I.orgA]);
  });

  it("impossible d'écrire dans une autre organisation", async () => {
    await expectDenied(withUser(I.bruno, (db) => db.query(`insert into customers (organization_id, legal_name) values ($1, 'Intrus')`, [I.orgB])));
    const updated = await withUser(I.bruno, async (db) => (await db.query(`update customers set legal_name = 'Piraté' where organization_id = $1`, [I.orgB])).rowCount);
    expect(updated).toBe(0);
    const deleted = await withUser(I.alice, async (db) => (await db.query(`delete from offers where organization_id = $1`, [I.orgB])).rowCount);
    expect(deleted).toBe(0);
  });

  it("impossible de déplacer une ligne vers une autre organisation", async () => {
    await expectDenied(withUser(I.alice, (db) => db.query(`update customers set organization_id = $1 where organization_id = $2`, [I.orgB, I.orgA])));
  });

  it("les clés étrangères composites empêchent les références inter-organisations", async () => {
    const foreignCustomer = await privileged(async (c) => (await c.query<{ id: string }>(`select id from customers where organization_id = $1 limit 1`, [I.orgB])).rows[0]!.id);
    await expectDenied(
      withUser(I.alice, (db) => db.query(`insert into invoices (organization_id, invoice_number, customer_id, invoice_date, total_ht, total_vat, total_ttc) values ($1,'X-1',$2,'2026-01-01',1,0.2,1.2)`, [I.orgA, foreignCustomer])),
      /foreign key|violates/i,
    );
  });

  it("la numérotation des documents est cloisonnée", async () => {
    await expectDenied(withUser(I.bruno, (db) => db.query(`select app.next_document_number($1, 'offer', 'OF')`, [I.orgB])));
  });
});

describe("Rôles", () => {
  it("lecture seule : lecture autorisée, écriture refusée", async () => {
    const n = await withUser(I.diane, async (db) => (await db.query<{ n: number }>(`select count(*)::int n from customers`)).rows[0]!.n);
    expect(n).toBe(100);
    await expectDenied(withUser(I.diane, (db) => db.query(`insert into customers (organization_id, legal_name) values ($1, 'Test')`, [I.orgA])));
    const upd = await withUser(I.diane, async (db) => (await db.query(`update customers set notes = 'x'`)).rowCount);
    expect(upd).toBe(0);
  });

  it("les prix d'achat ne sont visibles que par owner/admin/manager", async () => {
    const asCommercial = await withUser(I.bruno, async (db) => (await db.query(`select * from product_purchase_costs`)).rowCount);
    const asOwner = await withUser(I.alice, async (db) => (await db.query(`select * from product_purchase_costs`)).rowCount);
    const asAgent = await withAgent(I.orgA, async (db) => (await db.query(`select * from product_purchase_costs`)).rowCount);
    expect(asCommercial).toBe(0);
    expect(asAgent).toBe(0);
    expect(asOwner).toBeGreaterThan(0);
  });

  it("un commercial ne peut pas modifier les paramètres ni les membres", async () => {
    const r = await withUser(I.bruno, async (db) => (await db.query(`update organization_settings set max_auto_discount_pct = 50`)).rowCount);
    expect(r).toBe(0);
    await expectDenied(withUser(I.bruno, (db) => db.query(`insert into organization_members (organization_id, user_id, role) values ($1, $2, 'owner')`, [I.orgA, I.chloe])));
  });

  it("un utilisateur ne peut pas usurper l'auteur d'une entrée d'audit", async () => {
    await expectDenied(withUser(I.bruno, (db) => db.query(`insert into audit_logs (organization_id, actor_type, actor_user_id, action) values ($1,'user',$2,'spoof')`, [I.orgA, I.alice])));
  });

  it("le journal d'audit est en ajout seul", async () => {
    await expect(privileged((c) => c.query(`update audit_logs set action = 'x'`))).rejects.toThrow(/ajout seul/);
  });

  it("les secrets de connexion sont inaccessibles au rôle applicatif", async () => {
    await expectDenied(withUser(I.alice, (db) => db.query(`select * from connection_secrets`)), /permission denied/i);
  });

  it("un utilisateur sans claims ne voit rien", async () => {
    const pool = (await import("@/lib/database/pool")).pool();
    const c = await pool.connect();
    try {
      await c.query("begin; set local role authenticated;");
      const n = (await c.query<{ n: number }>(`select count(*)::int n from customers`)).rows[0]!.n;
      expect(n).toBe(0);
    } finally {
      await c.query("rollback");
      c.release();
    }
  });
});

describe("Agent LÉA (jobs serveur)", () => {
  it("l'agent ne voit que son organisation", async () => {
    const seen = await withAgent(I.orgA, async (db) => (await db.query<{ org: string }>(`select distinct organization_id as org from customers`)).rows.map((r) => r.org));
    expect(seen).toEqual([I.orgA]);
  });

  it("l'agent peut demander une validation mais jamais la décider", async () => {
    const offerId = await withAgent(I.orgA, async (db) => (await db.query<{ id: string }>(`select id from customers limit 1`)).rows[0]!.id);
    await withAgent(I.orgA, (db) => db.query(`insert into approvals (organization_id, subject_type, subject_id, summary, requested_by_agent) values ($1,'offer',$2,'test',true)`, [I.orgA, offerId]));
    const decided = await withAgent(I.orgA, async (db) => (await db.query(`update approvals set status = 'approved', decided_at = now() where status = 'pending'`)).rowCount);
    expect(decided).toBe(0);
    await expectDenied(withAgent(I.orgA, (db) => db.query(`insert into approvals (organization_id, subject_type, subject_id, summary, status, decided_at) values ($1,'offer',$2,'auto',  'approved', now())`, [I.orgA, offerId])));
  });

  it("un claim agent ne peut pas être combiné à une identité utilisateur", async () => {
    const pool = (await import("@/lib/database/pool")).pool();
    // sub (Bruno, org A) + agent_org (B) : l'accès agent est ignoré dès qu'un utilisateur est présent
    const seen = await withDb({ kind: "user", userId: I.bruno }, async (db) => {
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: I.bruno, agent_org: I.orgB })]);
      return (await db.query<{ n: number }>(`select count(*)::int n from customers where organization_id = $1`, [I.orgB])).rows[0]!.n;
    }, pool);
    expect(seen).toBe(0);
  });
});
