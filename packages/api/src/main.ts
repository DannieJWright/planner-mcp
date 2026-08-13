import { createServer } from "./server.js";

const host = process.env.PLANNER_API_HOST ?? "127.0.0.1";
const port = Number(process.env.PLANNER_API_PORT ?? 3000);
const server = createServer({ logger: true });

await server.listen({ host, port });
