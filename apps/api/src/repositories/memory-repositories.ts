import { randomUUID } from "node:crypto";
import type {
  UserRepository,
  SessionRepository,
  WorkflowRepository,
  UserRecord,
  SessionRecord,
  WorkflowRecord
} from "./types.js";

export class InMemoryUserRepository implements UserRepository {
  private users = new Map<string, UserRecord>();

  async findByEmail(email: string): Promise<UserRecord | null> {
    const normalized = email.toLowerCase();
    for (const user of this.users.values()) {
      if (user.email === normalized) {
        return { ...user };
      }
    }
    return null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const user = this.users.get(id);
    return user ? { ...user } : null;
  }

  async create(data: {
    email: string;
    name?: string | null;
    passwordHash: string;
  }): Promise<UserRecord> {
    const normalized = data.email.toLowerCase();
    const existing = await this.findByEmail(normalized);
    if (existing) {
      const err = new Error("Unique constraint failed on the fields: (`email`)") as Error & {
        code?: string;
      };
      err.code = "P2002";
      throw err;
    }

    const now = new Date();
    const record: UserRecord = {
      id: randomUUID(),
      email: normalized,
      name: data.name ?? null,
      passwordHash: data.passwordHash,
      createdAt: now,
      updatedAt: now
    };
    this.users.set(record.id, record);
    return { ...record };
  }
}

export class InMemorySessionRepository implements SessionRepository {
  private sessionsByJti = new Map<string, SessionRecord>();

  async create(data: {
    jti: string;
    userId: string;
    expiresAt: Date;
  }): Promise<SessionRecord> {
    if (this.sessionsByJti.has(data.jti)) {
      const err = new Error("Unique constraint failed on the fields: (`jti`)") as Error & {
        code?: string;
      };
      err.code = "P2002";
      throw err;
    }

    const record: SessionRecord = {
      id: randomUUID(),
      jti: data.jti,
      userId: data.userId,
      expiresAt: new Date(data.expiresAt.getTime()),
      revokedAt: null,
      createdAt: new Date()
    };
    this.sessionsByJti.set(data.jti, record);
    return { ...record };
  }

  async findActiveByJti(jti: string, now: Date = new Date()): Promise<SessionRecord | null> {
    const record = this.sessionsByJti.get(jti);
    if (!record) {
      return null;
    }
    if (record.revokedAt !== null) {
      return null;
    }
    if (record.expiresAt.getTime() <= now.getTime()) {
      return null;
    }
    return { ...record };
  }

  async revokeByJti(jti: string): Promise<boolean> {
    const record = this.sessionsByJti.get(jti);
    if (!record || record.revokedAt !== null) {
      return false;
    }
    record.revokedAt = new Date();
    this.sessionsByJti.set(jti, record);
    return true;
  }
}

export class InMemoryWorkflowRepository implements WorkflowRepository {
  private workflows = new Map<string, WorkflowRecord>();

  async create(data: {
    userId: string;
    name: string;
    description?: string | null;
    draftDefinition?: unknown;
  }): Promise<WorkflowRecord> {
    const now = new Date();
    const defaultDraft = { schemaVersion: 1, nodes: [], edges: [] };
    const record: WorkflowRecord = {
      id: randomUUID(),
      userId: data.userId,
      name: data.name,
      description: data.description ?? null,
      draftDefinition: data.draftDefinition
        ? structuredClone(data.draftDefinition)
        : defaultDraft,
      deletedAt: null,
      createdAt: now,
      updatedAt: now
    };
    this.workflows.set(record.id, record);
    return { ...record };
  }

  async findActiveByUserId(userId: string): Promise<WorkflowRecord[]> {
    const list: WorkflowRecord[] = [];
    for (const wf of this.workflows.values()) {
      if (wf.userId === userId && wf.deletedAt === null) {
        list.push({ ...wf });
      }
    }
    return list.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async findActiveByIdAndUserId(id: string, userId: string): Promise<WorkflowRecord | null> {
    const wf = this.workflows.get(id);
    if (!wf || wf.userId !== userId || wf.deletedAt !== null) {
      return null;
    }
    return { ...wf };
  }

  async updateActiveByIdAndUserId(
    id: string,
    userId: string,
    data: {
      name?: string;
      description?: string | null;
      draftDefinition?: unknown;
    }
  ): Promise<WorkflowRecord | null> {
    const wf = this.workflows.get(id);
    if (!wf || wf.userId !== userId || wf.deletedAt !== null) {
      return null;
    }

    const updated: WorkflowRecord = {
      ...wf,
      name: data.name !== undefined ? data.name : wf.name,
      description: data.description !== undefined ? data.description : wf.description,
      draftDefinition:
        data.draftDefinition !== undefined
          ? structuredClone(data.draftDefinition)
          : wf.draftDefinition,
      updatedAt: new Date()
    };

    this.workflows.set(id, updated);
    return { ...updated };
  }

  async softDeleteByIdAndUserId(id: string, userId: string): Promise<boolean> {
    const wf = this.workflows.get(id);
    if (!wf || wf.userId !== userId || wf.deletedAt !== null) {
      return false;
    }

    wf.deletedAt = new Date();
    wf.updatedAt = new Date();
    this.workflows.set(id, wf);
    return true;
  }
}
