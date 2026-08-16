/**
 * The attribution footer, in a real browser — a licence check, not a UI check.
 *
 * ODbL-1.0 requires the notice to be shown to users of the app. "In the DOM"
 * does not discharge that: a credit that is `display:none`, transparent,
 * zero-sized, or four screens below the fold is one nobody reads. So every
 * assertion here is about what a person can actually SEE:
 *
 *   * the footer is visible per Playwright's own definition (rendered, in the
 *     layout, non-empty box) AND its box lies inside the viewport with the page
 *     unscrolled — including with a photo loaded, which is when the page grows
 *     tall enough to bury a document-end footer;
 *   * the text is opaque and non-empty;
 *   * the contrast between the text colour and the surface behind it is
 *     computed with the WCAG 2.x relative-luminance formula and asserted at
 *     4.5:1, in both colour schemes;
 *   * the required-vs-courtesy distinction is carried by words, so it survives
 *     greyscale and a screen reader;
 *   * the licence link is reachable from the keyboard.
 *
 * The WCAG numbers are the published constants (0.2126/0.7152/0.0722, the 0.055
 * offset, the 2.4 exponent, the 0.05 flare term and the 4.5:1 AA threshold for
 * body text), not values read off this app.
 */

import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Locator, type Page } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const GORNERGRAT = resolve(HERE, '../../fixtures/photos/gornergrat-matterhorn.jpg');

/** WCAG 2.x relative luminance of an `rgb(...)` / `rgba(...)` string. */
function luminance(colour: string): number {
  const parts = colour.match(/[\d.]+/g) ?? [];
  const channels = parts.slice(0, 3).map((value) => {
    const srgb = Number(value) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = channels;
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/** The colour actually painted behind an element (walking past `transparent`). */
async function paintedBackground(locator: Locator): Promise<string> {
  return locator.evaluate((node: Element) => {
    let current: Element | null = node;
    while (current !== null) {
      const colour = getComputedStyle(current).backgroundColor;
      const alpha = colour.match(/rgba?\([^)]*?,\s*([\d.]+)\)\s*$/);
      const opaque = colour !== 'transparent' && (alpha === null || Number(alpha[1]) > 0.9);
      if (opaque) return colour;
      current = current.parentElement;
    }
    return 'rgb(255, 255, 255)';
  });
}

/** Is the element's box inside the viewport as the page currently stands? */
async function insideViewport(locator: Locator): Promise<boolean> {
  return locator.evaluate((node: Element) => {
    const box = node.getBoundingClientRect();
    return (
      box.height > 0 &&
      box.width > 0 &&
      box.top >= 0 &&
      box.bottom <= window.innerHeight + 0.5 &&
      box.left >= 0 &&
      box.right <= window.innerWidth + 0.5
    );
  });
}

async function loadPhoto(page: Page, filePath: string): Promise<void> {
  await page.getByTestId('photo-input').setInputFiles(filePath);
  await expect(page.getByTestId('photo-name')).toContainText(basename(filePath));
}

test('the data credit is on screen before anything is touched', async ({ page }) => {
  await page.goto('/');
  const footer = page.getByTestId('attribution');

  await expect(footer).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await insideViewport(footer)).toBe(true);

  // ODbL-1.0's actual requirement, in the rendered text.
  await expect(footer).toContainText('OpenStreetMap contributors');
  await expect(footer).toContainText('ODbL-1.0');
  await expect(footer).toContainText('Attribution required by ODbL-1.0');
  // Elevation is credited too — courtesy, and it says so rather than implying
  // an obligation that does not exist.
  await expect(footer).toContainText('SRTM');
  await expect(footer).toContainText('courtesy');

  // Not hidden by any of the usual ways of hiding something in plain sight.
  const style = await footer.evaluate((node: Element) => {
    const computed = getComputedStyle(node);
    return {
      display: computed.display,
      visibility: computed.visibility,
      opacity: Number(computed.opacity),
      fontSize: Number.parseFloat(computed.fontSize),
    };
  });
  expect(style.display).not.toBe('none');
  expect(style.visibility).toBe('visible');
  expect(style.opacity).toBeGreaterThan(0.99);
  expect(style.fontSize).toBeGreaterThanOrEqual(12);
});

test('the credit stays on screen once a photo fills the page', async ({ page }) => {
  await page.goto('/');
  await loadPhoto(page, GORNERGRAT);
  await expect(page.getByTestId('photo-image')).toBeVisible();

  // The page is now much taller than the window — this is exactly the state in
  // which a document-end footer disappears.
  const overflows = await page.evaluate(
    () => document.documentElement.scrollHeight > window.innerHeight + 50,
  );
  expect(overflows).toBe(true);

  const footer = page.getByTestId('attribution');
  await expect(footer).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await insideViewport(footer)).toBe(true);
  await expect(footer).toContainText('ODbL-1.0');

  // And still there at the foot of the document, where it stops covering the
  // last control rather than floating over it.
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await expect(footer).toBeVisible();
  expect(await insideViewport(footer)).toBe(true);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the credit is legible in the ${scheme} scheme (WCAG AA, 4.5:1)`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    const footer = page.getByTestId('attribution');
    await expect(footer).toBeVisible();

    const background = await paintedBackground(footer);
    for (const testId of ['credit-line']) {
      const line = page.getByTestId(testId).first();
      const colour = await line.evaluate((node: Element) => getComputedStyle(node).color);
      expect(contrastRatio(colour, background)).toBeGreaterThanOrEqual(4.5);
    }
    const linkColour = await page
      .locator('.credit__link')
      .first()
      .evaluate((node: Element) => getComputedStyle(node).color);
    expect(contrastRatio(linkColour, background)).toBeGreaterThanOrEqual(4.5);
  });
}

test('the credit never relies on colour, and its links are reachable', async ({ page }) => {
  await page.goto('/');
  const credits = page.getByTestId('credit');
  await expect(credits).toHaveCount(3);

  // Every credit says in words whether it is a condition or a courtesy.
  for (const credit of await credits.all()) {
    await expect(credit).toContainText(/Attribution required by|courtesy/);
  }

  // The ODbL credit is identified by its text, not by a colour or an icon.
  const odbl = credits.filter({ hasText: 'ODbL-1.0' });
  await expect(odbl).toHaveCount(1);
  await expect(odbl).toHaveAttribute('data-notice-required', 'true');

  // Links are underlined (so they are not links by colour alone) and focusable.
  const link = page.locator('.credit__link').first();
  await expect(link).toHaveAttribute('href', /opendatacommons\.org|openstreetmap\.org/);
  const decoration = await link.evaluate(
    (node: Element) => getComputedStyle(node).textDecorationLine,
  );
  expect(decoration).toContain('underline');
  await link.focus();
  await expect(link).toBeFocused();
});
