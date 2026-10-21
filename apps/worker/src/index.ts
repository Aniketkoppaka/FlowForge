import { ENGINE_VERSION } from "@flowforge/workflow-engine";

export function getWorkerInfo() {
  return {
    service: "@flowforge/worker",
    engineVersion: ENGINE_VERSION,
    status: "standby"
  } as const;
}

if (process.env.NODE_ENV !== "test") {
  console.log("[FlowForge Worker] Initialized skeleton:", getWorkerInfo());
}
