import { prisma, Prisma } from "@flowforge/database";
import type { UserRepository, WorkflowRepository, UserRecord, WorkflowRecord } from "./types.js";

export class PrismaUserRepository implements UserRepository {
  async findByEmail(email: string): Promise<UserRecord | null> {
    return prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });
  }

  async findById(id: string): Promise<UserRecord | null> {
    return prisma.user.findUnique({
      where: { id }
    });
  }

  async create(data: {
    email: string;
    name?: string | null;
    passwordHash: string;
  }): Promise<UserRecord> {
    return prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        name: data.name ?? null,
        passwordHash: data.passwordHash
      }
    });
  }
}

export class PrismaWorkflowRepository implements WorkflowRepository {
  async create(data: {
    userId: string;
    name: string;
    description?: string | null;
    draftDefinition?: unknown;
  }): Promise<WorkflowRecord> {
    const defaultDraft = { schemaVersion: 1, nodes: [], edges: [] };
    return prisma.workflow.create({
      data: {
        userId: data.userId,
        name: data.name,
        description: data.description ?? null,
        draftDefinition: (data.draftDefinition ?? defaultDraft) as Prisma.InputJsonValue
      }
    });
  }

  async findActiveByUserId(userId: string): Promise<WorkflowRecord[]> {
    return prisma.workflow.findMany({
      where: {
        userId,
        deletedAt: null
      },
      orderBy: {
        updatedAt: "desc"
      }
    });
  }

  async findActiveByIdAndUserId(id: string, userId: string): Promise<WorkflowRecord | null> {
    return prisma.workflow.findFirst({
      where: {
        id,
        userId,
        deletedAt: null
      }
    });
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
    const existing = await this.findActiveByIdAndUserId(id, userId);
    if (!existing) {
      return null;
    }

    const updateData: Prisma.WorkflowUpdateInput = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.draftDefinition !== undefined) {
      updateData.draftDefinition = data.draftDefinition as Prisma.InputJsonValue;
    }

    return prisma.workflow.update({
      where: { id: existing.id },
      data: updateData
    });
  }

  async softDeleteByIdAndUserId(id: string, userId: string): Promise<boolean> {
    const result = await prisma.workflow.updateMany({
      where: {
        id,
        userId,
        deletedAt: null
      },
      data: {
        deletedAt: new Date()
      }
    });

    return result.count > 0;
  }
}
