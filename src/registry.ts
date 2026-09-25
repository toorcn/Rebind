export interface AgentRecord {
  agentKey: string;
  humanRef: string;
  registeredAt: number;
  revoked: boolean;
  revokedAt: number | null;
  rotatedFrom: string | null;
  rotatedTo: string | null;
  rotatedAt: number | null;
  /** Null until the server validates a rebind. The client cannot set this. */
  worldRebind: string | null;
}

/**
 * App-layer AgentBook-shaped registry.
 * Lives in process memory. A new process starts empty.
 * register / lookup / revoke / rotate all work.
 */
export class AgentBookRegistry {
  private readonly agents = new Map<string, AgentRecord>();

  register(agentKey: string, humanRef: string): AgentRecord {
    const existing = this.lookup(agentKey);
    if (existing) {
      throw new Error(`Agent key already registered: ${agentKey}`);
    }

    const created: AgentRecord = {
      agentKey,
      humanRef,
      registeredAt: Date.now(),
      revoked: false,
      revokedAt: null,
      rotatedFrom: null,
      rotatedTo: null,
      rotatedAt: null,
      worldRebind: null,
    };
    this.agents.set(agentKey, created);
    return created;
  }

  lookup(agentKey: string): AgentRecord | null {
    return this.agents.get(agentKey) ?? null;
  }

  /** Flips the revoked flag. Does not by itself stop grants — the paygate decides. */
  revoke(agentKey: string): AgentRecord {
    const existing = this.lookup(agentKey);
    if (!existing) {
      throw new Error(`Agent key not found: ${agentKey}`);
    }

    const updated: AgentRecord = {
      ...existing,
      revoked: true,
      revokedAt: Date.now(),
    };
    this.agents.set(agentKey, updated);
    return updated;
  }

  /**
   * Points oldKey → newKey and registers newKey for the same human.
   * Does not attach a World re-bind proof.
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

    const rotatedAt = Date.now();
    const updatedOld: AgentRecord = {
      ...oldRecord,
      rotatedTo: newKey,
      rotatedAt,
    };
    const createdNew: AgentRecord = {
      agentKey: newKey,
      humanRef: oldRecord.humanRef,
      registeredAt: rotatedAt,
      revoked: false,
      revokedAt: null,
      rotatedFrom: oldKey,
      rotatedTo: null,
      rotatedAt: null,
      worldRebind: null,
    };
    this.agents.set(oldKey, updatedOld);
    this.agents.set(newKey, createdNew);
    return { oldRecord: updatedOld, newRecord: createdNew };
  }

  /**
   * Records a proof the server already validated. Refuses revoked keys and
   * keys that were not produced by rotate.
   */
  attachWorldRebind(agentKey: string, proof: string): AgentRecord {
    const existing = this.lookup(agentKey);
    if (!existing) {
      throw new Error(`Agent key not found: ${agentKey}`);
    }
    if (existing.revoked) {
      throw new Error("Revoked key cannot rebind");
    }
    if (!existing.rotatedFrom) {
      throw new Error("Rebind is only for a rotated-in key");
    }

    const updated: AgentRecord = { ...existing, worldRebind: proof };
    this.agents.set(agentKey, updated);
    return updated;
  }

  listAll(): AgentRecord[] {
    return [...this.agents.values()].sort((a, b) => a.registeredAt - b.registeredAt);
  }

  close(): void {
    this.agents.clear();
  }
}
