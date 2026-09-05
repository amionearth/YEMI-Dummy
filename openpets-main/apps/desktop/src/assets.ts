import { join } from "node:path";

import { app, nativeImage, type NativeImage } from "electron";

const trayIconRelativePath = join("assets", "tray-icon.png");
const appIconRelativePath = join("assets", "app-icon.png");
let cachedAppIcon: NativeImage | null = null;

export function createAppIcon(): NativeImage {
  if (cachedAppIcon && !cachedAppIcon.isEmpty()) return cachedAppIcon;

  const assetPath = join(app.getAppPath(), appIconRelativePath);
  const assetImage = nativeImage.createFromPath(assetPath);

  if (!assetImage.isEmpty()) {
    cachedAppIcon = assetImage;
    return cachedAppIcon;
  }

  console.error(`OpenPets app icon asset could not be loaded from ${assetPath}; using generated fallback icon.`);
  cachedAppIcon = createFallbackTrayIcon();
  return cachedAppIcon;
}

export function createTrayIcon(): NativeImage {
  const assetPath = join(app.getAppPath(), trayIconRelativePath);
  const assetImage = nativeImage.createFromPath(assetPath);

  if (!assetImage.isEmpty()) {
    // Render the tray icon as a full-colour image. We intentionally do NOT
    // mark it as a macOS template image: template images are drawn as a
    // monochrome (black) silhouette derived from the alpha channel, which
    // discarded the colour artwork and made the tray icon appear fully black.
    return assetImage.resize({ width: 22, height: 22 });
  }

  console.error(`OpenPets tray icon asset could not be loaded from ${assetPath}; using generated fallback icon.`);
  return createFallbackTrayIcon();
}

function createFallbackTrayIcon(): NativeImage {
  const size = 32;
  const bitmap = Buffer.alloc(size * size * 4, 0);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (isRoundedSquarePixel(x, y, size, 8)) {
        setPixel(bitmap, size, x, y, 17, 24, 39, 255);
      }
    }
  }

  drawCircle(bitmap, size, 11, 13, 3, 249, 250, 251, 255);
  drawCircle(bitmap, size, 21, 13, 3, 249, 250, 251, 255);
  drawCircle(bitmap, size, 11, 13, 1, 17, 24, 39, 255);
  drawCircle(bitmap, size, 21, 13, 1, 17, 24, 39, 255);

  for (let x = 10; x <= 22; x += 1) {
    const y = Math.round(21 + Math.sin((x - 10) / 12 * Math.PI) * 3);
    drawCircle(bitmap, size, x, y, 1, 249, 250, 251, 255);
  }

  const image = nativeImage.createFromBitmap(bitmap, {
    width: size,
    height: size,
    scaleFactor: 1,
  });

  if (image.isEmpty()) {
    console.error("OpenPets tray icon creation produced an empty image.");
  }

  // Keep the generated fallback in full colour as well (no template image),
  // so it matches the colour tray artwork instead of rendering black on macOS.
  return image;
}

function isRoundedSquarePixel(x: number, y: number, size: number, radius: number): boolean {
  const left = radius;
  const right = size - radius - 1;
  const top = radius;
  const bottom = size - radius - 1;

  if (x >= left && x <= right) return true;
  if (y >= top && y <= bottom) return true;

  const cornerX = x < left ? left : right;
  const cornerY = y < top ? top : bottom;
  const distanceSquared = (x - cornerX) ** 2 + (y - cornerY) ** 2;

  return distanceSquared <= radius ** 2;
}

function drawCircle(
  bitmap: Buffer,
  size: number,
  centerX: number,
  centerY: number,
  radius: number,
  red: number,
  green: number,
  blue: number,
  alpha: number,
): void {
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2) {
        setPixel(bitmap, size, x, y, red, green, blue, alpha);
      }
    }
  }
}

function setPixel(
  bitmap: Buffer,
  size: number,
  x: number,
  y: number,
  red: number,
  green: number,
  blue: number,
  alpha: number,
): void {
  const offset = (y * size + x) * 4;
  bitmap[offset] = blue;
  bitmap[offset + 1] = green;
  bitmap[offset + 2] = red;
  bitmap[offset + 3] = alpha;
}
