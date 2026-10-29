import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { ConfigError, loadConfig } from "../src/config.ts";
import { STATE_FILE, State } from "../src/state.ts";

const REQUIRED = {
    PB_EMAIL: "reader@example.com",
    PB_PASSWORD: "pb-secret",
    BOOKORBIT_URL: "https://books.example.com",
    BOOKORBIT_USER: "reader",
    BOOKORBIT_PASSWORD: "bo-secret",
};

let dir: string;
beforeEach(async () => {
    dir = await mkdtemp(`${tmpdir()}/pocketorbit-test-`);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

test("defaults", () => {
    expect(loadConfig(REQUIRED)).toMatchObject({
        syncInterval: 300,
        deviceName: "PocketBook",
        dataDir: "/data",
        dryRun: false,
        pbShop: undefined,
        pbUrl: "https://cloud.pocketbook.digital/api/v1.0",
    });
});

test("reports all missing settings at once", () => {
    expect(() => loadConfig({ PB_EMAIL: "x", BOOKORBIT_USER: "u", BOOKORBIT_PASSWORD: "p" }))
        .toThrow("Missing required settings: PB_PASSWORD, BOOKORBIT_URL");
});

test("NAME_FILE reads the value from a file", async () => {
    await Bun.write(`${dir}/password`, "from-file\n");
    expect(loadConfig({ ...REQUIRED, PB_PASSWORD_FILE: `${dir}/password` }).pbPassword).toBe("from-file");
    expect(() => loadConfig({ ...REQUIRED, PB_PASSWORD_FILE: `${dir}/missing` })).toThrow("Cannot read PB_PASSWORD_FILE");
});

test.each([
    [{ SYNC_INTERVAL: "5" }, "at least 30"],
    [{ SYNC_INTERVAL: "5m" }, "whole number"],
    [{ BOOKORBIT_URL: "books.example.com" }, "http"],
    [{ DEVICE_ID: "my device!" }, "letters, digits and hyphens"],
])("rejects %p", (env, message) => {
    expect(() => loadConfig({ ...REQUIRED, ...env })).toThrow(ConfigError);
    expect(() => loadConfig({ ...REQUIRED, ...env })).toThrow(message);
});

test("DRY_RUN", () => {
    expect(loadConfig({ ...REQUIRED, DRY_RUN: "true" }).dryRun).toBe(true);
    expect(loadConfig({ ...REQUIRED, DRY_RUN: "no" }).dryRun).toBe(false);
});

test("migrates the state file of the Python version", async () => {
    await Bun.write(`${dir}/${STATE_FILE}`, JSON.stringify({
        device_id: "pb-bridge-0123456789abcdef",
        pocketbook: { access_token: "a", refresh_token: "r", expires_at: 1793236000.5 },
        books: { abc: { koreader: "1e87cd74d66b28aa30656f4ac6fe2312", title: "Moby Dick", matched: true, pushed: [26, 1793229329] } },
        last_success: 1793229496,
    }));
    const state = await State.open(dir);
    expect(state.data).toEqual({
        version: 1,
        deviceId: "pb-bridge-0123456789abcdef",
        pocketbook: { accessToken: "a", refreshToken: "r", expiresAt: 1793236000500 },
        books: { abc: { koreaderHash: "1e87cd74d66b28aa30656f4ac6fe2312", title: "Moby Dick", matched: true, sent: { percent: 26, mtime: 1793229329 } } },
        lastSuccess: 1793229496000,
    });
    expect(((await Bun.file(`${dir}/${STATE_FILE}`).json()) as { version?: number }).version).toBe(1);
});

test("--healthcheck reports whether a cycle succeeded recently", async () => {
    const healthcheck = async () => {
        const proc = Bun.spawn([process.execPath, `${import.meta.dir}/../src/index.ts`, "--healthcheck"], {
            env: { ...process.env, DATA_DIR: dir, SYNC_INTERVAL: "300" },
        });
        return proc.exited;
    };
    expect(await healthcheck()).toBe(1); // no cycle yet
    await Bun.write(`${dir}/${STATE_FILE}`, JSON.stringify({ version: 1, lastSuccess: Date.now() - 10_000 }));
    expect(await healthcheck()).toBe(0);
    await Bun.write(`${dir}/${STATE_FILE}`, JSON.stringify({ version: 1, lastSuccess: Date.now() - 900_000 }));
    expect(await healthcheck()).toBe(1);
});
