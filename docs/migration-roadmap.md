# Migration Roadmap

Tracks the incremental migration from the legacy `server/` + `client/` structure
to the target `apps/` + `packages/` monorepo architecture.

## Current State

```
server/              → being migrated to apps/electron/src/ + packages/core/
client/              → being migrated to apps/renderer/src/
server/providers/    → DONE: mirrored in packages/core/src/graph/
```

## Migration Phases

### Phase 1 — Provider System ✅ Done (2026-05-24)
- [x] Create `packages/core/src/graph/` with full provider system
- [x] Create `packages/shared/` with IPC contracts
- [x] Create `packages/db-clients/` with transport clients
- [x] Wire new `graph:*` IPC channels in `server/main.js`
- [x] Write all documentation

### Phase 2 — Electron App Structure (next)
- [ ] Move `server/main.js` → `apps/electron/src/main.ts`
- [ ] Move `server/preload.js` → `apps/electron/src/windows/preload.ts`
  - Update contextBridge to expose `window.graphClient` (typed)
- [ ] Move `server/services/DynamoService.js` → `apps/electron/src/services/DynamoService.ts`
- [ ] Activate `apps/electron/src/ipc/registry.ts` as the IPC entry point
- [ ] Remove duplicate IPC handlers from `server/main.js`
- [ ] Update `package.json` "main" to point to compiled electron app

### Phase 3 — Renderer Migration (after Phase 2)
- [ ] Move `client/renderer.jsx` → `apps/renderer/src/app/App.tsx`
- [ ] Move `client/components/` → `apps/renderer/src/components/`
- [ ] Move `client/canvas/` → `apps/renderer/src/canvas/`
- [ ] Move `client/api.js` → `apps/renderer/src/api/graphApi.ts` (typed)
  - Replace raw string channels with `IpcChannels` constants
  - Add TypeScript contract types to all API calls
- [ ] Move `client/stores/` → `apps/renderer/src/state/`
- [ ] Move `client/hooks/` → `apps/renderer/src/hooks/`
- [ ] Update esbuild config to use `apps/renderer/src/` as entry point

### Phase 4 — Remove Legacy Directories (after Phase 3)
- [ ] Delete `server/` (all code is in `apps/electron/` and `packages/`)
- [ ] Delete `client/` (all code is in `apps/renderer/`)
- [ ] Remove `server/providers/` duplicate (kept until Phase 2 is complete)
- [ ] Update electron-builder config to use new paths
- [ ] Update `.gitignore` for new dist paths

### Phase 5 — Provider Stubs → Full Implementations (ongoing)
Priority order based on demand:
- [ ] JanusGraph — add schema introspection via management API
- [ ] ArangoDB — add AQL dialect, full schema introspection
- [ ] NebulaGraph — test with real NebulaGraph cluster, fix any driver issues
- [ ] CosmosDB — test with Azure emulator
- [ ] TigerGraph — test REST++ API in detail
- [ ] OrientDB — test with OrientDB Docker image

## File Mapping Reference

| Legacy path | Target path | Status |
|-------------|-------------|--------|
| `server/providers/` | `packages/core/src/graph/` | Mirrored ✅ |
| `server/services/ConnectionManager.ts` | `packages/core/src/connection/` | Mirrored ✅ |
| `server/main.js` | `apps/electron/src/main.ts` | Pending |
| `server/preload.js` | `apps/electron/src/windows/preload.ts` | Pending |
| `server/services/DynamoService.js` | `apps/electron/src/services/DynamoService.ts` | Pending |
| `server/commands/ExecuteQueryCommand.js` | `packages/core/src/query-engine/` | Partial ✅ |
| `client/api.js` | `apps/renderer/src/api/graphApi.ts` | Pending |
| `client/components/AppContext.jsx` | `apps/renderer/src/state/` | Pending |
| `client/components/*.jsx` | `apps/renderer/src/components/` | Pending |
| `client/canvas/` | `apps/renderer/src/canvas/` | Pending |
