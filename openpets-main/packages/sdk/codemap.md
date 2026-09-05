# Package: @open-pets/plugin-sdk

## Responsibility

Public SDK v3 type package for OpenPets plugin authors. It defines the plugin-facing `OpenPetsContext` contract and ships a deterministic no-Electron test harness for plugin unit tests.

## Design/Patterns

- **Types-First Runtime Boundary**: The package publishes TypeScript declarations and small test utilities; real runtime behavior is injected by the desktop plugin host.
- **Capability Namespaces**: The SDK groups behavior under `ctx.ui`, `ctx.pets`, `ctx.pet`, `ctx.audio`, `ctx.events`, `ctx.assets`, `ctx.bus`, `ctx.schedule`, `ctx.storage`, `ctx.config`, `ctx.net`, `ctx.notify`, `ctx.ai`, `ctx.secrets`, `ctx.voice`, `ctx.auth`, `ctx.files`, `ctx.system`, `ctx.commands`, `ctx.status`, and `ctx.log`.
- **Permission Mirroring**: `OpenPetsPermission` mirrors manifest validation and desktop bridge checks so plugin authors get autocomplete for SDK v3 capabilities.
- **Descriptor Testing**: The test harness records bubbles, alerts, commands, storage, schedules, network/AI calls, sounds, panels, and pet actions as data for assertions rather than launching Electron.

## Data & Control Flow

1. Plugin source references `@open-pets/plugin-sdk` for types or imports `@open-pets/plugin-sdk/testing` in tests.
2. At runtime, the desktop app injects `OpenPetsPlugin` into the sandbox and passes a host-backed `ctx` to registered plugin handlers.
3. During tests, `createTestHarness(register, options)` creates a mocked `ctx`, runs plugin startup, advances fake time, emits events, fires command/bubble actions, and exposes recorded effects.
4. Desktop bridge conformance checks compare host-side SDK behavior against this published contract.

## Integration Points

- **Desktop runtime**: `apps/desktop/src/plugin-sdk-bridge.ts` and namespace modules implement this contract.
- **CLI templates**: `packages/cli/src/plugin-templates.ts` scaffolds plugins and tests that depend on this package.
- **Official plugins**: `plugins/official/*/test.js` use the testing harness for deterministic schedule/event/storage assertions.
- **Source map**: [src/codemap.md](src/codemap.md)
