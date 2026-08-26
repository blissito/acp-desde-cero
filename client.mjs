// Cliente ACP mínimo, en Node puro y sin dependencias.
// ACP es JSON-RPC delimitado por saltos de línea; una librería escondería justo
// lo que queremos enseñar.
//
//   node client.mjs "lee package.json y dime qué versión declara"
//   ACP_URL=wss://mi-caja/acp ACP_TICKET_SECRET=... node client.mjs "..."
//
// El MISMO cliente, dos transportes. Lo único que cambia es de dónde salen las
// líneas: un proceso hijo, o una caja que no está en tu máquina.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { stdioTransport, webSocketTransport } from "./transport.mjs";

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
// Con `ACP_URL` el agente es remoto; sin ella, un proceso hijo. Nada más abajo
// cambia: ni la sesión, ni el turno, ni cómo se responde a lo que el agente pide.
const agent = process.env.ACP_URL
  ? webSocketTransport({
      url: process.env.ACP_URL,
      secret: process.env.ACP_TICKET_SECRET,
      ns: process.env.ACP_NS,
      sub: process.env.ACP_SUB,
    })
  : stdioTransport({ command: AGENT, cwd: CWD });

const pending = new Map();
let nextId = 1;
let usage = null;

function send(msg) {
  log("→", msg);
  agent.send(msg);
}

function request(method, params) {
  const id = nextId++;
  send({ jsonrpc: "2.0", id, method, params });
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}

agent.onMessage((msg) => {
  log("←", msg);
  handle(msg);
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
    // El gasto viaja por el mismo cable: no hay que ir a preguntarle al proveedor.
    if (u.sessionUpdate === "usage_update") usage = u;
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
await agent.ready;
console.log(`transporte: ${agent.label}\n`);

await request("initialize", {
  protocolVersion: 1,
  // ⚠️ Un agente remoto tiene su PROPIO disco. Ofrecerle el nuestro sería
  // mandarle a leer archivos de una máquina que él no puede ver.
  clientCapabilities: { fs: { readTextFile: !process.env.ACP_URL, writeTextFile: !process.env.ACP_URL } },
  clientInfo: { name: "acp-desde-cero", version: "0.1.0" },
});

// El `cwd` es del agente, no tuyo: en remoto es una ruta DENTRO de la caja.
const WORKDIR = process.env.ACP_URL ? (process.env.ACP_REMOTE_CWD ?? "/data") : CWD;
const { sessionId, modes } = await request("session/new", { cwd: WORKDIR, mcpServers: [] });
console.log(`sesión ${sessionId}`);

// El agente puede nacer aprobándose todo a sí mismo. Quién decide los permisos
// lo elige el CLIENTE, y el protocolo trae el método para pedirlo.
//
// ⚠️ Los NOMBRES de los modos no están en el protocolo: cada agente pone los
// suyos. claude-agent-acp trae `default`; goose trae `auto` (aprobar todo),
// `approve`, `smart_approve` y `chat`. Cablear un nombre da `Invalid mode` con
// el otro agente, así que se elige de la lista que el agente acaba de mandar.
const ASK_FIRST = ["default", "approve", "smart_approve", "ask"];
const wanted = ASK_FIRST.find((id) =>
  modes?.availableModes?.some((m) => m.id === id),
);
if (wanted && modes?.currentModeId !== wanted) {
  await request("session/set_mode", { sessionId, modeId: wanted });
  console.log(`modo: ${modes.currentModeId} → ${wanted}   (de ${modes.availableModes.map((m) => m.id).join(", ")})\n`);
}

const { stopReason } = await request("session/prompt", {
  sessionId,
  prompt: [{ type: "text", text: PROMPT }],
});

console.log(`\n\nterminó: ${stopReason}`);
if (usage) console.log(`contexto: ${usage.used} de ${usage.size} tokens`);
console.log(`cable en ${WIRE}`);
agent.close();
