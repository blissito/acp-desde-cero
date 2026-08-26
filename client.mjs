// Cliente ACP mínimo, en Node puro y sin dependencias.
// ACP es JSON-RPC delimitado por saltos de línea sobre entrada y salida estándar;
// una librería escondería justo lo que queremos enseñar.
//
//   node client.mjs "lee package.json y dime qué versión declara"
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const AGENT = process.env.ACP_AGENT ?? "claude-agent-acp";
const CWD = process.env.ACP_CWD ?? process.cwd();
const PROMPT = process.argv[2] ?? "lee package.json y dime qué versión declara";

// --- el cable: toda línea que entra o sale queda en disco -------------------
mkdirSync("wire", { recursive: true });
const WIRE = `wire/${process.env.ACP_WIRE ?? "sesion"}.jsonl`;
writeFileSync(WIRE, "");
const t0 = Date.now();
const log = (dir, msg) =>
  appendFileSync(WIRE, JSON.stringify({ ms: Date.now() - t0, dir, msg }) + "\n");

// --- transporte -------------------------------------------------------------
const agent = spawn(AGENT, [], { stdio: ["pipe", "pipe", "inherit"], cwd: CWD });
const pending = new Map();
let nextId = 1;

function send(msg) {
  log("→", msg);
  agent.stdin.write(JSON.stringify(msg) + "\n");
}

function request(method, params) {
  const id = nextId++;
  send({ jsonrpc: "2.0", id, method, params });
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}

let buffer = "";
agent.stdout.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    log("←", msg);
    handle(msg);
  }
});

// --- qué hacemos con lo que llega ------------------------------------------
function handle(msg) {
  // Una respuesta a algo que pedimos.
  if (msg.id !== undefined && !msg.method) {
    const waiting = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) waiting?.rej(new Error(msg.error.message));
    else waiting?.res(msg.result);
    return;
  }
  // Una notificación del agente: cómo va el turno.
  if (msg.method === "session/update") {
    const u = msg.params?.update ?? {};
    if (u.sessionUpdate === "agent_message_chunk") process.stdout.write(u.content?.text ?? "");
    return;
  }
  // El agente NOS llama a nosotros. Aquí es donde se ve quién manda.
  if (msg.method) answer(msg);
}

function answer(msg) {
  const reply = (result) => send({ jsonrpc: "2.0", id: msg.id, result });
  switch (msg.method) {
    case "session/request_permission": {
      const title = msg.params?.toolCall?.title ?? msg.params?.toolCall?.rawInput?.command ?? "";
      const options = msg.params?.options ?? [];
      const allow = options.find((o) => o.kind === "allow_once") ?? options[0];
      console.log(`\n\n  ⏸  el agente pide permiso: ${title}`);
      console.log(`     opciones: ${options.map((o) => o.optionId).join(", ")}`);
      console.log(`     autorizamos: ${allow?.optionId}\n`);
      return reply({ outcome: { outcome: "selected", optionId: allow?.optionId } });
    }
    case "fs/read_text_file":
      return reply({ content: readFileSync(resolve(CWD, msg.params.path), "utf8") });
    case "fs/write_text_file":
      writeFileSync(resolve(CWD, msg.params.path), msg.params.content);
      return reply({});
    default:
      if (msg.id !== undefined) reply({});
  }
}

// --- el turno ---------------------------------------------------------------
await request("initialize", {
  protocolVersion: 1,
  clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
  clientInfo: { name: "acp-desde-cero", version: "0.1.0" },
});

const { sessionId, modes } = await request("session/new", { cwd: CWD, mcpServers: [] });
console.log(`sesión ${sessionId}`);

// El agente puede nacer aprobándose todo a sí mismo. Quién decide los permisos
// lo elige el CLIENTE, y el protocolo trae el método para pedirlo.
if (modes?.currentModeId !== "default") {
  await request("session/set_mode", { sessionId, modeId: "default" });
  console.log(`modo: ${modes?.currentModeId} → default\n`);
}

const { stopReason } = await request("session/prompt", {
  sessionId,
  prompt: [{ type: "text", text: PROMPT }],
});

console.log(`\n\nterminó: ${stopReason}`);
console.log(`cable en ${WIRE}`);
agent.kill();
