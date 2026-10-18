/* MediaPipe runs in a classic worker: no inference blocks the UI or the video element. */
importScripts('./model-loader.js', './vendor/vision_bundle.js');
let landmarker;
let mode = 'VIDEO';
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      const modelAssetBuffer = await self.loadTryOnModel('./vendor/face_landmarker.task', 3758596, '面部');
      const files = await Vision.FilesetResolver.forVisionTasks(new URL('./vendor/wasm', self.location.href).href);
      const options = { baseOptions: { modelAssetBuffer, delegate: 'GPU' },
        runningMode: mode, numFaces: 1, minFaceDetectionConfidence: 0.6, minFacePresenceConfidence: 0.6, minTrackingConfidence: 0.6 };
      let backend = 'GPU';
      try { landmarker = await Vision.FaceLandmarker.createFromOptions(files, options); }
      catch { options.baseOptions.delegate = 'CPU'; backend = 'CPU'; landmarker = await Vision.FaceLandmarker.createFromOptions(files, options); }
      self.postMessage({ type: 'ready', backend });
    } else if (data.type === 'detect') {
      const started = performance.now();
      try {
        const next = data.photo ? 'IMAGE' : 'VIDEO';
        if (next !== mode) { await landmarker.setOptions({ runningMode: next }); mode = next; }
        const result = data.photo ? landmarker.detect(data.bitmap) : landmarker.detectForVideo(data.bitmap, data.timestamp);
        self.postMessage({ type: 'result', token: data.token, timestamp: data.timestamp,
          points: result.faceLandmarks[0] || [], duration: performance.now() - started });
      } finally { data.bitmap.close(); }
    }
  } catch (error) { self.postMessage({ type: 'error', token: data.token, message: String(error?.message || error) }); }
};
