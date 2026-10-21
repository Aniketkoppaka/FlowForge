import { z } from "zod";

/**
 * Draft definition schema for Milestone 1 & 2.
 * Allows intermediate invalid editor states (e.g. disconnected nodes, incomplete config)
 * while still ensuring the payload is a valid JSON structure with nodes and edges arrays.
 */
export const DraftDefinitionSchema = z
  .object({
    schemaVersion: z.number().int().positive().default(1),
    nodes: z.array(z.record(z.string(), z.unknown())).default([]),
    edges: z.array(z.record(z.string(), z.unknown())).default([])
  })
  .passthrough();

export type DraftDefinition = z.infer<typeof DraftDefinitionSchema>;

export const CreateWorkflowRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Workflow name is required")
    .max(255, "Workflow name cannot exceed 255 characters"),
  description: z
    .string()
    .trim()
    .max(1000, "Description cannot exceed 1000 characters")
    .nullable()
    .optional(),
  draftDefinition: DraftDefinitionSchema.optional()
});

export type CreateWorkflowRequest = z.infer<typeof CreateWorkflowRequestSchema>;

export const UpdateWorkflowRequestSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Workflow name cannot be empty")
      .max(255, "Workflow name cannot exceed 255 characters")
      .optional(),
    description: z
      .string()
      .trim()
      .max(1000, "Description cannot exceed 1000 characters")
      .nullable()
      .optional(),
    draftDefinition: DraftDefinitionSchema.optional()
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field (name, description, or draftDefinition) must be provided for update"
  });

export type UpdateWorkflowRequest = z.infer<typeof UpdateWorkflowRequestSchema>;

export const WorkflowResponseSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  draftDefinition: z.unknown(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type WorkflowResponse = z.infer<typeof WorkflowResponseSchema>;
