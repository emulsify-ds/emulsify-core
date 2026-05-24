/**
 * @file Tests for the Storybook Drupal behavior shim.
 */

describe('Storybook Drupal behavior shim', () => {
  afterEach(() => {
    delete window.Drupal;
    delete window.drupalSettings;
  });

  it('initializes Drupal behaviors and attaches existing behavior callbacks', async () => {
    await import('./_drupal.js');

    const context = document.createElement('section');
    const attach = jest.fn();
    window.Drupal.behaviors.example = { attach };

    window.Drupal.attachBehaviors(context);

    expect(window.drupalSettings).toEqual({});
    expect(attach).toHaveBeenCalledWith(context, window.drupalSettings);
  });
});
