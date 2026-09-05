# packages/pi/src/

Source for the OpenPets Pi integration package.

## Responsibility

- `extension.ts`: Default Pi extension export. Wraps `createOpenPetsPiExtension()` for Pi loader consumption.
- `index.ts`: Public package exports including extension factory, runtime helpers, types, and classification utilities.
- `runtime.ts`: Core integration logic (~300 lines) handling Pi event classification, command parsing, OpenPets dispatch, and safety constraints.
- `check-pi.ts`: Unit-style contract checks for event classification, command parsing, privacy rejection corpus, non-blocking scheduling, and extension registration.
- `check-pi-compat.ts`: Pi-style compatibility smoke checks for event handlers whose payloads do not include a `type` field.

## Design/Patterns

- **Event normalization**: `normalizePiEvent()` wraps raw Pi events into `PiEventEnvelope` with consistent `type`/`payload` structure.
- **Event classification**: `classifyPiEvent()` maps Pi lifecycle events to OpenPets reactions via pure function with no side effects.
- **Tool classification**: `classifyPiToolExecutionStart()` inspects tool names (not arguments) to categorize as editing/running/testing/working.
- **Command parsing**: `parseOpenPetsCommand()` uses simple string splitting with validation, rejecting multi-line, oversized, or secret-containing speech.
- **Non-blocking runtime**: `createOpenPetsPiRuntime()` returns handle functions; actual work scheduled via injectable `schedule` callback.
- **Error suppression**: Recent errors suppress success reactions within 5s window; error speech rate-limited to 1 per 20s.
- **Debug sanitization**: Error codes and messages sanitized to prevent leaking paths, tokens, or secrets in debug logs.

## Flow

**Extension initialization**:
```
extension.ts default export
  -> createOpenPetsPiExtension(pi, options)
  -> createOpenPetsPiRuntime(options) → runtime
  -> Subscribe to 7 Pi events via api.on()
  -> Register /openpets command via api.registerCommand()
  -> Return runtime (handleEvent, handleCommand)
```

**Event handling**:
```
Pi event emitted
  -> handler wraps in { type, payload }
  -> runtime.handleEvent(envelope)
  -> classifyPiEvent() → PiEventDecision
  -> runAutomatic() schedules OpenPets dispatch
  -> IPC success: pet reacts; IPC failure: swallowed + debugLog
```

**Command handling**:
```
/openpets <args>
  -> runtime.handleCommand(args, ctx)
  -> parseOpenPetsCommand(args) → OpenPetsPiCommand
  -> executeCommand(command, client, ctx)
  -> Synchronous OpenPets client calls
  -> ctx.ui.notify() for user feedback
```

## Integration

- **Pi API**: Expects `OpenPetsPiExtensionApi` with `on(event, handler)` and `registerCommand(name, spec)` methods.
- **OpenPets client**: Uses `createOpenPetsClient()` from `@open-pets/client` with 500ms timeouts for automatic events.
- **Agent events**: Imports `pickHookSpeech`, `validateHookSpeech` from `@open-pets/agent-events` for safe speech selection.
- **Test doubles**: Both check files inject mock clients/schedulers to verify behavior without desktop dependency.

## Important constraints

- Do not add `pi.registerTool()` in Phase 21 MVP.
- Do not inspect content-heavy Pi events such as prompt/message/tool result streams for speech.
- Keep automatic handlers fire-and-forget with swallowed IPC failures.
- All speech validation must reject secrets, paths, URLs, and code snippets.
