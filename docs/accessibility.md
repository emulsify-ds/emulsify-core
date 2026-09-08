# Optional WCAG 2.2 Accessibility Checks

Core 4.5 provides an optional preset for the Pa11y axe runner. Add this to an
existing theme's `config/emulsify-core/a11y.config.js` to opt in:

```js
import wcag22 from '@emulsify/core/a11y/wcag22';

export default wcag22;
```

Run the theme's existing `npm run a11y` command. No theme regeneration,
runtime change, or configuration migration is required. Consumers that do
not import the preset retain their existing rule selection.

The preset supplies `pa11y.rules: ['target-size']`. Core merges those Pa11y
options with its shared defaults, preserving the existing actions, axe
runner, report filters, and story discovery configuration. If a project
already exports accessibility settings, retain them and add the preset's
rules to its `pa11y` object:

```js
import wcag22 from '@emulsify/core/a11y/wcag22';

export default {
  concurrency: 2,
  pa11y: {
    ...wcag22.pa11y,
    // Keep the project's other Pa11y options here.
  },
};
```

Existing override behavior is unchanged: `pa11y.rules` arrays replace rather
than concatenate. If a project already sets that array, include its existing
rule IDs alongside `...wcag22.pa11y.rules`. Projects that override
`pa11y.runners` must retain `axe` to use this preset.

## Scope and Limitations

Pa11y 9's [axe runner](https://github.com/pa11y/pa11y/blob/9.1.1/lib/runners/axe.js)
selects WCAG 2.0 and 2.1 tags by default. It enables additional rule IDs through
its `rules` option. The preset adds the rules supported under axe's `wcag22a`
and `wcag22aa` tags. In the reviewed locked tree, Pa11y resolves axe-core
4.11.4 separately from Core's root axe-core 4.13.0. Both versions expose only
`target-size` for those tags; the [Core root version's supported list](https://github.com/dequelabs/axe-core/blob/v4.13.0/doc/rule-descriptions.md#wcag-22-level-a--aa-rules)
records that scope. Tests check both resolved runtimes. The list is explicit
so a dependency update cannot silently add new rules to the preset.

This closes a rule-selection gap: Storybook already requests `wcag22aa`,
while the default Pa11y axe selection omits it. The synthetic failing fixture
demonstrates that testing gap; it does not identify a defect in a shipped Core
component.

The rule checks aspects of [WCAG 2.2 SC 2.5.8, Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
The criterion generally calls for targets at least 24 by 24 CSS pixels, with
exceptions for sufficient spacing, equivalent controls, inline text targets,
unmodified user-agent controls, and essential presentation. Evaluate the
criterion and its exceptions in the actual interface before deciding on a fix.

Automated rules do not establish complete WCAG conformance. Manual testing,
including keyboard access, focus behavior, and assistive technology, remains
necessary.

## Packed Consumer Verification

```sh
npm run fixtures:consumer -- --fixture whisk-drupal
```

The fixture installs Core's tarball and imports the public preset through
`@emulsify/core/a11y/wcag22`. It runs the installed accessibility command
against two synthetic adjacent buttons: 10 by 10 CSS pixel targets pass under
the unchanged default selection, fail with `target-size` after opting in, and
pass after both targets are enlarged to 24 by 24 CSS pixels. It repeats the
default scan after opting in to guard against shared-default mutation. The
existing Storybook axe and shadow-root checks remain in place.
