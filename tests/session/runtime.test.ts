import { describe, expect, it } from "vitest";
import {
  ApplicationSessionRuntime,
  type Clock,
} from "../../miniprogram/session";

class FakeClock implements Clock {
  now(): number {
    return 10;
  }
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("ApplicationSessionRuntime", () => {
  it("shares one image identity from selection through fixed pixel materialization", async () => {
    const runtime = new ApplicationSessionRuntime({
      catalogVersion: "catalog-v1",
      clock: new FakeClock(),
    });
    const identity = await runtime.selectImage({
      tempFilePath: "wxfile://source.jpg",
      size: 80,
      width: 4,
      height: 3,
      orientation: "right",
      format: "jpg",
    });
    const selected = runtime.store.getSnapshot();
    expect(selected.image?.analysis).toBeNull();
    expect(selected.image?.analysisPlan).toMatchObject({
      width: 3,
      height: 4,
      sourceOrientation: "right",
    });
    expect(selected.image?.captureEvidence).toMatchObject({
      calibrationMode: "uncalibrated",
      verificationStatus: "unverified",
      captureProfileId: null,
    });

    const plan = selected.image!.analysisPlan;
    const pixels = new Uint8ClampedArray(plan.width * plan.height * 4);
    expect(
      runtime.materializeImage(
        identity,
        {
          width: plan.width,
          height: plan.height,
          data: pixels,
          plan,
          sourceImageVersion: identity.imageVersion,
        },
        "wxfile://analysis.png",
      ),
    ).toBe(true);
    expect(runtime.store.getSnapshot().image?.analysis?.data).toBe(pixels);
    expect(runtime.store.getSnapshot().image?.previewRef).toBe(
      "wxfile://analysis.png",
    );
    expect(runtime.store.getSnapshot().revision).toBe(identity.revision);
  });

  it("rejects stale or dimensionally invalid pixel buffers", async () => {
    const runtime = new ApplicationSessionRuntime({ catalogVersion: "catalog-v1" });
    const identity = await runtime.selectImage({
      tempFilePath: "wxfile://source.jpg",
      size: null,
      width: 2,
      height: 2,
      orientation: "up",
      format: "jpg",
    });
    const plan = runtime.store.getSnapshot().image!.analysisPlan;
    const malformed = {
      width: plan.width,
      height: plan.height,
      data: new Uint8ClampedArray(3),
      plan,
      sourceImageVersion: identity.imageVersion,
    };

    expect(
      runtime.materializeImage(identity, malformed, "wxfile://analysis.png"),
    ).toBe(false);
    expect(
      runtime.materializeImage(
        { ...identity, revision: identity.revision + 1 },
        {
          ...malformed,
          data: new Uint8ClampedArray(plan.width * plan.height * 4),
        },
        "wxfile://analysis.png",
      ),
    ).toBe(false);
    expect(runtime.store.getSnapshot().image?.analysis).toBeNull();
  });

  it("returns the identity of each selection during overlapping cleanup", async () => {
    const runtime = new ApplicationSessionRuntime({ catalogVersion: "catalog-v1" });
    const cleanupGate = deferred();
    await runtime.selectImage(
      {
        tempFilePath: "wxfile://first.jpg",
        size: null,
        width: 2,
        height: 2,
        orientation: "up",
        format: "jpg",
      },
      () => cleanupGate.promise,
    );

    const second = runtime.selectImage({
      tempFilePath: "wxfile://second.jpg",
      size: null,
      width: 3,
      height: 2,
      orientation: "up",
      format: "jpg",
    });
    const thirdIdentity = await runtime.selectImage({
      tempFilePath: "wxfile://third.jpg",
      size: null,
      width: 4,
      height: 2,
      orientation: "up",
      format: "jpg",
    });

    cleanupGate.resolve();
    const secondIdentity = await second;
    expect(secondIdentity.imageVersion).toBe("image-2");
    expect(thirdIdentity.imageVersion).toBe("image-3");
    expect(runtime.store.getImageIdentity()).toEqual(thirdIdentity);
  });
});
