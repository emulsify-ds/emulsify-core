/**
 * Optional additions to Pa11y's axe rules for WCAG 2.2 level A and AA.
 * The reviewed Pa11y axe-core 4.11.4 and Core root axe-core 4.13.0 each expose
 * target-size as their only wcag22a/wcag22aa rule.
 * Keep this reviewed list explicit instead of enabling future rules implicitly.
 */
export default {
  pa11y: {
    rules: ['target-size'],
  },
};
