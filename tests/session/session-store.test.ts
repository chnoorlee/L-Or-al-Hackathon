import { describe, expect, it, vi } from "vitest";
import { SessionStore, type Clock } from "../../miniprogram/session";

class FakeClock implements Clock {
  constructor(public value = 0) {}

  now(): number {
    return this.value;
  }

  advance(milliseconds: number): void {
    this.value += milliseconds;
  }
}

function createStore(clock = new FakeClock()) {
  return new SessionStore<string, string, string>({
    catalogVersion: "catalog-v1",
    idleTtlMs: 300_000,
    clock,
    createSessionId: (_now, sequence) => `session-${sequence}`,
    createTaskId: (_now, sequence) => `task-${sequence}`,
  });
}

function currentIdentity(store: SessionStore<string, string, string>) {
  const identity = store.getImageIdentity();
  expect(identity).not.toBeNull();
  return identity!;
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function prepareConfirmedSample(
  store: SessionStore<string, string, string>,
): Promise<void> {
  await store.selectImage({ image: "pixels-v1", imageVersion: "image-v1" });
  expect(store.setSample(currentIdentity(store), "sample-v1", true)).toBe(true);
}

describe("SessionStore", () => {
  it("moves through the documented phases and invalidates a result after editing", async () => {
    const store = createStore();
    expect(store.getSnapshot().phase).toBe("EMPTY");

    await store.selectImage({ image: "pixels-v1", imageVersion: "image-v1" });
    expect(store.getSnapshot()).toMatchObject({
      phase: "IMAGE_READY",
      sessionId: "session-1",
      revision: 1,
      imageVersion: "image-v1",
    });

    expect(store.setSample(currentIdentity(store), "draft", false)).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      phase: "IMAGE_READY",
      revision: 2,
      sampleConfirmed: false,
    });

    expect(store.setSample(currentIdentity(store), "confirmed", true)).toBe(true);
    const token = store.beginAnalysis(currentIdentity(store), vi.fn())!;
    expect(store.getSnapshot()).toMatchObject({
      phase: "ANALYZING",
      analysis: { stage: "checking_image" },
    });
    expect(store.setAnalysisStage(token, "extracting_color")).toBe(true);
    expect(store.completeAnalysis(token, "result-v1")).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      phase: "RESULT",
      result: "result-v1",
      analysis: null,
    });

    expect(store.setSample(currentIdentity(store), "adjusted", true)).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      phase: "ROI_READY",
      revision: 4,
      result: null,
      error: null,
    });
    expect(store.completeAnalysis(token, "late-result")).toBe(false);
    expect(store.getSnapshot().result).toBeNull();
  });

  it("accepts edits and a new analysis after cancellation advances the revision", async () => {
    const store = createStore();
    await prepareConfirmedSample(store);
    const originalIdentity = currentIdentity(store);
    const firstToken = store.beginAnalysis(originalIdentity, vi.fn())!;

    expect(store.cancelAnalysis(firstToken, "user")).toBe(true);
    expect(store.setSample(originalIdentity, "stale-edit", true)).toBe(false);

    const retryIdentity = currentIdentity(store);
    expect(retryIdentity.revision).toBe(originalIdentity.revision + 1);
    expect(store.setSample(retryIdentity, "retry-edit", true)).toBe(true);

    const editedIdentity = currentIdentity(store);
    expect(store.beginAnalysis(editedIdentity, vi.fn())).not.toBeNull();
  });

  it("binds tasks to session, revision, image, task, and catalog identities", async () => {
    const store = createStore();
    await prepareConfirmedSample(store);
    const cancel = vi.fn();
    const token = store.beginAnalysis(currentIdentity(store), cancel)!;

    expect(
      store.completeAnalysis({ ...token, sessionId: "another-session" }, "bad"),
    ).toBe(false);
    expect(
      store.completeAnalysis({ ...token, revision: token.revision + 1 }, "bad"),
    ).toBe(false);
    expect(
      store.completeAnalysis({ ...token, taskId: "another-task" }, "bad"),
    ).toBe(false);
    expect(
      store.completeAnalysis({ ...token, imageVersion: "another-image" }, "bad"),
    ).toBe(false);
    expect(
      store.completeAnalysis({ ...token, catalogVersion: "catalog-v2" }, "bad"),
    ).toBe(false);

    expect(store.invalidateCatalog("catalog-v2")).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith("catalog_changed");
    expect(store.getSnapshot()).toMatchObject({
      phase: "ROI_READY",
      catalogVersion: "catalog-v2",
      result: null,
    });
    expect(store.completeAnalysis(token, "late-result")).toBe(false);
    expect(store.invalidateCatalog("catalog-v2")).toBe(false);
  });

  it("materializes only the current un-sampled image without changing its identity", async () => {
    const clock = new FakeClock(10);
    const store = createStore(clock);
    await store.selectImage({ image: "metadata", imageVersion: "image-v1" });
    const identity = store.getImageIdentity();
    expect(identity).not.toBeNull();

    clock.advance(25);
    expect(store.materializeImage(identity!, "fixed-pixels")).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      phase: "IMAGE_READY",
      revision: identity!.revision,
      image: "fixed-pixels",
      lastActivityAt: 35,
    });
    expect(
      store.materializeImage(
        { ...identity!, imageVersion: "stale-image" },
        "stale-pixels",
      ),
    ).toBe(false);

    expect(store.setSample(currentIdentity(store), "draft", false)).toBe(true);
    expect(store.materializeImage(identity!, "too-late")).toBe(false);
    expect(store.getSnapshot().image).toBe("fixed-pixels");
  });

  it("releases replaced, restarted, and expired image resources", async () => {
    const clock = new FakeClock();
    const store = createStore(clock);
    const firstCleanup = vi.fn();
    const secondCleanup = vi.fn();
    const thirdCleanup = vi.fn();

    await store.selectImage({
      image: "first",
      imageVersion: "image-1",
      cleanup: firstCleanup,
    });
    await store.selectImage({
      image: "second",
      imageVersion: "image-2",
      cleanup: secondCleanup,
    });
    expect(firstCleanup).toHaveBeenCalledWith("image_replaced");

    await store.restart();
    expect(secondCleanup).toHaveBeenCalledWith("restart");
    expect(store.getSnapshot().phase).toBe("EMPTY");

    await store.selectImage({
      image: "third",
      imageVersion: "image-3",
      cleanup: thirdCleanup,
    });
    clock.advance(299_999);
    expect(await store.expireIfNeeded()).toBe(false);
    clock.advance(1);
    expect((await store.access()).phase).toBe("EMPTY");
    expect(thirdCleanup).toHaveBeenCalledWith("expired");
    expect(store.getSnapshot().error?.code).toBe("session_expired");
  });

  it("rejects an old sample write while replacement cleanup is pending", async () => {
    const store = createStore();
    const cleanupGate = deferred();
    await store.selectImage({
      image: "first",
      imageVersion: "image-1",
      cleanup: () => cleanupGate.promise,
    });
    const oldIdentity = currentIdentity(store);

    const replacing = store.selectImage({
      image: "second",
      imageVersion: "image-2",
    });
    expect(store.getSnapshot()).toMatchObject({
      image: "second",
      imageVersion: "image-2",
      sample: null,
    });
    expect(store.setSample(oldIdentity, "stale-sample", true)).toBe(false);
    expect(store.getSnapshot().sample).toBeNull();

    cleanupGate.resolve();
    await expect(replacing).resolves.toMatchObject({
      sessionId: "session-2",
      imageVersion: "image-2",
    });
  });

  it("keeps completed state transitions when image cleanup fails", async () => {
    const store = createStore();
    await store.selectImage({
      image: "first",
      imageVersion: "image-1",
      cleanup: () => Promise.reject(new Error("async cleanup failed")),
    });

    await expect(
      store.selectImage({ image: "second", imageVersion: "image-2" }),
    ).resolves.toMatchObject({ imageVersion: "image-2" });
    expect(store.getSnapshot()).toMatchObject({
      phase: "IMAGE_READY",
      image: "second",
    });

    await store.selectImage({
      image: "third",
      imageVersion: "image-3",
      cleanup: () => {
        throw new Error("sync cleanup failed");
      },
    });
    await expect(store.restart()).resolves.toBeUndefined();
    expect(store.getSnapshot().phase).toBe("EMPTY");
  });

  it("updates idle time on user activity but not on background stage updates", async () => {
    const clock = new FakeClock(100);
    const store = createStore(clock);
    await prepareConfirmedSample(store);
    const token = store.beginAnalysis(currentIdentity(store), vi.fn())!;
    expect(store.getSnapshot().lastActivityAt).toBe(100);

    clock.advance(200);
    store.setAnalysisStage(token, "finding_candidates");
    store.completeAnalysis(token, "result");
    expect(store.getSnapshot().lastActivityAt).toBe(100);

    store.touch();
    expect(store.getSnapshot().lastActivityAt).toBe(300);
  });

  it("does not let touch revive an expired foreground session", async () => {
    const clock = new FakeClock();
    const store = createStore(clock);
    const cleanup = vi.fn();
    await store.selectImage({
      image: "pixels-v1",
      imageVersion: "image-v1",
      cleanup,
    });

    clock.advance(300_000);
    store.touch();
    await Promise.resolve();

    expect(store.getSnapshot()).toMatchObject({
      phase: "EMPTY",
      image: null,
      lastActivityAt: null,
      error: { code: "session_expired" },
    });
    expect(cleanup).toHaveBeenCalledWith("expired");
  });

  it("fails closed when an expired session is mutated without access()", async () => {
    const sampleClock = new FakeClock();
    const sampleStore = createStore(sampleClock);
    await sampleStore.selectImage({
      image: "pixels-v1",
      imageVersion: "image-v1",
    });
    sampleClock.advance(300_000);
    const sampleIdentity = currentIdentity(sampleStore);
    expect(sampleStore.setSample(sampleIdentity, "late-sample", true)).toBe(false);
    expect(sampleStore.getSnapshot().phase).toBe("EMPTY");

    const analysisClock = new FakeClock();
    const analysisStore = createStore(analysisClock);
    await prepareConfirmedSample(analysisStore);
    analysisClock.advance(300_000);
    const analysisIdentity = currentIdentity(analysisStore);
    expect(analysisStore.beginAnalysis(analysisIdentity, vi.fn())).toBeNull();
    expect(analysisStore.getSnapshot().phase).toBe("EMPTY");

    const taskClock = new FakeClock();
    const taskStore = createStore(taskClock);
    await prepareConfirmedSample(taskStore);
    const cancel = vi.fn();
    const token = taskStore.beginAnalysis(currentIdentity(taskStore), cancel)!;
    taskClock.advance(300_000);
    expect(taskStore.setAnalysisStage(token, "extracting_color")).toBe(false);
    expect(cancel).toHaveBeenCalledWith("expired");
    expect(taskStore.completeAnalysis(token, "late-result")).toBe(false);
    expect(taskStore.getSnapshot().phase).toBe("EMPTY");

    const commerceClock = new FakeClock();
    const commerceStore = createStore(commerceClock);
    await prepareConfirmedSample(commerceStore);
    const commerceToken = commerceStore.beginAnalysis(
      currentIdentity(commerceStore),
      vi.fn(),
    )!;
    commerceStore.completeAnalysis(commerceToken, "result-v1");
    const commerceIdentity = {
      ...currentIdentity(commerceStore),
      catalogVersion: commerceStore.getSnapshot().catalogVersion,
    };
    commerceClock.advance(300_000);
    expect(
      commerceStore.setCommerceOperation(commerceIdentity, { status: "idle" }),
    ).toBe(false);
    expect(commerceStore.getSnapshot().phase).toBe("EMPTY");
  });
});
