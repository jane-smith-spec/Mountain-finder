/**
 * Reading a dropped file into a `LoadedPhoto` — the app's only browser-API
 * module besides the components themselves.
 *
 * Two independent facts are collected here and never conflated:
 *   - what the file's EXIF *claims* (`extractPhotoExif`, unchanged, no guesses);
 *   - how big the decoded image actually *is* (measured from the bitmap).
 *
 * Nothing else happens. No defaulting, no inference, no network.
 */

import { extractPhotoExif } from '../exif';
import type { LoadedPhoto } from './state';

/** Thrown for input this app cannot read; the message is shown to the user. */
export class PhotoReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhotoReadError';
  }
}

const JPEG_EXTENSION = /\.(jpe?g)$/i;

/** JPEG only: it is the format that carries the EXIF this app is built around. */
export function isSupportedPhoto(file: File): boolean {
  return file.type === 'image/jpeg' || (file.type === '' && JPEG_EXTENSION.test(file.name));
}

/** Measure the decoded bitmap. Rejects if the browser cannot decode the file. */
async function measureImage(url: string): Promise<{ widthPx: number; heightPx: number }> {
  const image = new Image();
  image.src = url;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => {
      resolve();
    };
    image.onerror = () => {
      reject(new PhotoReadError('The browser could not decode that file as an image.'));
    };
  });
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    throw new PhotoReadError('That image decoded to zero pixels.');
  }
  return { widthPx: image.naturalWidth, heightPx: image.naturalHeight };
}

/**
 * Read one dropped/picked file. The returned `url` is an object URL owned by
 * the caller, who must revoke it when the photo is replaced.
 */
export async function readPhotoFile(file: File): Promise<LoadedPhoto> {
  if (!isSupportedPhoto(file)) {
    throw new PhotoReadError(`${file.name} is not a JPEG. Drop a .jpg photo.`);
  }
  const url = URL.createObjectURL(file);
  try {
    const [{ widthPx, heightPx }, exif] = await Promise.all([
      measureImage(url),
      // A photo with no EXIF at all resolves to `{}` — that is a valid result,
      // not an error, and the panel shows it as nine fields needing input.
      extractPhotoExif(file),
    ]);
    return { fileName: file.name, url, widthPx, heightPx, exif };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/** First supported file in a drop, if any. */
export function firstPhotoFrom(list: FileList | null): File | undefined {
  if (list === null) return undefined;
  for (let index = 0; index < list.length; index += 1) {
    const file = list.item(index);
    if (file !== null) return file;
  }
  return undefined;
}
