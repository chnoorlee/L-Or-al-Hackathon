/* Loaded only when a hair-color layer is enabled; separate from face tracking. */
importScripts('./model-loader.js', './vendor/vision_bundle.js');
let segmenter;
let mode = 'IMAGE';
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      const modelAssetBuffer = await self.loadTryOnModel('./vendor/hair_segmenter.tflite', 781618, '头发');
      const files = await Vision.FilesetResolver.forVisionTasks(new URL('./vendor/wasm', self.location.href).href);
      const options = { baseOptions: { modelAssetBuffer, delegate: 'GPU' },
        runningMode: mode, outputConfidenceMasks: true, outputCategoryMask: false };
      let backend = 'GPU';
      try { segmenter = await Vision.ImageSegmenter.createFromOptions(files, options); }
      catch { options.baseOptions.delegate = 'CPU'; backend = 'CPU'; segmenter = await Vision.ImageSegmenter.createFromOptions(files, options); }
      self.postMessage({ type: 'ready', backend });
    } else if (data.type === 'detect') {
      try {
        const next = data.photo ? 'IMAGE' : 'VIDEO';
        if (mode !== next) { await segmenter.setOptions({ runningMode: next }); mode = next; }
        const result = data.photo ? segmenter.segment(data.bitmap) : segmenter.segmentForVideo(data.bitmap, data.timestamp);
        try {
          // Official model labels: 0 background, 1 hair.
          const mask = result.confidenceMasks[1], values = mask.getAsFloat32Array();
          const alpha = new Uint8Array(values.length);
          let count = 0;
          for (let i = 0; i < values.length; i++) {
            const t = Math.max(0, Math.min(1, (values[i] - .4) / .5));
            alpha[i] = Math.round(255 * t * t * (3 - 2 * t));
            if (alpha[i] > 128) count++;
          }
          self.postMessage({ type: 'result', token: data.token, timestamp: data.timestamp,
            width: mask.width, height: mask.height, alpha, count }, [alpha.buffer]);
        } finally { result.close(); }
      } finally { data.bitmap.close(); }
    }
  } catch (error) { self.postMessage({ type: 'error', token: data.token, message: String(error?.message || error) }); }
};
