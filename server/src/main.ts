import { createSyncServer } from "./server.js";

/** Entry point: configuration from the environment (see README.md). */
const env = process.env;
const port = Number(env.PORT ?? 8787);
const host = env.HOST ?? "0.0.0.0";

const { server, store } = createSyncServer({
  dataDir: env.DATA_DIR ?? "./data",
  registrationSecret: env.REGISTRATION_SECRET || undefined,
  trustProxy: env.TRUST_PROXY === "1" || env.TRUST_PROXY === "true",
  requestsPerMinute: env.RATE_LIMIT_PER_MINUTE ? Number(env.RATE_LIMIT_PER_MINUTE) : undefined,
  maxAccountBytes: env.MAX_ACCOUNT_MB ? Number(env.MAX_ACCOUNT_MB) * 1024 * 1024 : undefined,
  log: env.QUIET === "1" ? undefined : (line) => console.log(line),
});

server.listen(port, host, () => {
  console.log(`browser-sync-server: http://${host}:${port} (${store.count()} compte(s), données dans ${env.DATA_DIR ?? "./data"})`);
  if (!env.REGISTRATION_SECRET) console.log("Attention : REGISTRATION_SECRET n'est pas défini, n'importe qui peut créer un compte.");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
