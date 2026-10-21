import { loadConfig } from "./config.js";
import {
  PrismaUserRepository,
  PrismaSessionRepository,
  PrismaWorkflowRepository
} from "./repositories/prisma-repositories.js";
import { createApp } from "./app.js";

const config = loadConfig();
const userRepo = new PrismaUserRepository();
const sessionRepo = new PrismaSessionRepository();
const workflowRepo = new PrismaWorkflowRepository();

const app = createApp({ config, userRepo, sessionRepo, workflowRepo });

if (process.env.NODE_ENV !== "test") {
  app.listen(config.API_PORT, () => {
    console.log(`[FlowForge API] Listening on http://localhost:${config.API_PORT}`);
  });
}

export { app };
