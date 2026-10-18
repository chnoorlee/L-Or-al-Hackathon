import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export const nativeApp = Capacitor.isNativePlatform();
const sharePath = 'even-tone-share';

// Only files explicitly exported by the user are written to this private cache.
// Keep the file until the next launch: Android share targets may read it after
// the share sheet returns. No camera frames or original photos are cached here.
export async function initializeNative(onBackground: () => void, onBack: () => boolean) {
  if (!nativeApp) return;
  try {
    const { files } = await Filesystem.readdir({ path: sharePath, directory: Directory.Cache });
    await Promise.all(files.map(file => Filesystem.deleteFile({ path: `${sharePath}/${file.name}`, directory: Directory.Cache })));
  } catch (error) {
    // A fresh install has no export directory. Other cleanup failures are visible.
    if (!(error instanceof Error && /not exist|not found|doesn't exist|ENOENT/i.test(error.message))) {
      console.warn('Export cache cleanup could not complete');
    }
  }
  await App.addListener('appStateChange', ({ isActive }) => { if (!isActive) onBackground(); });
  if (Capacitor.getPlatform() === 'android') await App.addListener('backButton', () => { if (!onBack()) void App.minimizeApp(); });
}

export function canShareImage(blob: Blob): boolean {
  return nativeApp || !!navigator.canShare?.({ files: [new File([blob], 'even-tone-cover.png', { type: 'image/png' })] });
}

export async function shareImage(blob: Blob) {
  if (!nativeApp) {
    await navigator.share({ files: [new File([blob], 'even-tone-cover.png', { type: 'image/png' })], title: '匀色遮瑕预览' });
    return;
  }
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('图片读取失败，请重试'));
    reader.readAsDataURL(blob);
  });
  const { uri } = await Filesystem.writeFile({
    path: `${sharePath}/preview-${Date.now()}.png`, data, directory: Directory.Cache, recursive: true,
  });
  await Share.share({ files: [uri], title: '匀色遮瑕预览', dialogTitle: '保存或分享预览' });
}
