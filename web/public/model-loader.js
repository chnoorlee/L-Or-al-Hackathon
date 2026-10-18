/* Download on the worker so slow first visits never block camera presentation. */
self.loadTryOnModel = async (path, expectedBytes, label) => {
  const report = text => self.postMessage({ type: 'loading', text });
  report(`正在下载${label}模型，首次打开需要稍等…`);
  const response = await fetch(new URL(path, self.location.href));
  if (!response.ok) throw new Error(`Model download: HTTP ${response.status}`);
  const bytes = new Uint8Array(expectedBytes);
  if (response.body) {
    const reader = response.body.getReader();
    let received = 0, reportedAt = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (received + value.length > expectedBytes) throw new Error('Unexpected model size');
        bytes.set(value, received); received += value.length;
        const now = performance.now();
        if (now - reportedAt > 500 || received === expectedBytes) {
          report(`正在下载${label}模型 · ${Math.floor(received / expectedBytes * 100)}%`);
          reportedAt = now;
        }
      }
      if (received !== expectedBytes) throw new Error('Incomplete model download');
    } finally { reader.releaseLock(); }
  } else {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength !== expectedBytes) throw new Error('Unexpected model size');
    bytes.set(new Uint8Array(buffer));
  }
  report(`正在加载${label}定位引擎，镜头可继续移动…`);
  return bytes;
};
