import { describe, expect, it, vi } from "vitest";
import {
  AnalysisCoordinator,
  SessionStore,
  type Clock,
  type TimerApi,
} from "../../miniprogram/session";

class FakeClock implements Clock {
  constructor(public value = 0) {}

  now(): number {
    return this.value;
  }
}

class ManualTimers implements TimerApi {
  readonly delays: number[] = [];
  private sequence = 0;
  private readonly callbacks = new Map<number, () => void>();

  setTimeout(callback: () => void, delayMs: number): number {
    this.sequence += 1;
    this.delays.push(delayMs);
    this.callbacks.set(this.sequence, callback);
    return this.sequence;
  }

  clearTimeout(handle: unknown): void {
    this.callbacks.delete(handle as number);
  }

  fireAll(): void {
    const pending = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of pending) {
      callback();
    }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function readyStore(clock = new FakeClock()) {
  const store = new SessionStore<string, string, string>({
    catalogVersion: "catalog-v1",
    clock,
  });
  await store.selectImage({ image: "pixels", imageVersion: "image-v1" });
  const identity = store.getImageIdentity();
  expect(identity).not.toBeNull();
  store.setSample(identity!, "sample", true);
  return store;
}

describe("AnalysisCoordinator", () => {
  it("publishes stages, commits a valid result, and releases work resources", async () => {
    const store = await readyStore();
    const timers = new ManualTimers();
    const cleanup = vi.fn();
    const coordinator = new AnalysisCoordinator(store, { timers });

    const outcome = await coordinator.run(async (context) => {
      expect(context.setStage("extracting_color")).toBe(true);
      expect(context.setStage("finding_candidates")).toBe(true);
      context.deferCleanup(cleanup);
      return "result-v1";
    });

    expect(outcome).toEqual({
      kind: "completed",
      result: "result-v1",
      cleanupErrors: [],
    });
    expect(cleanup).toHaveBeenCalledWith("completed");
    expect(store.getSnapshot()).toMatchObject({
      phase: "RESULT",
      result: "result-v1",
    });
  });

  it("times out at 15 seconds, releases resources, and rejects a late result", async () => {
    const store = await readyStore();
    const timers = new ManualTimers();
    const cleanup = vi.fn();
    const lateResult = deferred<string>();
    const coordinator = new AnalysisCoordinator(store, { timers });

    const running = coordinator.run(async (context) => {
      context.deferCleanup(cleanup);
      return lateResult.promise;
    });
    expect(timers.delays).toEqual([15_000]);
    timers.fireAll();

    await expect(running).resolves.toEqual({
      kind: "timeout",
      cleanupErrors: [],
    });
    expect(cleanup).toHaveBeenCalledWith("timeout");
    expect(store.getSnapshot()).toMatchObject({
      phase: "ROI_READY",
      result: null,
      error: { code: "analysis_timeout", retryable: true },
    });

    lateResult.resolve("late-result");
    await Promise.resolve();
    expect(store.getSnapshot().result).toBeNull();
  });

  it("rejects a result returned after the deadline even before the timer callback runs", async () => {
    const clock = new FakeClock();
    const store = await readyStore(clock);
    const timers = new ManualTimers();
    const coordinator = new AnalysisCoordinator(store, { clock, timers });

    const outcome = await coordinator.run(async () => {
      clock.value = 15_001;
      return "too-late";
    });

    expect(outcome).toEqual({ kind: "timeout", cleanupErrors: [] });
    expect(store.getSnapshot()).toMatchObject({
      phase: "ROI_READY",
      result: null,
      error: { code: "analysis_timeout", retryable: true },
    });
  });

  it("classifies an error thrown after the deadline as a timeout", async () => {
    const clock = new FakeClock();
    const store = await readyStore(clock);
    const timers = new ManualTimers();
    const coordinator = new AnalysisCoordinator(store, { clock, timers });

    const outcome = await coordinator.run(async () => {
      clock.value = 15_001;
      throw new Error("late worker failure");
    });

    expect(outcome).toEqual({ kind: "timeout", cleanupErrors: [] });
    expect(store.getSnapshot()).toMatchObject({
      phase: "ROI_READY",
      result: null,
      error: { code: "analysis_timeout", retryable: true },
    });
  });

  it("cancels on app hide without treating background time as activity", async () => {
    const clock = new FakeClock(10);
    const store = await readyStore(clock);
    const timers = new ManualTimers();
    const pending = deferred<string>();
    const coordinator = new AnalysisCoordinator(store, { timers });
    const running = coordinator.run(() => pending.promise);

    clock.value = 50;
    expect(coordinator.cancel("hidden")).toBe(true);
    await expect(running).resolves.toEqual({
      kind: "cancelled",
      reason: "hidden",
      cleanupErrors: [],
    });
    expect(store.getSnapshot()).toMatchObject({
      phase: "ROI_READY",
      lastActivityAt: 10,
      result: null,
    });

    pending.resolve("late-result");
    await Promise.resolve();
  });

  it("returns a generic retryable failure and reports cleanup errors separately", async () => {
    const store = await readyStore();
    const cleanupFailure = new Error("cleanup-only");
    const coordinator = new AnalysisCoordinator(store, {
      timers: new ManualTimers(),
    });

    const outcome = await coordinator.run(async (context) => {
      context.deferCleanup(() => {
        throw cleanupFailure;
      });
      throw new Error("sensitive-worker-detail");
    });

    expect(outcome.kind).toBe("failed");
    expect(outcome.cleanupErrors).toEqual([cleanupFailure]);
    expect(store.getSnapshot().error).toMatchObject({
      code: "analysis_failed",
      retryable: true,
    });
    expect(store.getSnapshot().error?.message).not.toContain("sensitive");
  });

  it("releases resources registered by a worker after timeout", async () => {
    const store = await readyStore();
    const timers = new ManualTimers();
    const resumed = deferred<void>();
    const lateCleanup = vi.fn();
    const coordinator = new AnalysisCoordinator(store, { timers });

    const running = coordinator.run(async (context) => {
      await resumed.promise;
      context.deferCleanup(lateCleanup);
      return "late-result";
    });
    timers.fireAll();
    await expect(running).resolves.toMatchObject({ kind: "timeout" });

    resumed.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(lateCleanup).toHaveBeenCalledWith("timeout");
    expect(store.getSnapshot().result).toBeNull();
  });

  it("returns stale instead of throwing when analysis is started twice", async () => {
    const store = await readyStore();
    const timers = new ManualTimers();
    const firstResult = deferred<string>();
    const coordinator = new AnalysisCoordinator(store, { timers });
    const first = coordinator.run(() => firstResult.promise);
    const secondWorker = vi.fn(async () => "unexpected");

    await expect(coordinator.run(secondWorker)).resolves.toEqual({
      kind: "stale",
      cleanupErrors: [],
    });
    expect(secondWorker).not.toHaveBeenCalled();

    firstResult.resolve("result-v1");
    await expect(first).resolves.toMatchObject({
      kind: "completed",
      result: "result-v1",
    });
  });
});
