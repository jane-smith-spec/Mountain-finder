/**
 * P5.1 / P5.2 self-check — the app shell driven in real Chromium, offline.
 *
 * Everything here runs against the committed fixture JPEGs in
 * `fixtures/photos/`, whose EXIF was authored byte-wise and is documented in
 * `fixtures/photos/README.md`. No network, no recorded HTTP, no live APIs: the
 * browser reads the file, `exifr` parses it, and `resolvePose` merges it — the
 * real code path, not a stub.
 *
 * Every expected number below is derived from the README's authored values by
 * hand, with the derivation written next to it:
 *
 *   45°55'25.32"N → 45 + 55/60 + 25.32/3600 = 45.9237
 *    6°52'09.84"E →  6 + 52/60 +  9.84/3600 =  6.8694
 *   hFov(f35=26)  = 2·atan(36/52) = 2·atan(9/13)   = 69.390307062467940°
 *   vFov(4:3)     : tan(v/2) = (9/13)·(3/4) = 27/52 → v = 2·atan(27/52)
 *                                                       = 54.879455896398610°
 *   ground        = GPS altitude 1035.5 m − eye height 1.6 m = 1033.9 m
 *
 * The field-of-view trim case uses the 3-4-5 triangle so the expectation is a
 * standard reference value: with a 4:3 frame and hFov = 90°, tan(vFov/2) = 3/4,
 * so vFov = 2·atan(3/4) = 73.739795291688042°.
 */

import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Locator, type Page } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const PHOTO_DIR = resolve(HERE, '../../fixtures/photos');

const CHAMONIX = resolve(PHOTO_DIR, 'chamonix-north-east.jpg');
const ACONCAGUA = resolve(PHOTO_DIR, 'aconcagua-south-west.jpg');
const STRIPPED = resolve(PHOTO_DIR, 'stripped-no-exif.jpg');

/** The nine pose fields, in POSE_FIELDS order. */
const POSE_FIELDS = [
  'lat',
  'lon',
  'groundElevationM',
  'eyeHeightM',
  'headingDeg',
  'pitchDeg',
  'rollDeg',
  'hFovDeg',
  'vFovDeg',
] as const;

/** Load a photo through the file-picker path (the keyboard-accessible one). */
async function pickPhoto(page: Page, filePath: string): Promise<void> {
  await page.getByTestId('photo-input').setInputFiles(filePath);
  await expect(page.getByTestId('photo-name')).toContainText(basename(filePath));
}

/**
 * Load a photo through the drag-and-drop path, with a real File built from the
 * fixture's actual bytes inside the page.
 */
async function dropPhoto(page: Page, filePath: string): Promise<void> {
  const bytes = await readFile(filePath);
  const dataTransfer = await page.evaluateHandle(
    ({ base64, name }: { base64: string; name: string }) => {
      const binary = atob(base64);
      const buffer = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        buffer[index] = binary.charCodeAt(index);
      }
      const transfer = new DataTransfer();
      transfer.items.add(new File([buffer], name, { type: 'image/jpeg' }));
      return transfer;
    },
    { base64: bytes.toString('base64'), name: basename(filePath) },
  );
  await page.getByTestId('dropzone').dispatchEvent('drop', { dataTransfer });
  await expect(page.getByTestId('photo-name')).toContainText(basename(filePath));
}

/** Read one of the full-precision numbers the overlay will consume. */
async function poseNumber(page: Page, attribute: string): Promise<number> {
  const raw = await page.getByTestId('overlay-pose').getAttribute(attribute);
  expect(raw, `overlay-pose is missing ${attribute}`).not.toBeNull();
  return Number(raw);
}

const field = (page: Page, name: string): Locator => page.getByTestId(`field-${name}`);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('app-title')).toHaveText('Mountain Finder');
});

