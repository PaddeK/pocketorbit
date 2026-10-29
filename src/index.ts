import { version } from "../package.json";
import { ConfigError, loadConfig } from "./config.ts";
import { HttpError } from "./http.ts";
import { log } from "./log.ts";
import { STATE_FILE, State, type StateData } from "./state.ts";
import { Bridge } from "./sync.ts";

const args = process.argv.slice(2);

// The container image has no shell, so Docker's HEALTHCHECK runs the binary itself: pocketorbit --healthcheck.
// Healthy if a cycle succeeded within two sync intervals (plus slack for slow downloads).
if (args.includes("--healthcheck")) {
    const dataDir = process.env.DATA_DIR ?? "/data";
    const intervalMs = Number(process.env.SYNC_INTERVAL ?? 300) * 1000;
    const state = (await Bun.file(`${dataDir}/${STATE_FILE}`).json().catch(() => null)) as Partial<StateData> | null;
    process.exit(state?.lastSuccess && Date.now() - state.lastSuccess <= 2 * intervalMs + 120_000 ? 0 : 1);
}
if (args.includes("--version")) {
    console.log(version);
    process.exit(0);
}
const once = args.includes("--once");

let config;
try {
    config = loadConfig();
} catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    log.error(err.message);
    process.exit(2);
}

let state: State;
try {
    state = await State.open(config.dataDir);
} catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EACCES" && code !== "EPERM") throw err;
    const uid = process.getuid?.() ?? "?";
    const gid = process.getgid?.() ?? "?";
    log.error(`Cannot write to ${config.dataDir} as uid ${uid}. If it is a bind mount, create the directory on the host`
        + ` and give it to this user, e.g.:\n\n  mkdir -p /path/on/host && sudo chown ${uid}:${gid} /path/on/host\n`);
    process.exit(1);
}

const bridge = new Bridge(config, state);
log.info(`pocketorbit ${version}, syncing every ${config.syncInterval}s${config.dryRun ? " (dry run: nothing is sent)" : ""}`);
try {
    log.info(`BookOrbit: logged in as ${await bridge.bookorbit.checkAuth()}`);
} catch (err) {
    log.error(err instanceof HttpError
        ? `BookOrbit login failed, check BOOKORBIT_URL, BOOKORBIT_USER and BOOKORBIT_PASSWORD: ${err.message}`
        : `BookOrbit is not reachable: ${(err as Error).message}`);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
        await state.save();
        process.exit(0);
    });
}

for (;;) {
    try {
        await bridge.cycle();
    } catch (err) {
        // Keep running through outages; the healthcheck reports lasting failures
        log.error(`cycle failed: ${(err as Error).message}`);
        if (once) process.exit(1);
    }
    if (once) process.exit(0);
    await Bun.sleep(config.syncInterval * 1000);
}
