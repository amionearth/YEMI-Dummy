# apps/desktop/src/i18n/reactions/

## Responsibility

Houses localized arrays of text messages (speech-bubble message pools) corresponding to companion reactions (e.g., idle, thinking, working, editing, testing, waiting, success, error). These pools provide varied pet communications in the user's active UI language.

## Design/Patterns

- **Multiple-Option Pools**: Lists multiple randomized string variants per reaction state to prevent repeating the exact speech text continuously.
- **Hierarchical Fallback**: Localized pools (e.g., Japanese, Korean, Spanish, Portuguese, Chinese) are mapped in a registry. If a specific reaction block or language is missing, the module gracefully falls back to the default English pool. 

## Data & Control Flow

- UI setup/locale change triggers routing to select the active language's speech pool.
- During execution, the core application pulls from `localizedReactionMessagePools` matching the active locale and selected reaction enum, choosing a random message to render in the pet's display bubble.

## Integration Points

- **Parent Directory**: Referenced by `src/i18n/reactions/index.ts` to compile localized reaction arrays.
- **Root Codebase**: Integrated with `src/reaction-messages.ts` for final display lookup and mapping of companion event states.