test('EXIF autofills, and every field says where its value came from', async ({ page }) => {
  await pickPhoto(page, CHAMONIX);

  // --- values read from the photo itself -----------------------------------
  await expect(page.getByTestId('input-lat')).toHaveValue('45.9237');
  await expect(page.getByTestId('input-lon')).toHaveValue('6.8694');
  await expect(page.getByTestId('input-headingDeg')).toHaveValue('137.25');
  // 2·atan(9/13) = 69.390307…°, displayed to 3 dp.
  await expect(page.getByTestId('input-hFovDeg')).toHaveValue('69.39');
  // 2·atan(27/52) = 54.879455…°, displayed to 3 dp.
  await expect(page.getByTestId('input-vFovDeg')).toHaveValue('54.879');

  for (const name of ['lat', 'lon', 'headingDeg', 'hFovDeg', 'vFovDeg']) {
    await expect(field(page, name)).toHaveAttribute('data-source', 'exif');
    await expect(page.getByTestId(`badge-${name}`)).toHaveText('EXIF');
  }

  // --- and the ones the photo cannot supply --------------------------------
  await expect(field(page, 'groundElevationM')).toHaveAttribute('data-status', 'needs-manual');
  await expect(field(page, 'groundElevationM')).toHaveAttribute(
    'data-reason',
    'eye-height-required',
  );
  await expect(field(page, 'eyeHeightM')).toHaveAttribute('data-reason', 'absent-from-exif');
  // Empty, not zero: a 0 here would read as "sea level" / "dead level".
  await expect(page.getByTestId('input-groundElevationM')).toHaveValue('');
  await expect(page.getByTestId('input-pitchDeg')).toHaveValue('');
  await expect(page.getByTestId('missing-summary')).toHaveAttribute('data-missing-count', '4');

  // Nothing can run downstream while the pose is incomplete.
  await expect(page.getByTestId('overlay-pose-incomplete')).toBeVisible();

  // --- opting in to the standard assumptions -------------------------------
  await page.getByTestId('input-assumptions').check();
  // 1035.5 m (GPS, i.e. the camera) − 1.6 m eye height = 1033.9 m of terrain.
  await expect(page.getByTestId('input-groundElevationM')).toHaveValue('1033.9');
  await expect(page.getByTestId('badge-groundElevationM')).toHaveText('EXIF');
  await expect(page.getByTestId('input-eyeHeightM')).toHaveValue('1.6');
  await expect(page.getByTestId('badge-eyeHeightM')).toHaveText('Assumed');
  await expect(page.getByTestId('badge-pitchDeg')).toHaveText('Assumed');
  await expect(page.getByTestId('missing-summary')).toHaveAttribute('data-missing-count', '0');

  // --- a typed value outranks EXIF, and says so ----------------------------
  await page.getByTestId('input-lat').fill('46.5');
  await expect(page.getByTestId('badge-lat')).toHaveText('You');
  await expect(await poseNumber(page, 'data-lat')).toBeCloseTo(46.5, 10);
  await page.getByTestId('revert-lat').click();
  await expect(page.getByTestId('badge-lat')).toHaveText('EXIF');
  await expect(page.getByTestId('input-lat')).toHaveValue('45.9237');
});

test('drag-and-drop loads the same photo as the file picker', async ({ page }) => {
  await dropPhoto(page, CHAMONIX);
  await expect(page.getByTestId('input-headingDeg')).toHaveValue('137.25');
  await expect(page.getByTestId('badge-headingDeg')).toHaveText('EXIF');
});

test('an EXIF-stripped photo asks for all nine fields instead of showing zeros', async ({
  page,
}) => {
  await pickPhoto(page, STRIPPED);

  await expect(page.getByTestId('exif-empty')).toBeVisible();
  await expect(page.getByTestId('missing-summary')).toHaveAttribute('data-missing-count', '9');

  for (const name of POSE_FIELDS) {
    await expect(field(page, name), name).toHaveAttribute('data-status', 'needs-manual');
    await expect(field(page, name), name).toHaveAttribute('data-source', '');
    await expect(page.getByTestId(`badge-${name}`), name).toContainText('needs input');
    // The decisive assertion: an unknown field is EMPTY, never 0.
    await expect(page.getByTestId(`input-${name}`), name).toHaveValue('');
  }

  // The image itself is still measured — that is a fact about the pixels.
  await expect(page.getByTestId('decoded-dimensions')).toContainText('800');
  await expect(page.getByTestId('decoded-dimensions')).toContainText('600');

  await expect(page.getByTestId('overlay-pose')).toHaveCount(0);
  await expect(page.getByTestId('overlay-pose-incomplete')).toBeVisible();
  await expect(page.getByTestId('export-png')).toBeDisabled();
  await expect(page.getByTestId('export-state')).toHaveAttribute(
    'data-disabled-reason',
    '9 pose fields still need manual input.',
  );
});

test('a magnetic bearing is never quietly treated as true north', async ({ page }) => {
  await pickPhoto(page, ACONCAGUA);

  await expect(field(page, 'headingDeg')).toHaveAttribute('data-status', 'needs-manual');
  await expect(field(page, 'headingDeg')).toHaveAttribute(
    'data-reason',
    'magnetic-declination-required',
  );
  await expect(page.getByTestId('input-headingDeg')).toHaveValue('');
  await expect(page.getByTestId('state-headingDeg')).toContainText('MAGNETIC');
  // The raw reading is still shown, flagged, so the user can act on it.
  await expect(page.getByTestId('exif-summary')).toContainText('250.5° (MAGNETIC north)');

  // Southern/western hemispheres must come out negative.
  await expect(page.getByTestId('input-lat')).toHaveValue('-32.6535');
  await expect(page.getByTestId('input-lon')).toHaveValue('-70.011');

  // No 35 mm equivalent → no field of view, and it says exactly why.
  await expect(field(page, 'hFovDeg')).toHaveAttribute(
    'data-reason',
    'no-35mm-equivalent-focal-length',
  );

  // Supplying the declination is what unlocks it: 250.5 + 12.25 = 262.75.
  await page.getByTestId('input-declination').fill('12.25');
  await expect(field(page, 'headingDeg')).toHaveAttribute('data-status', 'resolved');
  await expect(page.getByTestId('input-headingDeg')).toHaveValue('262.75');
  await expect(page.getByTestId('badge-headingDeg')).toHaveText('EXIF');
});

