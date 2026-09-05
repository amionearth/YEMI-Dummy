import assert from "node:assert/strict";

import { buildAgentActivityPayload } from "../src/agent-activity-payload.js";

// (1) explicit petId forwarded; active=true for non-idle kind
assert.deepEqual(
  buildAgentActivityPayload({ kind: "react", reaction: "wave", petId: "fox-pet" }),
  { kind: "react", reaction: "wave", active: true, petId: "fox-pet", surface: "agent" },
);

// (2) kind "idle" → active=false; missing petId → "default"
assert.deepEqual(
  buildAgentActivityPayload({ kind: "idle" }),
  { kind: "idle", reaction: undefined, active: false, petId: "default", surface: "default" },
);

// (3) kind "say" with reaction, no petId → active=true, petId="default"
assert.deepEqual(
  buildAgentActivityPayload({ kind: "say", reaction: "speak" }),
  { kind: "say", reaction: "speak", active: true, petId: "default", surface: "default" },
);

// (4) explicit default surface can accompany an actual pet asset id
assert.deepEqual(
  buildAgentActivityPayload({ kind: "say", reaction: "speak", petId: "builtin", surface: "default" }),
  { kind: "say", reaction: "speak", active: true, petId: "builtin", surface: "default" },
);

console.log("plugin-agent-activity tests passed.");
