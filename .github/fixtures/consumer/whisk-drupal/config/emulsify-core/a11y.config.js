export default {
  components: ['fixtures-consumer-whisk--twig-card'],
  discoverStories: false,
  storybookBuildDir: '.out',
  ignore: {
    codes: ['landmark-one-main', 'page-has-heading-one'],
    descriptions: ['Ensures all page content is contained by landmarks'],
  },
};