test('trim sliders move the pose the overlay consumes by exactly the amount asked for', async ({
  page,
}) => {
  await pickPhoto(page, CHAMONIX);
  await page.getByTestId('input-assumptions').check();
  await expect(page.getByTestId('overlay-pose')).toBeVisible();
  expect(await poseNumber(page, 'data-heading-deg')).toBeCloseTo(137.25, 10);

  // --- keyboard path: one arrow press = one 0.25° step ---------------------
  const heading = page.getByTestId('trim-headingDeg');
  await heading.focus();
  await expect(heading).toBeFocused();
  for (let press = 0; press < 4; press += 1) await heading.press('ArrowRight');
  await expect(page.getByTestId('trim-headingDeg-readout')).toHaveAttribute('data-trim-deg', '1');
  // 137.25 + 4 × 0.25 = 138.25
  expect(await poseNumber(page, 'data-heading-deg')).toBeCloseTo(138.25, 10);

  await heading.fill('7.5');
  // 137.25 + 7.5 = 144.75
  expect(await poseNumber(page, 'data-heading-deg')).toBeCloseTo(144.75, 10);

  // --- pitch: 0 (assumed) − 2.5 = −2.5 -------------------------------------
  await page.getByTestId('trim-pitchDeg').fill('-2.5');
  expect(await poseNumber(page, 'data-pitch-deg')).toBeCloseTo(-2.5, 10);

  // --- field of view: the tangent relation, not a linear scaling -----------
  // Type an 80° horizontal FOV, then trim +10° to land on exactly 90°.
  // The frame is 800×600, so tan(vFov/2) = tan(45°)·(3/4) = 3/4 and
  // vFov = 2·atan(3/4) = 73.739795291688042° — the 3-4-5 triangle.
  await page.getByTestId('input-hFovDeg').fill('80');
  await expect(page.getByTestId('badge-hFovDeg')).toHaveText('You');
  await page.getByTestId('trim-hFovDeg').fill('10');
  expect(await poseNumber(page, 'data-hfov-deg')).toBeCloseTo(90, 10);
  expect(await poseNumber(page, 'data-vfov-deg')).toBeCloseTo(73.739795291688042, 9);

  // The panel still reports what the photo and the user said, un-trimmed:
  // the trim is an offset, not a rewrite of the metadata.
  await expect(page.getByTestId('input-headingDeg')).toHaveValue('137.25');
  await expect(page.getByTestId('input-hFovDeg')).toHaveValue('80');

  // --- reset puts every offset back to zero --------------------------------
  await page.getByTestId('trim-reset').click();
  expect(await poseNumber(page, 'data-heading-deg')).toBeCloseTo(137.25, 10);
  expect(await poseNumber(page, 'data-pitch-deg')).toBeCloseTo(0, 10);
  expect(await poseNumber(page, 'data-hfov-deg')).toBeCloseTo(80, 10);
  await expect(page.getByTestId('trim-reset')).toBeDisabled();
});

test('the overlay region is an obvious placeholder, and export is honestly disabled', async ({
  page,
}) => {
  await pickPhoto(page, CHAMONIX);
  await page.getByTestId('input-assumptions').check();
  await expect(page.getByTestId('missing-summary')).toHaveAttribute('data-missing-count', '0');

  // The photo is displayed at its own aspect ratio…
  await expect(page.getByTestId('photo-image')).toBeVisible();
  // …with a placeholder that cannot be mistaken for a result.
  await expect(page.getByTestId('overlay-placeholder')).toBeVisible();
  await expect(page.getByTestId('overlay-state')).toHaveAttribute('data-overlay', 'placeholder');
  await expect(page.getByTestId('overlay-state')).toContainText('No peaks have been computed');
  await expect(page.getByTestId('overlay-svg')).toHaveCount(0);

  // Export cannot lie about being ready when nothing has been rendered.
  await expect(page.getByTestId('export-png')).toBeDisabled();
  await expect(page.getByTestId('export-state')).toContainText('compositor is not wired up');
});

test('every control is labelled and reachable from the keyboard', async ({ page }) => {
  await pickPhoto(page, CHAMONIX);

  // Labels, not placeholders, are what a screen reader announces.
  await expect(page.getByLabel('Latitude')).toBeVisible();
  await expect(page.getByLabel('Heading', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Magnetic declination')).toBeVisible();
  await expect(page.getByLabel('Apply standard assumptions')).toBeVisible();
  await expect(page.getByLabel('Field-of-view trim')).toBeVisible();

  // The file picker is a real input, so it is in the tab order by default.
  const picker = page.getByTestId('photo-input');
  await picker.focus();
  await expect(picker).toBeFocused();

  // A needs-manual field points at its explanation for assistive tech.
  const describedBy = await page.getByTestId('input-groundElevationM').getAttribute('aria-describedby');
  expect(describedBy).toBe('pose-groundElevationM-state');
  await expect(page.getByTestId('state-groundElevationM')).toContainText('eye height');
});
