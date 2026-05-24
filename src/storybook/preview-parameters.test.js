/**
 * @file Tests for Storybook preview parameter override helpers.
 */

import {
  mergePreviewParameters,
  normalizePreviewOverrideModule,
} from './preview-parameters.js';

describe('preview parameter overrides', () => {
  const defaultParams = {
    actions: { argTypesRegex: '^on[A-Z].*' },
    a11y: {
      config: {
        detailedReport: true,
        detailedReportOptions: { html: true },
        rules: [{ id: 'color-contrast', enabled: true }],
      },
    },
    layout: 'fullscreen',
  };

  it('keeps defaults when no preview override module is present', () => {
    expect(mergePreviewParameters(defaultParams, undefined)).toEqual(
      defaultParams,
    );
    expect(normalizePreviewOverrideModule()).toEqual({});
  });

  it('normalizes default-exported parameter objects', () => {
    expect(
      normalizePreviewOverrideModule({
        default: {
          layout: 'centered',
        },
      }),
    ).toEqual({ layout: 'centered' });
  });

  it('normalizes Storybook-shaped parameter exports', () => {
    expect(
      normalizePreviewOverrideModule({
        parameters: {
          layout: 'padded',
        },
      }),
    ).toEqual({ layout: 'padded' });

    expect(
      normalizePreviewOverrideModule({
        default: {
          parameters: {
            layout: 'centered',
          },
        },
      }),
    ).toEqual({ layout: 'centered' });
  });

  it('merges layout overrides without dropping default a11y parameters', () => {
    expect(
      mergePreviewParameters(defaultParams, { layout: 'centered' }),
    ).toEqual({
      ...defaultParams,
      layout: 'centered',
    });
  });

  it('allows a11y settings to be overridden while preserving nested defaults', () => {
    expect(
      mergePreviewParameters(defaultParams, {
        a11y: {
          config: {
            detailedReport: false,
          },
        },
      }),
    ).toEqual({
      ...defaultParams,
      a11y: {
        config: {
          detailedReport: false,
          detailedReportOptions: { html: true },
          rules: [{ id: 'color-contrast', enabled: true }],
        },
      },
    });
  });
});
