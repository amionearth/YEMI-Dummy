import assert from "node:assert/strict";

import { getLanRetryDelayMs, shouldHideLanPetAfterMisses, shouldLogLanPollFailure } from "../src/lan-client-retry.js";

assert.equal(getLanRetryDelayMs(0), 2_500, "healthy LAN polling should use the base interval");
assert.equal(getLanRetryDelayMs(1), 5_000, "first missed poll should back off once");
assert.equal(getLanRetryDelayMs(2), 10_000, "second missed poll should continue backing off");
assert.equal(getLanRetryDelayMs(3), 15_000, "third missed poll should cap at the max interval");
assert.equal(getLanRetryDelayMs(99), 15_000, "retry delay should stay capped during long outages");
assert.equal(getLanRetryDelayMs(Number.NaN), 2_500, "invalid miss counts should fall back to the base interval");

assert.equal(shouldHideLanPetAfterMisses(2), false, "pet should stay visible through short LAN blips");
assert.equal(shouldHideLanPetAfterMisses(3), true, "pet should hide after the configured miss threshold");

assert.equal(shouldLogLanPollFailure(1_000, 0), true, "first poll failure should be logged");
assert.equal(shouldLogLanPollFailure(5_000, 1_000), false, "poll failures should be log-throttled");
assert.equal(shouldLogLanPollFailure(11_000, 1_000), true, "poll failure logs should resume after the warning interval");

console.log("LAN client retry validation passed.");
