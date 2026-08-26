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

## Qué hay aquí

| Archivo | Qué hace |
|---|---|
| `client.mjs` | el cliente: transporte, sesión, turno y respuesta a lo que el agente pide |
| `inspector.mjs` | lee un cable capturado, colapsa las rachas y correlaciona pregunta con respuesta |
| `wire/*.jsonl` | cables reales capturados, una línea por mensaje |

## Tres cosas que conviene saber antes de empezar

**Los mensajes van delimitados por saltos de línea.** ACP usa JSON-RPC sobre la
entrada y salida estándar, sin el encabezado `Content-Length` de LSP. Es el error
que uno espera cometer aquí.

**El agente también te llama a ti.** El protocolo es de ida y vuelta: el agente
pide leer un archivo, abrir una terminal, o autorización para actuar. Quien
responde eres tú, y por eso el cliente es quien tiene las manos.

**El modo de permisos lo elige el cliente.** Un agente puede nacer aprobándose
todo a sí mismo, y entonces nunca pregunta nada. Se corrige con
`session/set_mode`, que viaja por el mismo cable.

## Licencia

MIT.
