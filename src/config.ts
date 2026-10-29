import { readFileSync } from "node:fs";
import { DEFAULT_URL as POCKETBOOK_URL } from "./pocketbook.ts";

export interface Config {
    pbEmail: string;
    pbPassword: string;
    /** Only needed if the account belongs to several PocketBook shops */
    pbShop?: string;
    pbUrl: string;
    bookorbitUrl: string;
    bookorbitUser: string;
    bookorbitPassword: string;
    deviceName: string;
    /** Used on the first start only; afterwards the ID in the state file wins */
    deviceId?: string;
    /** Seconds */
    syncInterval: number;
    dataDir: string;
    dryRun: boolean;
}

export class ConfigError extends Error {}

const MIN_SYNC_INTERVAL = 30;

/** Settings from environment variables. Every setting NAME can also be read from the file in NAME_FILE (Docker secrets). */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
    const missing: string[] = [];
    const get = (name: string, required = false): string | undefined => {
        const file = env[`${name}_FILE`];
        let value: string | undefined;
        if (file) {
            try {
                value = readFileSync(file, "utf8").trim();
            } catch (err) {
                throw new ConfigError(`Cannot read ${name}_FILE: ${(err as Error).message}`);
            }
        } else {
            value = env[name]?.trim();
        }
        if (!value && required) missing.push(name);
        return value || undefined;
    };

    const config = {
        pbEmail: get("PB_EMAIL", true) ?? "",
        pbPassword: get("PB_PASSWORD", true) ?? "",
        pbShop: get("PB_SHOP"),
        pbUrl: get("PB_API_URL") ?? POCKETBOOK_URL,
        bookorbitUrl: get("BOOKORBIT_URL", true) ?? "",
        bookorbitUser: get("BOOKORBIT_USER", true) ?? "",
        bookorbitPassword: get("BOOKORBIT_PASSWORD", true) ?? "",
        deviceName: get("DEVICE_NAME") ?? "PocketBook",
        deviceId: get("DEVICE_ID"),
        syncInterval: parseInterval(get("SYNC_INTERVAL") ?? "300"),
        dataDir: get("DATA_DIR") ?? "/data",
        dryRun: ["1", "true", "yes"].includes(get("DRY_RUN")?.toLowerCase() ?? ""),
    };
    if (missing.length) {
        throw new ConfigError(`Missing required settings: ${missing.join(", ")} (set them, or NAME_FILE pointing to a file with the value)`);
    }
    if (!/^https?:\/\//.test(config.bookorbitUrl)) throw new ConfigError("BOOKORBIT_URL must start with http:// or https://");
    if (config.deviceId && !/^[A-Za-z0-9-]{1,100}$/.test(config.deviceId)) {
        throw new ConfigError("DEVICE_ID may only contain letters, digits and hyphens (BookOrbit's rule)");
    }
    return config;
}

function parseInterval(value: string): number {
    const seconds = Number(value);
    if (!Number.isInteger(seconds)) throw new ConfigError(`SYNC_INTERVAL must be a whole number of seconds, got "${value}"`);
    if (seconds < MIN_SYNC_INTERVAL) throw new ConfigError(`SYNC_INTERVAL must be at least ${MIN_SYNC_INTERVAL}`);
    return seconds;
}
