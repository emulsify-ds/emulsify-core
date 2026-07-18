#!/usr/bin/env node
/**
 * @file Browser assertions for the built mixed Storybook custom-element stories.
 */

import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import axe from 'axe-core';
import { launch } from 'puppeteer';
import { preview } from 'vite';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const diagnosticsDir =
  process.env.EMULSIFY_BROWSER_ARTIFACTS_DIR ||
  join(repoRoot, '.out/fixture-browser-diagnostics/mixed-storybook');
const customElementTag = 'fixture-greeting-card';
const propertyStoryId =
  'fixtures-mixed-storybook-custom-element--custom-element-card';
const attributeStoryId =
  'fixtures-mixed-storybook-custom-element--attribute-mode';
const defaultTimeout = 20_000;

function requireBuildDirectory(argument) {
  if (!argument) {
    throw new Error(
      'Usage: node scripts/test-custom-element-storybook.js <storybook-output-directory>',
    );
  }

  const buildDir = resolve(process.cwd(), argument);
  for (const fileName of ['index.html', 'index.json', 'iframe.html']) {
    if (!existsSync(join(buildDir, fileName))) {
      throw new Error(
        `Built Storybook file missing: ${join(buildDir, fileName)}`,
      );
    }
  }

  return buildDir;
}

function assertStoryIds(buildDir) {
  const storyIndex = JSON.parse(
    readFileSync(join(buildDir, 'index.json'), 'utf8'),
  );
  const entries = storyIndex.entries || storyIndex.stories || {};

  for (const storyId of [propertyStoryId, attributeStoryId]) {
    assert.ok(
      entries[storyId],
      `Built Storybook index is missing stable story ID "${storyId}".`,
    );
  }
}

async function startStorybookPreview(buildDir) {
  const server = await preview({
    build: {
      outDir: buildDir,
    },
    configFile: false,
    logLevel: 'silent',
    preview: {
      host: '127.0.0.1',
      port: 0,
      strictPort: true,
    },
    root: dirname(buildDir),
  });
  const address = server.httpServer.address();

  assert.ok(
    address && typeof address === 'object',
    'Vite preview did not expose a listening address.',
  );

  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  };
}

function storyUrl(baseUrl, storyId) {
  const url = new URL('/', baseUrl);
  url.searchParams.set('path', `/story/${storyId}`);
  url.searchParams.set('addonPanel', 'storybook/controls/panel');
  return url.href;
}

