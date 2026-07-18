export default {
  components: ['fixtures-consumer-whisk--twig-card'],
  discoverStories: false,
  storybookBuildDir: '.out',
  // Hosted Linux runners do not expose a usable Chromium sandbox.
  pa11y: {
    chromeLaunchConfig: {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      ignoreHTTPSErrors: true,
    },
  },
  ignore: {
    codes: ['landmark-one-main', 'page-has-heading-one'],
    descriptions: ['Ensures all page content is contained by landmarks'],
  },
};
