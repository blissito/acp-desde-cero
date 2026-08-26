// Cliente ACP mínimo — capítulo 1: arrancar al agente y saludarlo.
// Node puro, sin dependencias: ACP es JSON-RPC sobre entrada y salida estándar,
// y una librería escondería justo lo que queremos enseñar.
import { spawn } from "node:child_process";

const AGENT = process.env.ACP_AGENT ?? "claude-agent-acp";

// El cliente lanza al agente como subproceso y le habla por stdin/stdout.
const agent = spawn(AGENT, [], { stdio: ["pipe", "pipe", "inherit"] });

let nextId = 1;
const pending = new Map();

// Los mensajes van delimitados por saltos de línea y no pueden llevar uno dentro.
// (Ojo: ACP NO usa el encabezado Content-Length de LSP.)
function send(msg) {
  agent.stdin.write(JSON.stringify(msg) + "\n");
}

function request(method, params) {
  const id = nextId++;
  send({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

let buffer = "";
agent.stdout.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line) handle(JSON.parse(line));
  }
});

function handle(msg) {
  if (msg.id !== undefined && (msg.result !== undefined || msg.error)) {
    const waiting = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) waiting?.reject(new Error(msg.error.message));
    else waiting?.resolve(msg.result);
  }
}

const hello = await request("initialize", {
  protocolVersion: 1,
  clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
  clientInfo: { name: "acp-desde-cero", version: "0.1.0" },
});

console.log("El agente contesta:");
console.log(JSON.stringify(hello, null, 2));

agent.kill();
