import template from './card.twig';
import consumerAliasMarker from '@assets/module.js';

export const html = template({
  heading: 'No-platform Twig card',
  // Core's stylesheet reservation must not retroactively change Vite's
  // already configured JavaScript alias. Keeping the marker in rendered data
  // also prevents the fixture build from tree-shaking the proof away.
  content: `Compiled with no-platform behavior: ${consumerAliasMarker}`,
});
