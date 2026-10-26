import { test, expect } from "@playwright/test";

test.describe.serial("FlowForge — Visual Workflow Automation E2E Qualification", () => {
  const timestamp = Date.now();
  const testUser = {
    email: `engineer_${timestamp}@flowforge.dev`,
    password: "Password123!"
  };

  const attackerUser = {
    email: `attacker_${timestamp}@flowforge.dev`,
    password: "Password123!"
  };

  let primaryWorkflowId: string;

  test("Journeys 1–6: Register, Create Workflow, Edit Draft, Save, Reload, Publish, Execute & Inspect", async ({
    page
  }) => {
    // 1. Authentication & Registration
    await page.goto("/");
    await expect(page).toHaveTitle(/FlowForge/i);

    // Switch to Register form
    await page.getByRole("button", { name: /Need an account\? Register/i }).click();
    await expect(page.getByRole("heading", { name: /Create your developer account/i })).toBeVisible();

    await page.locator("#auth-email").fill(testUser.email);
    await page.locator("#auth-password").fill(testUser.password);
    await page.getByRole("button", { name: "Create Account" }).click();

    // Verify authenticated session and dashboard
    await expect(page.getByText(testUser.email)).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign Out" })).toBeVisible();

    // 2. Create a workflow
    await page.locator("#new-wf-name").fill("Order Processing Pipeline");
    await page.locator("#new-wf-desc").fill("Processes customer checkout orders");
    await page.getByRole("button", { name: "Create & Open Editor" }).click();

    // Verify navigation to editor: /workflows/[id]
    await page.waitForURL(/\/workflows\/[0-9a-fA-F-]+/);
    primaryWorkflowId = page.url().split("/").pop()!;
    expect(primaryWorkflowId).toMatch(/^[0-9a-fA-F-]{36}$/);

    // 3. Edit Draft, Persist Changes & Verify Reload Recovery
    await expect(page.locator("#workflow-title-input")).toHaveValue("Order Processing Pipeline");

    // Add Manual Trigger from palette
    const addTriggerBtn = page.getByRole("button", { name: "Add Manual Trigger node" });
    await expect(addTriggerBtn).toBeVisible();
    await addTriggerBtn.click();

    // Modify workflow title
    await page.locator("#workflow-title-input").fill("Order Processing Pipeline - Staged");

    // Verify unsaved changes status
    await expect(page.locator('[data-testid="save-status-indicator"]')).toHaveText("Unsaved changes");

    // Save draft
    await page.getByRole("button", { name: "Save Draft" }).click();
    await expect(page.locator('[data-testid="save-status-indicator"]')).toHaveText("Saved");

    // Reload page to verify persistence across reloads
    await page.reload();
    await expect(page.locator("#workflow-title-input")).toHaveValue("Order Processing Pipeline - Staged");
    await expect(page.locator('[data-testid="save-status-indicator"]')).toHaveText("Saved");

    // 4. Publish Immutable Version
    const publishBtn = page.getByRole("button", { name: "Publish Version" });
    await expect(publishBtn).toBeEnabled();
    await publishBtn.click();

    // Verify published version badge
    const versionBadge = page.locator('[data-testid="published-version-badge"]');
    await expect(versionBadge).toHaveText("Published v1");

    // 5. Execute Published Workflow
    const runBtn = page.getByRole("button", { name: /Run (Workflow )?v1/i });
    await expect(runBtn).toBeEnabled();
    await runBtn.click();

    // Verify run counter updates and inspector is open
    await expect(page.getByRole("button", { name: /Runs \(1\)/i })).toBeVisible();

    // 6. Inspect Node Results in Execution Inspector
    const inspector = page.locator('[data-testid="execution-inspector-panel"]');
    if (!(await inspector.isVisible())) {
      await page.getByRole("button", { name: /Runs \(1\)/i }).click();
    }
    await expect(inspector).toBeVisible();

    // Verify terminal execution status transitions to COMPLETED
    await expect(inspector.getByText("COMPLETED").first()).toBeVisible({ timeout: 15_000 });

    // Verify node execution list displays the trigger node
    await expect(inspector.getByText("Manual Trigger").first()).toBeVisible();
  });

  test("Journey 7: Cross-tenant unauthorized access prevention", async ({ browser }) => {
    // Open an isolated incognito browser context for the second tenant
    const attackerContext = await browser.newContext();
    const attackerPage = await attackerContext.newPage();

    await attackerPage.goto("/");
    await attackerPage.getByRole("button", { name: /Need an account\? Register/i }).click();
    await attackerPage.locator("#auth-email").fill(attackerUser.email);
    await attackerPage.locator("#auth-password").fill(attackerUser.password);
    await attackerPage.getByRole("button", { name: "Create Account" }).click();
    await expect(attackerPage.getByText(attackerUser.email)).toBeVisible();

    // Attacker attempts to open primary user's workflow directly by URL
    await attackerPage.goto(`/workflows/${primaryWorkflowId}`);

    // Verify non-disclosing 404 error banner
    await expect(
      attackerPage.getByRole("heading", { name: "Unable to Open Workflow" })
    ).toBeVisible();
    await expect(attackerPage.getByText("Workflow not found")).toBeVisible();
    await expect(
      attackerPage.getByRole("link", { name: /Back to Workflows/i })
    ).toBeVisible();

    await attackerContext.close();
  });

  test("Journey 8: Failed execution is presented accurately in UI rather than masked as success", async ({
    page
  }) => {
    // Log in as primary user
    await page.goto("/");
    await page.locator("#auth-email").fill(testUser.email);
    await page.locator("#auth-password").fill(testUser.password);
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page.getByText(testUser.email)).toBeVisible();

    // Create a workflow with an outbound HTTP request (disabled by default)
    await page.locator("#new-wf-name").fill("Faulty Outbound Pipeline");
    await page.locator("#new-wf-desc").fill("Fails deterministically due to disabled outbound HTTP");
    await page.getByRole("button", { name: "Create & Open Editor" }).click();

    await page.waitForURL(/\/workflows\/[0-9a-fA-F-]+/);
    const faultyWfId = page.url().split("/").pop()!;

    // Add Manual Trigger and HTTP Request nodes
    await page.getByRole("button", { name: "Add Manual Trigger node" }).click();
    await page.getByRole("button", { name: "Add HTTP Request node" }).click();

    // Save draft so added nodes are persisted to draftDefinition on server
    await page.getByRole("button", { name: "Save Draft" }).click();
    await expect(page.locator('[data-testid="save-status-indicator"]')).toHaveText("Saved");

    // Connect trigger to http_request via draft update so the graph is valid and executable
    await page.evaluate(async (wfId) => {
      const apiUrl = "http://localhost:4000";
      const getRes = await fetch(`${apiUrl}/api/workflows/${wfId}`, { credentials: "include" });
      const wfData = await getRes.json();
      const nodes = wfData.workflow.draftDefinition.nodes;
      const triggerNode = nodes.find((n: { type: string }) => n.type === "manual_trigger");
      const httpNode = nodes.find((n: { type: string }) => n.type === "http_request");
      httpNode.config = {
        method: "GET",
        url: "https://api.example.com/test",
        headers: [],
        body: ""
      };

      const csrfCookie = document.cookie
        .split("; ")
        .find((row) => row.startsWith("ff_csrf="));
      const csrf = csrfCookie ? decodeURIComponent(csrfCookie.split("=")[1]) : "";

      const patchRes = await fetch(`${apiUrl}/api/workflows/${wfId}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "X-CSRF-Token": csrf } : {})
        },
        body: JSON.stringify({
          draftDefinition: {
            schemaVersion: 1,
            nodes,
            edges: [
              {
                id: "e_trigger_http",
                source: triggerNode.id,
                sourceHandle: "default",
                target: httpNode.id,
                targetHandle: "default"
              }
            ]
          }
        })
      });
      if (!patchRes.ok) {
        const errText = await patchRes.text();
        throw new Error(`Failed to save draft with edge: ${patchRes.status} ${errText}`);
      }
    }, faultyWfId);

    // Reload editor to display connected draft
    await page.reload();
    await expect(page.locator('[data-testid="save-status-indicator"]')).toHaveText("Saved");

    // Publish Version
    await page.getByRole("button", { name: "Publish Version" }).click();
    await expect(page.locator('[data-testid="published-version-badge"]')).toHaveText("Published v1");

    // Execute workflow
    await page.getByRole("button", { name: /Run (Workflow )?v1/i }).click();

    // Wait for run counter button to register the new run
    await expect(page.getByRole("button", { name: /Runs \(1\)/i })).toBeVisible({ timeout: 10_000 });

    // Open Execution Inspector if not automatically open
    const inspector = page.locator('[data-testid="execution-inspector-panel"]');
    if (!(await inspector.isVisible())) {
      await page.getByRole("button", { name: /Runs \(1\)/i }).click();
    }
    await expect(inspector).toBeVisible();

    // Verify execution status is accurately presented as FAILED (never masked as success)
    await expect(inspector.getByText("FAILED").first()).toBeVisible({ timeout: 15_000 });

    // Verify failure error message indicates outbound HTTP is disabled
    await expect(
      inspector.getByText(/HTTP_OUTBOUND_DISABLED|Outbound HTTP requests are disabled/i).first()
    ).toBeVisible();
  });
});
