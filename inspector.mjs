// Lee un cable capturado y lo muestra legible.
// Colapsa las rachas de chunks y correlaciona cada petición con su respuesta,
// que es lo que separa esto de mirar el log crudo.
//
//   node inspector.mjs wire/permiso.jsonl
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "wire/permiso.jsonl";
const frames = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));

const asked = new Map();     // id → {method, ms}
const rows = [];
let run = null;              // racha de chunks iguales

const flush = () => { if (run) { rows.push(run); run = null; } };

for (const { ms, dir, msg } of frames) {
  const update = msg.params?.update?.sessionUpdate;

  if (update) {
    if (run?.kind === update) { run.n++; run.until = ms; continue; }
    flush();
    run = { t: "racha", kind: update, n: 1, ms, until: ms };
    continue;
  }
  flush();

  if (msg.method && msg.id !== undefined) {
    asked.set(`${dir}${msg.id}`, { method: msg.method, ms });
    rows.push({ t: "pide", dir, id: msg.id, method: msg.method, ms });
  } else if (msg.method) {
    rows.push({ t: "avisa", dir, method: msg.method, ms });
  } else {
    const back = dir === "←" ? "→" : "←";
    const q = asked.get(`${back}${msg.id}`);
    rows.push({ t: "responde", dir, id: msg.id, method: q?.method, ms, esperó: q ? ms - q.ms : null });
  }
}
flush();

const seg = (ms) => `${(ms / 1000).toFixed(1)}s`.padStart(6);
for (const r of rows) {
  if (r.t === "racha") {
    const veces = r.n > 1 ? ` ×${r.n}` : "";
    console.log(`${seg(r.ms)}  ←  ${r.kind}${veces}`);
  } else if (r.t === "pide") {
    const quien = r.dir === "→" ? "→ le pedimos " : "←  NOS PIDE  ";
    console.log(`${seg(r.ms)}  ${quien}${r.method}  #${r.id}`);
  } else if (r.t === "avisa") {
    console.log(`${seg(r.ms)}  ${r.dir}  ${r.method}`);
  } else {
    const espera = r.esperó !== null ? `  (esperó ${(r.esperó / 1000).toFixed(1)}s)` : "";
    console.log(`${seg(r.ms)}  ${r.dir}  responde  #${r.id} ${r.method ?? ""}${espera}`);
  }
}

const chunks = frames.filter((f) => f.msg.params?.update?.sessionUpdate).length;
console.log(`\n${frames.length} frames · ${chunks} notificaciones de turno · ${rows.length} líneas legibles`);
