export interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowRecord {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  draftDefinition: unknown;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  create(data: { email: string; name?: string | null; passwordHash: string }): Promise<UserRecord>;
}

export interface WorkflowRepository {
  create(data: {
    userId: string;
    name: string;
    description?: string | null;
    draftDefinition?: unknown;
  }): Promise<WorkflowRecord>;
  findActiveByUserId(userId: string): Promise<WorkflowRecord[]>;
  findActiveByIdAndUserId(id: string, userId: string): Promise<WorkflowRecord | null>;
  updateActiveByIdAndUserId(
    id: string,
    userId: string,
    data: {
      name?: string;
      description?: string | null;
      draftDefinition?: unknown;
    }
  ): Promise<WorkflowRecord | null>;
  softDeleteByIdAndUserId(id: string, userId: string): Promise<boolean>;
}
