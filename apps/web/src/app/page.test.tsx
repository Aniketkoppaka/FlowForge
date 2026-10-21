import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import HomePage from "./page";
import { WorkflowsDashboard } from "../components/WorkflowsDashboard";
import { WorkflowEditor } from "../components/editor/WorkflowEditor";
import { apiClient, ApiClientError } from "../lib/api";

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush
  })
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}));

describe("@flowforge/web — Dashboard & Visual Workflow Editor Suite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockPush.mockReset();
  });

  it("exports HomePage component", () => {
    expect(typeof HomePage).toBe("function");
  });

  describe("1. WorkflowsDashboard", () => {
    it("renders the workflow list and supports creating and opening a workflow", async () => {
      vi.spyOn(apiClient, "getMe").mockResolvedValue({
        user: {
          id: "00000000-0000-0000-0000-000000000001",
          email: "dev@flowforge.io",
          name: "Dev",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        csrfToken: "csrf-123"
      });

      vi.spyOn(apiClient, "listWorkflows").mockResolvedValue({
        workflows: [
          {
            id: "00000000-0000-0000-0000-000000000010",
            userId: "00000000-0000-0000-0000-000000000001",
            name: "Existing Sync Pipeline",
            description: "Syncs CRM records",
            draftDefinition: { schemaVersion: 1, nodes: [{ id: "n1" }], edges: [] },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ]
      });

      const createSpy = vi.spyOn(apiClient, "createWorkflow").mockResolvedValue({
        workflow: {
          id: "00000000-0000-0000-0000-000000000099",
          userId: "00000000-0000-0000-0000-000000000001",
          name: "New Webhook Processor",
          description: "Handles incoming orders",
          draftDefinition: { schemaVersion: 1, nodes: [], edges: [] },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      });

      render(<WorkflowsDashboard />);

      expect(await screen.findByText("Existing Sync Pipeline")).toBeInTheDocument();
      expect(screen.getByText("1 node · 0 edges")).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(/Workflow Name/i), {
        target: { value: "New Webhook Processor" }
      });
      fireEvent.change(screen.getByLabelText(/Description/i), {
        target: { value: "Handles incoming orders" }
      });
      fireEvent.click(screen.getByRole("button", { name: /Create & Open Editor/i }));

      await waitFor(() => {
        expect(createSpy).toHaveBeenCalledWith({
          name: "New Webhook Processor",
          description: "Handles incoming orders",
          draftDefinition: { schemaVersion: 1, nodes: [], edges: [] }
        });
        expect(mockPush).toHaveBeenCalledWith(
          "/workflows/00000000-0000-0000-0000-000000000099"
        );
      });
    });
  });

  describe("2. WorkflowEditor", () => {
    const wfId = "00000000-0000-0000-0000-000000000101";

    it("renders empty state guidance on a fresh workflow, adds nodes, configures properties, marks dirty, and saves draft via API", async () => {
      vi.spyOn(apiClient, "getMe").mockResolvedValue({
        user: {
          id: "00000000-0000-0000-0000-000000000001",
          email: "dev@flowforge.io",
          name: "Dev",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        csrfToken: "csrf-123"
      });

      vi.spyOn(apiClient, "getWorkflow").mockResolvedValue({
        workflow: {
          id: wfId,
          userId: "00000000-0000-0000-0000-000000000001",
          name: "Customer Onboarding Flow",
          description: null,
          draftDefinition: { schemaVersion: 1, nodes: [], edges: [] },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      });

      const updateSpy = vi
        .spyOn(apiClient, "updateWorkflow")
        .mockImplementation(async (_id, payload) => ({
          workflow: {
            id: wfId,
            userId: "00000000-0000-0000-0000-000000000001",
            name: payload.name ?? "Customer Onboarding Flow",
            description: payload.description ?? null,
            draftDefinition: payload.draftDefinition,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        }));

      render(<WorkflowEditor workflowId={wfId} />);

      // Wait for editor to load
      expect(await screen.findByTestId("empty-canvas-guidance")).toBeInTheDocument();
      expect(screen.getByTestId("save-status-indicator")).toHaveTextContent("Saved");

      // Run button is disabled with clear explanation
      const runBtn = screen.getByRole("button", {
        name: /Run Workflow \(Execution not implemented yet\)/i
      });
      expect(runBtn).toBeDisabled();

      // Add Manual Trigger node
      fireEvent.click(screen.getByRole("button", { name: /Add Manual Trigger node/i }));

      // Empty guidance disappears, save status becomes Unsaved changes, Manual Trigger button becomes disabled (Limit 1)
      expect(screen.queryByTestId("empty-canvas-guidance")).not.toBeInTheDocument();
      expect(screen.getByTestId("save-status-indicator")).toHaveTextContent(
        "Unsaved changes"
      );
      expect(
        screen.getByRole("button", { name: /Add Manual Trigger node/i })
      ).toBeDisabled();

      // Add HTTP Request node (automatically selects it and opens config panel)
      fireEvent.click(screen.getByRole("button", { name: /Add HTTP Request node/i }));
      expect(screen.getByTestId("node-config-panel")).toBeInTheDocument();

      // Edit HTTP Request label & URL in config panel
      const labelInput = screen.getByLabelText(/Node Label/i);
      fireEvent.change(labelInput, { target: { value: "Fetch Stripe Customer" } });

      const urlInput = screen.getByLabelText(/Request URL/i);
      fireEvent.change(urlInput, {
        target: { value: "https://api.stripe.com/v1/customers" }
      });

      // Click Save Draft
      fireEvent.click(screen.getByRole("button", { name: /Save Draft/i }));

      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId("save-status-indicator")).toHaveTextContent("Saved");
      });

      const savedCall = updateSpy.mock.calls[0]!;
      expect(savedCall[0]).toBe(wfId);
      const savedDraft = savedCall[1].draftDefinition as {
        nodes: Array<{ label: string; type: string; config: { url?: string } }>;
      };
      expect(savedDraft.nodes).toHaveLength(2);
      expect(savedDraft.nodes[1]!.label).toBe("Fetch Stripe Customer");
      expect(savedDraft.nodes[1]!.config.url).toBe(
        "https://api.stripe.com/v1/customers"
      );
    });

    it("retains unsaved changes and displays error feedback when saving fails", async () => {
      vi.spyOn(apiClient, "getMe").mockResolvedValue({
        user: {
          id: "00000000-0000-0000-0000-000000000001",
          email: "dev@flowforge.io",
          name: "Dev",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        csrfToken: "csrf-123"
      });

      vi.spyOn(apiClient, "getWorkflow").mockResolvedValue({
        workflow: {
          id: wfId,
          userId: "00000000-0000-0000-0000-000000000001",
          name: "Resilient Save Test",
          description: null,
          draftDefinition: { schemaVersion: 1, nodes: [], edges: [] },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      });

      vi.spyOn(apiClient, "updateWorkflow").mockRejectedValue(
        new ApiClientError(500, "INTERNAL_ERROR", "Database connection timeout")
      );

      render(<WorkflowEditor workflowId={wfId} />);

      await screen.findByTestId("empty-canvas-guidance");

      // Add Condition node and configure it
      fireEvent.click(screen.getByRole("button", { name: /Add Condition Branch node/i }));
      fireEvent.change(screen.getByLabelText(/Left Operand/i), {
        target: { value: "trigger.body.total" }
      });

      // Attempt save -> fails
      fireEvent.click(screen.getByRole("button", { name: /Save Draft/i }));

      await waitFor(() => {
        expect(screen.getByTestId("save-status-indicator")).toHaveTextContent(
          "Save failed"
        );
        expect(
          screen.getByText(/Save Error: Database connection timeout/i)
        ).toBeInTheDocument();
      });

      // Unsaved input value is still intact in the configuration panel
      expect(screen.getByLabelText(/Left Operand/i)).toHaveValue("trigger.body.total");
    });

    it("reconstructs a saved graph with nodes, positions, configs, and edges on reload", async () => {
      vi.spyOn(apiClient, "getMe").mockResolvedValue({
        user: {
          id: "00000000-0000-0000-0000-000000000001",
          email: "dev@flowforge.io",
          name: "Dev",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        csrfToken: "csrf-123"
      });

      vi.spyOn(apiClient, "getWorkflow").mockResolvedValue({
        workflow: {
          id: wfId,
          userId: "00000000-0000-0000-0000-000000000001",
          name: "Restored Persisted Graph",
          description: "Reload verification",
          draftDefinition: {
            schemaVersion: 1,
            nodes: [
              {
                id: "manual_trigger_1",
                type: "manual_trigger",
                label: "Order Webhook Entry",
                position: { x: 100, y: 150 },
                config: { description: "Starts on manual order review" }
              },
              {
                id: "data_transform_1",
                type: "data_transform",
                label: "Normalize Order Fields",
                position: { x: 420, y: 150 },
                config: {
                  mappings: [
                    { id: "m1", sourcePath: "order.id", targetKey: "orderId" }
                  ]
                }
              }
            ],
            edges: [
              {
                id: "edge_1",
                source: "manual_trigger_1",
                sourceHandle: "default",
                target: "data_transform_1",
                targetHandle: "default"
              }
            ]
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      });

      render(<WorkflowEditor workflowId={wfId} />);

      expect(
        await screen.findByDisplayValue("Restored Persisted Graph")
      ).toBeInTheDocument();
      expect(screen.getByText("Order Webhook Entry")).toBeInTheDocument();
      expect(screen.getByText("Normalize Order Fields")).toBeInTheDocument();
      expect(screen.getByText("1 field mapping")).toBeInTheDocument();
    });

    it("renders an error screen when workflow does not exist or user lacks access (404)", async () => {
      vi.spyOn(apiClient, "getMe").mockResolvedValue({
        user: {
          id: "00000000-0000-0000-0000-000000000001",
          email: "dev@flowforge.io",
          name: "Dev",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        csrfToken: "csrf-123"
      });

      vi.spyOn(apiClient, "getWorkflow").mockRejectedValue(
        new ApiClientError(404, "NOT_FOUND", "Workflow not found")
      );

      render(<WorkflowEditor workflowId={wfId} />);

      expect(await screen.findByText("Unable to Open Workflow")).toBeInTheDocument();
      expect(
        screen.getByText("Workflow not found or you do not have access to it.")
      ).toBeInTheDocument();
    });

    it("locks saving when a stored draft contains malformed data until the user clicks Recover & Repair Draft", async () => {
      vi.spyOn(apiClient, "getMe").mockResolvedValue({
        user: {
          id: "00000000-0000-0000-0000-000000000001",
          email: "dev@flowforge.io",
          name: "Dev",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        csrfToken: "csrf-123"
      });

      vi.spyOn(apiClient, "getWorkflow").mockResolvedValue({
        workflow: {
          id: wfId,
          userId: "00000000-0000-0000-0000-000000000001",
          name: "Legacy Corrupted Workflow",
          description: null,
          draftDefinition: {
            schemaVersion: 1,
            nodes: [
              {
                id: "trig_1",
                type: "manual_trigger",
                label: "Manual Trigger",
                position: { x: 100, y: 100 },
                config: { description: "" }
              },
              {
                id: "corrupt_node_99",
                type: "unknown_future_node_type"
              }
            ],
            edges: []
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      });

      const updateSpy = vi
        .spyOn(apiClient, "updateWorkflow")
        .mockImplementation(async (_id, payload) => ({
          workflow: {
            id: wfId,
            userId: "00000000-0000-0000-0000-000000000001",
            name: payload.name ?? "Legacy Corrupted Workflow",
            description: null,
            draftDefinition: payload.draftDefinition,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        }));

      render(<WorkflowEditor workflowId={wfId} />);

      expect(
        await screen.findByDisplayValue("Legacy Corrupted Workflow")
      ).toBeInTheDocument();

      // Corrupted Draft Protection banner is shown and Save is locked
      expect(
        screen.getByText(/Corrupted Draft Protection:/i)
      ).toBeInTheDocument();
      const saveLockedBtn = screen.getByRole("button", { name: /Save Locked/i });
      expect(saveLockedBtn).toBeDisabled();

      // Clicking Recover & Repair Draft unlocks saving and marks draft as unsaved
      fireEvent.click(
        screen.getByRole("button", { name: /Recover & Repair Draft/i })
      );

      expect(screen.getByTestId("save-status-indicator")).toHaveTextContent(
        "Unsaved changes"
      );
      const saveDraftBtn = screen.getByRole("button", { name: /Save Draft/i });
      expect(saveDraftBtn).not.toBeDisabled();

      // Now explicit save succeeds with the repaired graph
      fireEvent.click(saveDraftBtn);
      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId("save-status-indicator")).toHaveTextContent("Saved");
      });
    });
  });
});
