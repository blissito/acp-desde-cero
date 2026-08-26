# ACP desde cero

Un cliente del [Agent Client Protocol](https://agentclientprotocol.com) escrito a
mano, en Node puro y sin una sola dependencia. Sirve para entender el protocolo
mirando lo que viaja por el cable.

## El temario es el `git log`

Cada commit agrega un concepto. Para pararte en cualquiera:

```bash
git checkout 02-initialize   # arrancar al agente y saludarlo
git checkout 04-permiso      # una sesión, un turno, y el agente pidiendo permiso
```

## Probarlo

```bash
npm i -g @agentclientprotocol/claude-agent-acp
node client.mjs "crea un archivo saludo.txt con el texto: hola desde ACP"
node inspector.mjs wire/sesion.jsonl
```

El agente se puede cambiar con `ACP_AGENT` (por ejemplo `codex-acp`).

### …y contra un agente que no está en tu máquina

El mismo cliente, cambiando de dónde salen las líneas:

```bash
ACP_URL=wss://tu-caja.ejemplo/acp \
ACP_TICKET_SECRET=el-secreto-de-la-caja \
node client.mjs "escribe hola.txt y dime en qué ruta quedó"
```

El archivo queda en el disco de la caja, no en el tuyo. Esa es toda la idea:
tu código no sale de tu máquina y el del agente no entra en ella.

## Qué hay aquí

| Archivo | Qué hace |
|---|---|
| `client.mjs` | el cliente: sesión, turno y respuesta a lo que el agente pide |
| `transport.mjs` | los dos cables: proceso hijo (stdio) y caja remota (WebSocket) |
| `inspector.mjs` | lee un cable capturado, colapsa las rachas y correlaciona pregunta con respuesta |
| `wire/*.jsonl` | cables reales capturados, una línea por mensaje |

## Cinco cosas que conviene saber antes de empezar

**Los mensajes van delimitados por saltos de línea.** ACP usa JSON-RPC sobre la
entrada y salida estándar, sin el encabezado `Content-Length` de LSP. Es el error
que uno espera cometer aquí.

**El agente también te llama a ti.** El protocolo es de ida y vuelta: el agente
pide leer un archivo, abrir una terminal, o autorización para actuar. Quien
responde eres tú, y por eso el cliente es quien tiene las manos.

**El modo de permisos lo elige el cliente.** Un agente puede nacer aprobándose
todo a sí mismo, y entonces nunca pregunta nada. Se corrige con
`session/set_mode`, que viaja por el mismo cable. Ojo: los NOMBRES de los modos
no están en el protocolo — `claude-agent-acp` trae `default`, goose trae `auto`,
`approve`, `smart_approve` y `chat`. Se eligen de la lista que el agente manda,
no de memoria.

**El salto de línea es cosa del flujo, no del protocolo.** Sobre stdin/stdout hay
que saber dónde termina un mensaje, y por eso el delimitador. Sobre WebSocket el
frame ya es la frontera y el servidor puede no mandarlo: un lector que lo espera
se queda con el mensaje en el buffer y el cliente cuelga **sin un solo error**.
Fue la primera piedra al escribir `transport.mjs`.

## El curso

Este repo es el material del módulo **ACP desde cero**, del curso
[Diseño de sistemas agénticos](https://www.fixtergeek.com/cursos/sistemas-agenticos/acp-desde-cero)
en [fixtergeek.com](https://www.fixtergeek.com). Ahí está el video que recorre estos
mismos commits, paso por paso.

Hecho por [blissito](https://github.com/blissito) · [FixterGeek](https://www.fixtergeek.com)

## Licencia

MIT.
