import assert from "node:assert/strict";

import { AirmailQueueManager, manager, _setMockElectron, testActiveWindows, stopDeliverySystem } from "../src/plugin-delivery.js";

const rendered: unknown[] = [];
const destroyed: string[] = [];
const queue = new AirmailQueueManager({
  now: () => 1_000,
  getActiveDisplays: () => [],
  getCursorDisplayKey: () => "0,0,100x100",
  getDisplayKey: () => "0,0,100x100",
  createOrUpdateWindow: (_display, item) => rendered.push(item),
  destroyWindow: (display) => destroyed.push(display),
});

const courier = { pluginId: "local.alpha", assetName: "courier", layout: { frameWidth: 256, frameHeight: 256, frames: 6, durationMs: 720 }, version: "1.2.3" };
queue.register("local.alpha", { key: "delivery", courier: { kind: "sprite", name: "courier" }, title: "Delivery", detail: "Soon", expiresAt: 2_000 }, courier);
const active = queue.queues.get("0,0,100x100")?.[0];
assert.deepEqual(active?.courier, courier, "queue preserves host-trusted courier metadata");
assert.equal(rendered.length, 1, "first courier delivery opens its display surface");

let dismissal = "";
queue.registerDismissHandler("local.alpha", "delivery", (reason) => { dismissal = reason; });
queue.dismiss("local.alpha", "delivery", "manual", false, active?.generationId);
assert.equal(dismissal, "manual", "courier delivery lifecycle invokes its handle callback");
assert.deepEqual(destroyed, ["0,0,100x100"], "empty courier queue destroys its delivery surface");

const removedDisplayKey = "0,0,100x100";
const targetDisplayKey = "100,0,100x100";
let cursorDisplayKey = removedDisplayKey;
const migrationWindowUpdates: string[] = [];
const migrationQueue = new AirmailQueueManager({
  now: () => 1_000,
  getActiveDisplays: () => [],
  getCursorDisplayKey: () => cursorDisplayKey,
  getDisplayKey: (bounds) => `${bounds.x},${bounds.y},${bounds.width}x${bounds.height}`,
  createOrUpdateWindow: (display) => migrationWindowUpdates.push(display),
  destroyWindow: () => {},
});

migrationQueue.register("removed", { key: "overflow", courier: { kind: "sprite", name: "courier" }, title: "Overflow", detail: "Soon", expiresAt: 2_000 }, courier);
let overflowDismissal = "";
migrationQueue.registerDismissHandler("removed", "overflow", (reason) => { overflowDismissal = reason; });
cursorDisplayKey = targetDisplayKey;
for (let index = 0; index < 16; index += 1) {
  migrationQueue.register(`target-${index}`, { key: `delivery-${index}`, courier: { kind: "sprite", name: "courier" }, title: "Target", detail: "Soon", expiresAt: 2_000 }, courier);
}
const removedWindowUpdates = migrationWindowUpdates.filter((display) => display === removedDisplayKey).length;
migrationQueue.handleDisplayRemoved(removedDisplayKey, [{ bounds: { x: 100, y: 0, width: 100, height: 100 } }]);
assert.equal(overflowDismissal, "expired", "overflow from a removed display dismisses its delivery handle");
assert.equal(migrationWindowUpdates.filter((display) => display === removedDisplayKey).length, removedWindowUpdates, "removed-display overflow does not recreate its delivery window");
assert.equal(migrationQueue.queues.get(removedDisplayKey), undefined, "removed display queue is cleared before overflow callbacks run");

let expiryNow = 1_000;
const expiryWindowUpdates: string[] = [];
const expiryDestroyed: string[] = [];
const expiryQueue = new AirmailQueueManager({
  now: () => expiryNow,
  getActiveDisplays: () => [],
  getCursorDisplayKey: () => "0,0,100x100",
  getDisplayKey: () => "0,0,100x100",
  createOrUpdateWindow: (display) => expiryWindowUpdates.push(display),
  destroyWindow: (display) => expiryDestroyed.push(display),
});
expiryQueue.register("expiry", { key: "first", courier: { kind: "sprite", name: "courier" }, title: "First", detail: "Soon", expiresAt: 2_000 }, courier);
expiryQueue.register("expiry", { key: "second", courier: { kind: "sprite", name: "courier" }, title: "Second", detail: "Soon", expiresAt: 2_000 }, courier);
const expiryDismissals: string[] = [];
expiryQueue.registerDismissHandler("expiry", "first", (reason) => expiryDismissals.push(`first:${reason}`));
expiryQueue.registerDismissHandler("expiry", "second", (reason) => expiryDismissals.push(`second:${reason}`));
expiryNow = 2_000;
expiryQueue.cleanupExpired();
assert.deepEqual(expiryWindowUpdates, ["0,0,100x100"], "simultaneous expiry does not create an intermediate successor window");
assert.deepEqual(expiryDestroyed, ["0,0,100x100"], "simultaneous expiry closes the delivery surface once");
assert.deepEqual(expiryDismissals, ["first:expired", "second:expired"], "simultaneous expiry dismisses every delivery handle");

