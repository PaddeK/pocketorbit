/** Timestamped log lines, so `docker logs` shows when each sync happened. */
function line(level: string, message: string): string {
    const now = new Date();
    const stamp = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 19).replace("T", " ");
    return `${stamp} ${level} ${message}`;
}

export const log = {
    info: (message: string) => console.log(line("INFO", message)),
    warn: (message: string) => console.warn(line("WARN", message)),
    error: (message: string) => console.error(line("ERROR", message)),
};
