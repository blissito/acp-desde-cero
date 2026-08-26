// El transporte: por dónde viajan las líneas.
//
// ACP no dice nada sobre el cable. Dice que los mensajes son JSON-RPC y que van
// separados por saltos de línea; quién los lleva es problema aparte. Por eso el
// cliente no sabe si su agente es un proceso hijo o una microVM en otro país:
// los dos transportes exponen exactamente lo mismo.
//
//   { send(msg), onMessage(cb), close() }
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";

/** Parte un flujo de bytes en líneas y entrega los JSON que salgan de ahí. */
function lineReader(onMessage) {
  let buffer = "";
  return (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try { onMessage(JSON.parse(line)); } catch { /* línea a medias o ruido */ }
    }
  };
}

/**
 * Transporte 1: el agente es un proceso hijo, y el cable son sus stdin/stdout.
 * Es el caso que asumen todos los editores, y el que arranca este curso.
 */
export function stdioTransport({ command, cwd }) {
  const child = spawn(command, [], { stdio: ["pipe", "pipe", "inherit"], cwd });
  return {
    label: `stdio · ${command}`,
    send: (msg) => child.stdin.write(JSON.stringify(msg) + "\n"),
    onMessage: (cb) => child.stdout.on("data", lineReader(cb)),
    ready: Promise.resolve(),
    close: () => child.kill(),
  };
}

/**
 * Transporte 2: el agente vive en una caja remota y el cable es un WebSocket.
 *
 * Node 22 trae `WebSocket` global, así que esto sigue sin dependencias.
 *
 * ⚠️ La autorización va en el QUERY, no en un header. No es descuido: un
 * `new WebSocket()` de navegador no puede poner `Authorization` —la API no lo
 * permite— así que el permiso viaja como ticket firmado con HMAC y con ventana
 * de tiempo. El servidor lo verifica solo, sin llamar de vuelta a nadie.
 */
export function webSocketTransport({ url, secret, ns = "", sub = "" }) {
  const target = new URL(url);
  if (secret) {
    const ts = Math.floor(Date.now() / 1000);
    // El tenant va DENTRO de la firma. Un ticket que sólo dijera quién eres
    // serviría igual contra la caja de otro: es lo que ata el permiso a su dueño.
    const sig = createHmac("sha256", secret).update(`${ts}.${ns}.${sub}`).digest("hex");
    target.search = new URLSearchParams({ ts, ns, sub, sig }).toString();
  }
  const ws = new WebSocket(target);
  const ready = new Promise((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = (e) => rej(new Error(`no se pudo abrir ${target.origin}: ${e.message ?? "error"}`));
  });
  return {
    label: `websocket · ${target.origin}${target.pathname}`,
    send: (msg) => ws.send(JSON.stringify(msg) + "\n"),
    // ⚠️ Aquí NO se puede reusar el lector de líneas de arriba, y esa fue la
    // primera piedra al montar este transporte: el servidor manda el JSON sin
    // salto de línea al final, así que un lector que espera el delimitador se
    // queda con el mensaje entero en el buffer y el cliente cuelga sin un error.
    //
    // El salto de línea es la convención de un FLUJO de bytes, donde hace falta
    // saber dónde termina un mensaje y empieza el siguiente. Un WebSocket ya
    // entrega mensajes: el frame ES la frontera. Se parte por si acaso vinieran
    // varios juntos, pero nada se guarda para el frame siguiente.
    onMessage: (cb) => {
      ws.onmessage = (e) => {
        for (const line of String(e.data).split("\n")) {
          const t = line.trim();
          if (!t) continue;
          try { cb(JSON.parse(t)); } catch { /* no era JSON */ }
        }
      };
    },
    ready,
    close: () => ws.close(),
  };
}
