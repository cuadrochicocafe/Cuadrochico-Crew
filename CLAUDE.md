# Cuadrochico · guía para agentes y desarrolladores

Repositorio de Cuadrochico (barra de café en Monterrey).
Hay dos mundos y **no se mezclan**:

| Ruta | Qué es | Reglas |
|---|---|---|
| `/` (raíz: `index.html`, `sw.js`, `usuarios.js`, íconos) | Herramienta interna del equipo, ya en uso. Se publica tal cual con GitHub Pages. | Legado. No refactorizar ni mover archivos sin pedirlo explícitamente: romperías la app instalada del equipo. |
| `packages/`, `apps/` | Proyecto nuevo de pedidos de mayoreo para clientes. | Todo lo de abajo aplica. |

Contexto de producto y decisiones: `docs/pedidos/contexto.md`. Léelo antes de cambiar reglas de negocio.

## Arquitectura

- `packages/core`: reglas de negocio puras en TypeScript.
  - Incluye precios, descuentos, horarios, capacidad y validación con zod.
  - Sin DOM ni APIs de Cloudflare.
  - El menú y la configuración viven en `packages/core/data/*.json`.
- `apps/api`: Cloudflare Worker (Hono) + D1.
  - Es la única fuente de verdad del precio: siempre recalcula con `core` y nunca confía en el cliente.
  - Sirve también los archivos estáticos de `apps/web/dist`.
- `apps/web`: app del cliente en Vite + Preact, en español y pensada primero para celular.
  - Usa `core` para cotizar al instante, pero el servidor confirma.

## Convenciones

- El dinero siempre va en **centavos enteros**. Las fechas se guardan en UTC (ISO); se muestran en `America/Monterrey`.
- Los textos visibles al usuario van en español de México; los identificadores de código, en inglés.
- Nada de secretos en el repo. Van en `.dev.vars` en local y en `wrangler secret put` en producción.
- Cada regla de negocio nueva lleva su prueba en `packages/core/test`.
- Antes de dar algo por terminado: `npm run check` (lint + typecheck + tests).
- Commits pequeños con mensaje en imperativo. Un cambio lógico por commit.

## Comandos

```bash
npm install
npm run check      # lint, tipos y pruebas de todo el monorepo
npm run dev        # web en local
npm run dev:api    # worker + D1 local
npm run deploy     # build web + deploy del worker
```
