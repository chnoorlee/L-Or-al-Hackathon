/** Fit the entire camera frame without stretching it; leave room to change makeup. */
export function fitLivePreview(
  sourceWidth: number, sourceHeight: number, viewportWidth: number, viewportHeight: number,
  faceMode: boolean,
): { width: number; height: number } {
  const scale = Math.min(viewportWidth / sourceWidth,
    faceMode ? viewportHeight * .42 / sourceHeight : Infinity);
  return { width: sourceWidth * scale, height: sourceHeight * scale };
}
