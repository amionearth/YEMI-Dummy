import assert from "node:assert/strict";

import { buildClaudeMcpGetCommand, buildClaudeMcpPreview, classifyClaudeMcpStatus, formatCommandForDisplay, getBundledMcpEntryPath, getLocalMcpEntryPath, mapAsarPathToUnpacked, parseClaudeMcpGetOutput, parseClaudeMcpListOutput, validateOpenPetsPetArg } from "./claude-code.js";

const defaultPreview = buildClaudeMcpPreview();
assert.deepEqual(defaultPreview.add.args, ["mcp", "add", "--scope", "user", "openpets", "--", "npx", "-y", "@open-pets/mcp"]);
assert.deepEqual(defaultPreview.remove.args, ["mcp", "remove", "--scope", "user", "openpets"]);
assert.deepEqual(defaultPreview.mcpJson.mcpServers.openpets.args, ["-y", "@open-pets/mcp"]);
assert.equal(formatCommandForDisplay(defaultPreview.add), "claude mcp add --scope user openpets -- npx -y @open-pets/mcp");

const petPreview = buildClaudeMcpPreview("snoopy");
assert.deepEqual(petPreview.add.args, ["mcp", "add", "--scope", "user", "openpets", "--", "npx", "-y", "@open-pets/mcp", "--pet", "snoopy"]);
assert.deepEqual(petPreview.mcpJson.mcpServers.openpets.args, ["-y", "@open-pets/mcp", "--pet", "snoopy"]);
assert.deepEqual(buildClaudeMcpGetCommand().args, ["mcp", "get", "openpets"]);

const localPreview = buildClaudeMcpPreview("snoopy", "local");
assert.deepEqual(localPreview.add.args, ["mcp", "add", "--scope", "user", "openpets", "--", "node", getLocalMcpEntryPath(), "--pet", "snoopy"]);
assert.equal(localPreview.mcpJson.mcpServers.openpets.command, "node");
assert.deepEqual(localPreview.mcpJson.mcpServers.openpets.args, [getLocalMcpEntryPath(), "--pet", "snoopy"]);

assert.throws(() => validateOpenPetsPetArg("Bad Pet"));
assert.throws(() => validateOpenPetsPetArg("bad/pet"));
assert.equal(validateOpenPetsPetArg("snoopy"), "snoopy");

assert.equal(parseClaudeMcpListOutput("openpets: npx -y @open-pets/mcp").present, true);
assert.equal(parseClaudeMcpListOutput("No MCP servers configured").present, false);

const jsonGet = parseClaudeMcpGetOutput(JSON.stringify({ command: "npx", args: ["-y", "@open-pets/mcp", "--pet", "snoopy"] }), "snoopy");
assert.equal(jsonGet.present, true);
assert.equal(jsonGet.verified, true);
assert.equal(jsonGet.matchesExpected, true);

const localGet = parseClaudeMcpGetOutput(JSON.stringify({ command: "node", args: [getLocalMcpEntryPath(), "--pet", "snoopy"] }), "snoopy", "local");
assert.equal(localGet.matchesExpected, true);

const bundledPreview = buildClaudeMcpPreview("snoopy", "bundled");
assert.deepEqual(bundledPreview.add.args, ["mcp", "add", "--scope", "user", "openpets", "--", "node", getBundledMcpEntryPath(), "--pet", "snoopy"]);
assert.equal(bundledPreview.mcpJson.mcpServers.openpets.command, "node");
assert.deepEqual(bundledPreview.mcpJson.mcpServers.openpets.args, [getBundledMcpEntryPath(), "--pet", "snoopy"]);
const bundledGet = parseClaudeMcpGetOutput(JSON.stringify({ command: "node", args: [getBundledMcpEntryPath(), "--pet", "snoopy"] }), "snoopy", "bundled");
assert.equal(bundledGet.matchesExpected, true);
const customNode = "/Users/test/Library/Application Support/Herd/config/nvm/versions/node/v22.22.2/bin/node";
const customNodePreview = buildClaudeMcpPreview("snoopy", "bundled", customNode);
assert.equal(customNodePreview.mcpJson.mcpServers.openpets.command, customNode);
assert.equal(parseClaudeMcpGetOutput(JSON.stringify({ command: customNode, args: [getBundledMcpEntryPath(), "--pet", "snoopy"] }), "snoopy", "bundled", customNode).matchesExpected, true);

const spacedPath = "/Applications/OpenPets Test.app/Contents/Resources/app/node_modules/@open-pets/mcp/dist/index.js";
assert.equal(formatCommandForDisplay({ command: "node", args: [spacedPath, "--pet", "snoopy"] }), 'node "/Applications/OpenPets Test.app/Contents/Resources/app/node_modules/@open-pets/mcp/dist/index.js" --pet snoopy');
const spacedTextGet = parseClaudeMcpGetOutput(`openpets\nCommand: node\nArgs: "${getBundledMcpEntryPath()}" --pet snoopy`, "snoopy", "bundled");
assert.equal(spacedTextGet.matchesExpected, true);
assert.equal(formatCommandForDisplay({ command: "node", args: ["C:\\Program Files\\OpenPets\\resources\\app\\node_modules\\@open-pets\\mcp\\dist\\index.js"] }), 'node "C:\\\\Program Files\\\\OpenPets\\\\resources\\\\app\\\\node_modules\\\\@open-pets\\\\mcp\\\\dist\\\\index.js"');
assert.equal(mapAsarPathToUnpacked("/Applications/OpenPets.app/Contents/Resources/app.asar/node_modules/@open-pets/mcp/dist/index.js"), "/Applications/OpenPets.app/Contents/Resources/app.asar.unpacked/node_modules/@open-pets/mcp/dist/index.js");
assert.equal(mapAsarPathToUnpacked("C:\\Program Files\\OpenPets\\resources\\app.asar\\node_modules\\@open-pets\\mcp\\dist\\index.js"), "C:\\Program Files\\OpenPets\\resources\\app.asar.unpacked\\node_modules\\@open-pets\\mcp\\dist\\index.js");
assert.equal(mapAsarPathToUnpacked("/Applications/app.asarish/OpenPets.app/Contents/Resources/app.asar/node_modules/@open-pets/mcp/dist/index.js"), "/Applications/app.asarish/OpenPets.app/Contents/Resources/app.asar.unpacked/node_modules/@open-pets/mcp/dist/index.js");
assert.equal(mapAsarPathToUnpacked("/tmp/app.asar.unpacked/node_modules/@open-pets/mcp/dist/index.js"), "/tmp/app.asar.unpacked/node_modules/@open-pets/mcp/dist/index.js");

const textGet = parseClaudeMcpGetOutput("openpets\nCommand: npx\nArgs: -y @open-pets/mcp --pet snoopy", "snoopy");
assert.equal(textGet.present, true);
assert.equal(textGet.verified, true);
assert.equal(textGet.matchesExpected, true);

const different = parseClaudeMcpGetOutput(JSON.stringify({ command: "node", args: ["server.js"] }), "snoopy");
assert.equal(different.present, true);
assert.equal(different.verified, true);
assert.equal(different.matchesExpected, false);

const unverifiable = classifyClaudeMcpStatus("openpets", "Name: openpets\nTransport: stdio", "snoopy");
assert.equal(unverifiable.present, true);
assert.equal(unverifiable.verified, false);
assert.equal(unverifiable.matchesExpected, false);

console.error("Claude Code setup validation passed.");
