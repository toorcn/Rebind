import Database from "better-sqlite3";

export interface AgentRecord {
  agentKey: string;
  humanRef: string;
  registeredAt: number;
  revoked: boolean;
  revokedAt: number | null;
  rotatedFrom: string | null;
  rotatedTo: string | null;
  rotatedAt: number | null;
  /** Always null on Day 0. Day 1 requires a fresh World/AgentBook proof here. */
  worldRebind: string | null;
}

interface AgentRow {
  agent_key: string;
  human_ref: string;
  registered_at: number;
  revoked: number;
  revoked_at: number | null;
  rotated_from: string | null;
  rotated_to: string | null;
  rotated_at: number | null;
  world_rebind: string | null;
}

const SELECT_ROW = `
  SELECT agent_key, human_ref, registered_at, revoked, revoked_at,
         rotated_from, rotated_to, rotated_at, world_rebind
  FROM agents
`;

function toRecord(row: AgentRow): AgentRecord {
  return {
    agentKey: row.agent_key,
    humanRef: row.human_ref,
    registeredAt: row.registered_at,
    revoked: row.revoked === 1,
    revokedAt: row.revoked_at,
    rotatedFrom: row.rotated_from,
    rotatedTo: row.rotated_to,
    rotatedAt: row.rotated_at,
    worldRebind: row.world_rebind,
  };
}

/**
 * App-layer AgentBook-shaped registry.
 * register / lookup / revoke / rotate all work.
 * The Day 0 paygate does not consult revoke or rotate when granting.
 */
export class AgentBookRegistry {
  private readonly db: Database.Database;

  constructor(dbPath: string = ":memory:") {
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        agent_key TEXT PRIMARY KEY,
        human_ref TEXT NOT NULL,
        registered_at INTEGER NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0,
        revoked_at INTEGER,
        rotated_from TEXT,
        rotated_to TEXT,
        rotated_at INTEGER,
        world_rebind TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_human_ref ON agents(human_ref);
    `);
  }

  register(agentKey: string, humanRef: string): AgentRecord {
    const existing = this.lookup(agentKey);
    if (existing) {
      throw new Error(`Agent key already registered: ${agentKey}`);
    }

    this.db
      .prepare(
        `INSERT INTO agents (agent_key, human_ref, registered_at)
         VALUES (?, ?, ?)`
      )
      .run(agentKey, humanRef, Date.now());

    const created = this.lookup(agentKey);
    if (!created) {
      throw new Error("Register failed");
    }
    return created;
  }

  lookup(agentKey: string): AgentRecord | null {
    const row = this.db
      .prepare(`${SELECT_ROW} WHERE agent_key = ?`)
      .get(agentKey) as AgentRow | undefined;
    return row ? toRecord(row) : null;
  }

  /** Flips the revoked flag. Does not by itself stop grants — the paygate ignores it. */
  revoke(agentKey: string): AgentRecord {
    const existing = this.lookup(agentKey);
    if (!existing) {
      throw new Error(`Agent key not found: ${agentKey}`);
    }

    this.db
      .prepare(
        `UPDATE agents SET revoked = 1, revoked_at = ? WHERE agent_key = ?`
      )
      .run(Date.now(), agentKey);

    const updated = this.lookup(agentKey);
    if (!updated) {
      throw new Error("Revoke failed");
    }
    return updated;
  }

  /**
   * Points oldKey → newKey and registers newKey for the same human.
   * Does not attach a World re-bind proof. Day 0 paygate still accepts both keys.
   */
  rotate(oldKey: string, newKey: string): { oldRecord: AgentRecord; newRecord: AgentRecord } {
    const oldRecord = this.lookup(oldKey);
    if (!oldRecord) {
      throw new Error(`Agent key not found: ${oldKey}`);
    }
    if (oldKey === newKey) {
      throw new Error("oldKey and newKey must differ");
    }
    if (this.lookup(newKey)) {
      throw new Error(`Agent key already registered: ${newKey}`);
    }

    const rotateTx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE agents SET rotated_to = ?, rotated_at = ? WHERE agent_key = ?`
        )
        .run(newKey, Date.now(), oldKey);

      this.db
        .prepare(
          `INSERT INTO agents (agent_key, human_ref, registered_at, rotated_from)
           VALUES (?, ?, ?, ?)`
        )
        .run(newKey, oldRecord.humanRef, Date.now(), oldKey);
    });

    rotateTx();

    const updatedOld = this.lookup(oldKey);
    const createdNew = this.lookup(newKey);
    if (!updatedOld || !createdNew) {
      throw new Error("Rotate failed");
    }
    return { oldRecord: updatedOld, newRecord: createdNew };
  }

  listAll(): AgentRecord[] {
    const rows = this.db
      .prepare(`${SELECT_ROW} ORDER BY registered_at ASC`)
      .all() as AgentRow[];
    return rows.map(toRecord);
  }

  close(): void {
    this.db.close();
  }
}