let backgroundExpiryNow = 1_000;
const backgroundExpiryUpdates: string[] = [];
const backgroundExpiryQueue = new AirmailQueueManager({
  now: () => backgroundExpiryNow,
  getActiveDisplays: () => [],
  getCursorDisplayKey: () => "0,0,100x100",
  getDisplayKey: () => "0,0,100x100",
  createOrUpdateWindow: (display) => backgroundExpiryUpdates.push(display),
  destroyWindow: () => {},
});
backgroundExpiryQueue.register("background-expiry", { key: "active", courier: { kind: "sprite", name: "courier" }, title: "Active", detail: "Soon", expiresAt: 5_000 }, courier);
backgroundExpiryQueue.register("background-expiry", { key: "expired-background", courier: { kind: "sprite", name: "courier" }, title: "Expired", detail: "Soon", expiresAt: 2_000 }, courier);
backgroundExpiryNow = 2_000;
backgroundExpiryQueue.cleanupExpired();
assert.deepEqual(backgroundExpiryUpdates, ["0,0,100x100"], "background expiry does not interrupt the active delivery window");

console.log("Courier delivery lifecycle tests passed.");

async function testAnimationTiming() {
  console.log("Starting animation timing and state regression tests...");

  // Save originals
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const originalDateNow = Date.now;

  // Setup time mocking
  let mockTime = 10_000;
  Date.now = () => mockTime;

  const intervals = new Map<any, { cb: Function; ms: number }>();
  let nextIntervalId = 1;
  (global as any).setInterval = (cb: any, ms: any) => {
    const id = nextIntervalId++;
    intervals.set(id, { cb, ms: ms || 0 });
    return {
      id,
      unref: () => {},
    } as any;
  };
  (global as any).clearInterval = (timerObj: any) => {
    if (timerObj && timerObj.id) {
      intervals.delete(timerObj.id);
    }
  };

  const timeouts = new Map<number, { cb: Function; ms: number }>();
  let nextTimeoutId = 1;
  (global as any).setTimeout = (cb: any, ms: any) => {
    const id = nextTimeoutId++;
    timeouts.set(id, { cb, ms: ms || 0 });
    return id as any;
  };
  (global as any).clearTimeout = (id: any) => {
    timeouts.delete(id);
  };

  function tick(ms: number) {
    mockTime += ms;

    // Process timeouts (which trigger on window cleanup, etc.)
    for (const [id, t] of [...timeouts.entries()]) {
      t.cb();
      timeouts.delete(id);
    }

    // Process interval steps for animation
    for (const [id, inv] of [...intervals.entries()]) {
      inv.cb();
    }
  }

  // Clear global manager state
  manager.queues.clear();
  manager.rateLimits.clear();
  manager.dismissCallbacks.clear();

  // Setup mock electron
  const loadedUrls: string[] = [];
  const sentMessages: { channel: string; args: any[] }[] = [];
  const positionHistory: { x: number; y: number }[] = [];
  const createdWindows: any[] = [];
  const mockIpcListeners: Record<string, Function[]> = {};

  const mockElectron = {
    screen: {
      getAllDisplays: () => [
        { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, id: 1 }
      ],
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, id: 1 }),
      getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, id: 1 }),
      on: () => {},
      off: () => {},
    },
    app: {
      getAppPath: () => "/mock-app-path",
      on: () => {},
    },
    ipcMain: {
      on: (channel: string, listener: Function) => {
        if (!mockIpcListeners[channel]) {
          mockIpcListeners[channel] = [];
        }
        mockIpcListeners[channel].push(listener);
      },
      removeListener: (channel: string, listener: Function) => {
        if (mockIpcListeners[channel]) {
          mockIpcListeners[channel] = mockIpcListeners[channel].filter(l => l !== listener);
        }
      }
    },
    BrowserWindow: class MockBrowserWindow {
      public x: number;
      public y: number;
      public options: any;
      public isDestroyedFlag = false;
      public webContents: any;
      public menu: any = null;
      public visibleOnAllWorkspaces = false;
      public listeners: Record<string, Function[]> = {};

      constructor(options: any) {
        this.options = options;
        this.x = options.x;
        this.y = options.y;
        createdWindows.push(this);

        this.webContents = {
          isDestroyed: () => this.isDestroyedFlag,
          send: (channel: string, ...args: any[]) => {
            sentMessages.push({ channel, args });
          },
          setWindowOpenHandler: () => {},
          on: () => {},
          loadURL: async (url: string) => {
            loadedUrls.push(url);
          }
        };
      }

      isDestroyed() {
        return this.isDestroyedFlag;
      }

      async loadURL(url: string) {
        loadedUrls.push(url);
      }

      setMenu(menu: any) {
        this.menu = menu;
      }

      setVisibleOnAllWorkspaces(val: boolean, options: any) {
        this.visibleOnAllWorkspaces = val;
      }

      getPosition() {
        return [this.x, this.y];
      }

      setPosition(x: number, y: number) {
        this.x = x;
        this.y = y;
        positionHistory.push({ x, y });
      }

      showInactive() {}

      getContentBounds() {
        return { x: this.x, y: this.y, width: this.options.width, height: this.options.height };
      }

      destroy() {
        this.isDestroyedFlag = true;
        if (this.listeners["closed"]) {
          for (const cb of this.listeners["closed"]) {
            cb();
          }
        }
      }

      once(event: string, callback: Function) {
        if (!this.listeners[event]) {
          this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
      }
    }
  };

  _setMockElectron(mockElectron);

  const testCourier = {
    pluginId: "local.alpha",
    assetName: "courier",
    layout: { frameWidth: 256, frameHeight: 256, frames: 6, durationMs: 720 },
    version: "1.2.3"
  };
  manager.register(
    "local.alpha",
    { key: "delivery-timing", courier: { kind: "sprite", name: "courier" }, title: "Mail", detail: "Arriving", expiresAt: Date.now() + 100_000 },
    testCourier
  );

  // Allow native Promise microtasks to process so window construction completes
  await new Promise(resolve => setImmediate(resolve));

  // Assert window was created
  assert.equal(testActiveWindows.size, 1, "Should create 1 window on display 0,0,1920x1080");
  const win = testActiveWindows.get("0,0,1920x1080");
  assert.ok(win, "Active window should be mapped under display key");

  // WebContents should have received 'running-left' at start
  const initialStateMsg = sentMessages.find(m => m.channel === "openpets:pet-reaction-state");
  assert.ok(initialStateMsg, "Should have sent reaction-state message");
  assert.equal(initialStateMsg.args[0], "running-left", "Should start with running-left state");

  // Initial x-coordinate check (offscreen start)
  // x_start is bounds.x - width = 0 - 480 = -480
  // x_end is bounds.x + bounds.width - width - 16 = 1920 - 480 - 16 = 1424
  assert.equal(win.x, -480, "Should start at x = -480");

  // Step 1: Advance by 7500ms (7.5 seconds, 1/2 of the 15000ms duration)
  tick(7500);
  // Linear easing value at t = 0.5: 0.5
  // expected x = -480 + 1904 * 0.5 = 472
  assert.equal(win.x, 472, "Position after 7500ms should be exactly 472 according to linear flight");

  // Step 2: Advance by another 3750ms (total 11250ms, 3/4 progress)
  tick(3750);
  // Linear easing value at t = 0.75: 0.75
  // expected x = -480 + 1904 * 0.75 = 948
  assert.equal(win.x, 948, "Position after 11250ms should be exactly 948");

  // Verify it has not completed yet
  assert.ok(!sentMessages.some(m => m.channel === "openpets:pet-reaction-state" && m.args[0] === "waiting"), "Should not receive waiting state before 15000ms");

  // Step 3: Advance to exactly 15000ms duration (which completes the animation)
  tick(3750);
  assert.equal(win.x, 1424, "Should be parked at final destination x = 1424 after 15000ms");

  // Verify transition state changed to 'waiting'
  const waitingStateMsg = sentMessages.find(m => m.channel === "openpets:pet-reaction-state" && m.args[0] === "waiting");
  assert.ok(waitingStateMsg, "Should transition to waiting state upon animation completion");

  // Verify the animation interval timer has been cleared
  assert.ok(!intervals.has(2), "Animation interval should be cleared after arrival");

  // Clean up
  stopDeliverySystem();
  // Process the setTimeout on destroy
  tick(200);

  // Restore originals
  global.setInterval = originalSetInterval;
  global.clearInterval = originalClearInterval;
  global.setTimeout = originalSetTimeout;
  global.clearTimeout = originalClearTimeout;
  Date.now = originalDateNow;
  _setMockElectron(null);

  console.log("Animation timing and state regression tests passed!");
}

testAnimationTiming()
  .then(() => {
    console.log("All courier delivery tests passed successfully.");
  })
  .catch((err) => {
    console.error("Courier delivery tests failed:", err);
    process.exit(1);
  });