async function openStory(page, baseUrl, storyId, expectedHeading) {
  await page.goto(storyUrl(baseUrl, storyId), {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('#storybook-preview-iframe');
  await page.waitForFunction(
    ({ heading, tagName }) => {
      const iframe = document.querySelector('#storybook-preview-iframe');
      const element = iframe?.contentDocument?.querySelector(tagName);
      return (
        element?.shadowRoot
          ?.querySelector('[data-testid="heading"]')
          ?.textContent?.trim() === heading
      );
    },
    { timeout: defaultTimeout },
    {
      heading: expectedHeading,
      tagName: customElementTag,
    },
  );

  const iframe = await page.$('#storybook-preview-iframe');
  const frame = await iframe?.contentFrame();
  assert.ok(frame, `Preview frame did not load story "${storyId}".`);
  return frame;
}

function controlSelectors(storyId, argName) {
  return [`#control-${storyId}-${argName}`, `#control-${argName}`];
}

async function findControl(page, storyId, argName) {
  const selectors = controlSelectors(storyId, argName);
  const setControlSelector = `#set-${argName}`;

  await page.waitForFunction(
    ({ candidates, setter }) =>
      candidates.some((selector) => document.querySelector(selector)) ||
      document.querySelector(setter),
    { timeout: defaultTimeout },
    {
      candidates: selectors,
      setter: setControlSelector,
    },
  );

  const setControl = await page.$(setControlSelector);
  if (setControl) {
    await setControl.click();
    await page.waitForFunction(
      (candidates) =>
        candidates.some((selector) => document.querySelector(selector)),
      { timeout: defaultTimeout },
      selectors,
    );
  }

  for (const selector of selectors) {
    const control = await page.$(selector);
    if (control) {
      return control;
    }
  }

  throw new Error(
    `Storybook control "${argName}" was not found for "${storyId}".`,
  );
}

async function replaceTextControl(page, storyId, argName, value) {
  const control = await findControl(page, storyId, argName);
  await control.evaluate((input) => {
    input.focus();
    input.select();
  });
  await control.type(value);
}

async function toggleBooleanControl(page, storyId, argName) {
  const control = await findControl(page, storyId, argName);
  await control.evaluate((input) => input.click());
}

async function readCustomElementState(frame) {
  return frame.evaluate((tagName) => {
    const element = document.querySelector(tagName);
    if (!element) {
      return null;
    }

    const shadowRoot = element.shadowRoot;
    const text = (testId) =>
      shadowRoot
        ?.querySelector(`[data-testid="${testId}"]`)
        ?.textContent?.trim() || '';
    const slot = shadowRoot?.querySelector('[data-testid="default-slot"]');

    return {
      assignedSlotText:
        slot
          ?.assignedNodes({ flatten: true })
          .map((node) => node.textContent)
          .join('')
          .trim() || '',
      attributes: Object.fromEntries(
        element
          .getAttributeNames()
          .map((name) => [name, element.getAttribute(name)]),
      ),
      bodyText: text('body'),
      eventCount: element.dataset.eventCount,
      eventHeading: element.dataset.eventHeading,
      eventIsCustom: element.dataset.eventIsCustom,
      featuredText:
        shadowRoot
          ?.querySelector('[data-testid="greeting-card"]')
          ?.getAttribute('data-featured') || '',
      headingProperty: element.heading,
      headingPropertyType: typeof element.heading,
      headingText: text('heading'),
      instanceMarker: element.dataset.instanceMarker,
      items: element.items,
      itemsAttribute: element.getAttribute('items'),
      itemsText: text('items'),
      lightDomText: element.textContent.trim(),
      onGreetingSelectType: typeof element.onGreetingSelect,
      optionalNote: element.optionalNote,
      optionalNoteText: text('optional-note'),
      outerHTML: element.outerHTML,
      shadowHTML: shadowRoot?.innerHTML || '',
      windowMarker: globalThis.__emulsifyBrowserMarker,
    };
  }, customElementTag);
}

async function markRenderedInstance(frame) {
  return frame.evaluate((tagName) => {
    const marker = `browser-marker-${crypto.randomUUID()}`;
    globalThis.__emulsifyBrowserMarker = marker;
    document.querySelector(tagName).dataset.instanceMarker = marker;
    return marker;
  }, customElementTag);
}

async function waitForElementState(frame, stateName, expectedValue) {
  await frame.waitForFunction(
    (tagName, state, expected) => {
      const element = document.querySelector(tagName);
      if (!element) {
        return false;
      }

      const shadowRoot = element.shadowRoot;
      if (state === 'heading') {
        return (
          element.heading === expected &&
          shadowRoot
            .querySelector('[data-testid="heading"]')
            .textContent.trim() === expected
        );
      }
      if (state === 'optional-note') {
        return (
          element.optionalNote === expected &&
          shadowRoot
            .querySelector('[data-testid="optional-note"]')
            .textContent.trim() === expected
        );
      }
      if (state === 'reset') {
        return (
          element.optionalNote === undefined &&
          shadowRoot
            .querySelector('[data-testid="optional-note"]')
            .textContent.trim() === '' &&
          element.heading === expected
        );
      }
      if (state === 'event') {
        return (
          element.dataset.eventCount === '1' &&
          element.dataset.eventIsCustom === 'true'
        );
      }
      if (state === 'featured') {
        return (
          element.hasAttribute('featured') === expected &&
          (!expected || element.getAttribute('featured') === '') &&
          shadowRoot
            .querySelector('[data-testid="greeting-card"]')
            .getAttribute('data-featured') === String(expected)
        );
      }

      return false;
    },
    { timeout: defaultTimeout },
    customElementTag,
    stateName,
    expectedValue,
  );
}

async function runAccessibilityAssertions(frame) {
  await frame.addScriptTag({ content: axe.source });
  const result = await frame.evaluate(async (tagName) => {
    const element = document.querySelector(tagName);
    const scan = await globalThis.axe.run(element);
    const buttonNamePass = scan.passes.find(({ id }) => id === 'button-name');

    return {
      buttonNameTargets:
        buttonNamePass?.nodes.map(({ target }) => target) || [],
      violations: scan.violations.map(({ id, nodes }) => ({
        id,
        targets: nodes.map(({ target }) => target),
      })),
    };
  }, customElementTag);

  assert.deepEqual(
    result.violations,
    [],
    `Axe found custom-element accessibility violations: ${JSON.stringify(
      result.violations,
    )}`,
  );
  assert.match(
    JSON.stringify(result.buttonNameTargets),
    /fixture-greeting-card.*button/u,
    'Axe did not report traversing from the custom element into its open shadow-root button.',
  );
}

async function runPropertyStoryAssertions(page, baseUrl) {
  const frame = await openStory(
    page,
    baseUrl,
    propertyStoryId,
    'Custom element fixture',
  );
  const initialState = await readCustomElementState(frame);

  assert.equal(initialState.headingPropertyType, 'string');
  assert.equal(initialState.headingProperty, 'Custom element fixture');
  assert.deepEqual(initialState.items, [{ label: 'Alpha' }, { label: 'Beta' }]);
  assert.equal(initialState.itemsAttribute, null);
  assert.equal(initialState.itemsText, 'AlphaBeta');
  assert.equal(initialState.attributes.featured, undefined);
  assert.equal(initialState.featuredText, 'true');
  assert.equal(initialState.lightDomText, 'Default slot content');
  assert.equal(initialState.assignedSlotText, 'Default slot content');
  assert.equal(initialState.onGreetingSelectType, 'undefined');

  const marker = await markRenderedInstance(frame);
  await replaceTextControl(
    page,
    propertyStoryId,
    'heading',
    'Updated through Controls',
  );
  await waitForElementState(frame, 'heading', 'Updated through Controls');

  const updatedState = await readCustomElementState(frame);
  assert.equal(updatedState.headingText, 'Updated through Controls');
  assert.equal(updatedState.instanceMarker, marker);
  assert.equal(updatedState.windowMarker, marker);

  await replaceTextControl(
    page,
    propertyStoryId,
    'optionalNote',
    'Temporary control value',
  );
  await waitForElementState(frame, 'optional-note', 'Temporary control value');

  await page.waitForSelector(
    'button[aria-label="Reset controls"], button[title="Reset controls"]',
  );
  await page.click(
    'button[aria-label="Reset controls"], button[title="Reset controls"]',
  );
  await waitForElementState(frame, 'reset', 'Custom element fixture');

  const resetState = await readCustomElementState(frame);
  assert.equal(resetState.instanceMarker, marker);
  assert.equal(resetState.windowMarker, marker);
  assert.equal(resetState.optionalNote, undefined);
  assert.equal(resetState.optionalNoteText, '');

  const host = await frame.$(customElementTag);
  const button = await host?.evaluateHandle((element) =>
    element.shadowRoot.querySelector('[data-testid="select"]'),
  );
  const buttonElement = button?.asElement();
  assert.ok(buttonElement, 'Custom-element event button was not rendered.');
  await buttonElement.click();
  await waitForElementState(frame, 'event');

  const eventState = await readCustomElementState(frame);
  assert.equal(eventState.eventHeading, 'Custom element fixture');
  assert.equal(eventState.onGreetingSelectType, 'undefined');

  await button.dispose();
  await host.dispose();
  await runAccessibilityAssertions(frame);
}

async function runAttributeStoryAssertions(page, baseUrl) {
  const frame = await openStory(
    page,
    baseUrl,
    attributeStoryId,
    'Attribute mode fixture',
  );
  const initialState = await readCustomElementState(frame);

  assert.equal(initialState.attributes.heading, 'Attribute mode fixture');
  assert.equal(initialState.headingProperty, undefined);
  assert.equal(initialState.attributes.featured, undefined);
  assert.equal(initialState.attributes.ongreetingselect, undefined);
  assert.equal(initialState.featuredText, 'false');
  assert.equal(initialState.assignedSlotText, 'Attribute mode slot content');

  await toggleBooleanControl(page, attributeStoryId, 'featured');
  await waitForElementState(frame, 'featured', true);

  await toggleBooleanControl(page, attributeStoryId, 'featured');
  await waitForElementState(frame, 'featured', false);
}

async function capturePreviewState(page) {
  try {
    return await page.evaluate((tagName) => {
      const iframe = document.querySelector('#storybook-preview-iframe');
      const element = iframe?.contentDocument?.querySelector(tagName);
      return {
        customElement: element
          ? {
              attributes: Object.fromEntries(
                element
                  .getAttributeNames()
                  .map((name) => [name, element.getAttribute(name)]),
              ),
              outerHTML: element.outerHTML,
              properties: {
                heading: element.heading,
                items: element.items,
                optionalNote: element.optionalNote,
              },
              shadowHTML: element.shadowRoot?.innerHTML || '',
            }
          : null,
        managerUrl: location.href,
        previewUrl: iframe?.contentWindow?.location.href,
      };
    }, customElementTag);
  } catch (error) {
    return {
      captureError: error.message,
    };
  }
}

async function writeDiagnostics(page, browserMessages, error) {
  rmSync(diagnosticsDir, { force: true, recursive: true });
  mkdirSync(diagnosticsDir, { recursive: true });

  const state = await capturePreviewState(page);
  writeFileSync(
    join(diagnosticsDir, 'failure.json'),
    `${JSON.stringify(
      {
        browserMessages,
        error: error.stack || error.message,
        state,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(diagnosticsDir, 'manager.html'), await page.content());
  await page.screenshot({
    fullPage: true,
    path: join(diagnosticsDir, 'manager.png'),
  });

  return diagnosticsDir;
}

async function main() {
  const buildDir = requireBuildDirectory(process.argv[2]);
  assertStoryIds(buildDir);
  rmSync(diagnosticsDir, { force: true, recursive: true });

  const browserMessages = [];
  let browser;
  let page;
  let previewServer;

  try {
    const startedPreview = await startStorybookPreview(buildDir);
    previewServer = startedPreview.server;
    browser = await launch({
      args: process.env.CI ? ['--disable-setuid-sandbox', '--no-sandbox'] : [],
      headless: true,
    });
    page = await browser.newPage();
    page.setDefaultTimeout(defaultTimeout);
    await page.setViewport({ height: 900, width: 1440 });
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) {
        browserMessages.push({
          location: message.location(),
          text: message.text(),
          type: message.type(),
        });
      }
    });
    page.on('pageerror', (error) => {
      browserMessages.push({
        text: error.stack || error.message,
        type: 'pageerror',
      });
    });
    page.on('requestfailed', (request) => {
      browserMessages.push({
        text: `${request.method()} ${request.url()}: ${
          request.failure()?.errorText || 'unknown failure'
        }`,
        type: 'requestfailed',
      });
    });

    await runPropertyStoryAssertions(page, startedPreview.url);
    await runAttributeStoryAssertions(page, startedPreview.url);
    console.log('✓ Built Storybook custom-element browser assertions passed.');
  } catch (error) {
    let diagnosticMessage = '';
    if (page) {
      try {
        const path = await writeDiagnostics(page, browserMessages, error);
        diagnosticMessage = `\nBrowser diagnostics: ${path}`;
      } catch (diagnosticError) {
        diagnosticMessage = `\nUnable to write browser diagnostics: ${diagnosticError.message}`;
      }
    }
    throw new Error(`${error.stack || error.message}${diagnosticMessage}`);
  } finally {
    await Promise.allSettled([
      Promise.resolve().then(() => browser?.close()),
      Promise.resolve().then(() => previewServer?.close()),
    ]);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
