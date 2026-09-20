import { spawn } from "node:child_process";
import path from "node:path";
// Keep the existing Railway start command while isolating HTTP and worker event loops.
const children = ["server.js", "worker.js"].map(file => spawn(process.execPath, [path.join(__dirname, file)], { stdio: "inherit", windowsHide: true }));
let stopping = false;
function stop(code: number) {
    if (stopping)
        return;
    stopping = true;
    for (const child of children)
        if (child.exitCode === null)
            child.kill("SIGTERM");
    const timeout = setTimeout(() => { for (const child of children)
        if (child.exitCode === null)
            child.kill("SIGKILL"); process.exit(code); }, 25000);
    timeout.unref();
    process.exitCode = code;
}
for (const child of children) {
    child.on("error", () => stop(1));
    child.on("exit", () => { if (!stopping)
        stop(1); });
}
process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));
