module.exports = {
  storybookBuildDir: '../../../.out',
  pa11y: {
    includeNotices: false,
    includeWarnings: false,
    runners: ['axe'],
  },
  // A11y linting is done on a component-by-component
  // basis, which results in the linter reporting some errors that
  // should be ignored. These codes and descriptions allow for those
  // errors to be targeted specifically.
  ignore: {
    codes: ['landmark-one-main', 'page-has-heading-one'],
    descriptions: ['Ensures all page content is contained by landmarks'],
  },
  // List of storybook component IDs defined and used in this project.
  components: [
    'base-colors--palettes',
    'base-motion--usage',
    'atoms-button--twig',
    'atoms-button--twig-alt',
    'atoms-forms--checkboxes',
    'atoms-forms--radio-buttons',
    'atoms-forms--select-dropdowns',
    'atoms-forms--textfields-examples',
    'atoms-images--images',
    'atoms-images--figures',
    'atoms-images--icons',
    'atoms-links--links',
    'atoms-lists--definition-list',
    'atoms-lists--unordered-list',
    'atoms-lists--ordered-list',
    'atoms-tables--table',
    'atoms-text--headings-examples',
    'atoms-text--blockquote-example',
    'atoms-text--preformatted',
    'atoms-text--random',
    'atoms-videos--wide',
    'atoms-videos--full',
    'molecules-cards--card-example',
    'molecules-cards--card-with-background',
    'molecules-cta--cta-example',
    'molecules-menus--breadcrumbs',
    'molecules-menus--inline',
    'molecules-menus--main',
    'molecules-menus--social',
    'molecules-menus-pager--pager-example',
    'molecules-status--status-examples',
    'molecules-tabs--js-tabs',
    'organisms-grids--default-grid',
    'organisms-grids--card-grid',
    'organisms-grids--cta-grid',
    'organisms-site--footer',
    'organisms-site--header',
    'templates-layouts--full-width',
    'templates-layouts--with-sidebar',
    'templates-place-holder--place-holder',
    'pages-content-types--article',
    'pages-landing-pages--home',
  ],
};
