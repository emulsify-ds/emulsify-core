# Emulsify Core Documentation

These docs expand on the short project README and are organized by the task a project maintainer is usually trying to complete.

| Topic                                                | Use This When                                                                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [Version Evolution](version-evolution.md)            | Understanding how Emulsify Core has evolved across major releases.                                                    |
| [Component Authoring](component-authoring.md)        | Choosing Twig, React, or mixed Storybook authoring and comparing component examples.                                  |
| [Storybook](storybook.md)                            | Rendering Twig stories, using `renderTwig()`, understanding Twig runtime helpers, and mixing Twig with React stories. |
| [Project Structure And Output](project-structure.md) | Configuring `src/components`, root `./components`, `variant.structureImplementations`, and expected output paths.     |
| [Platform Adapters](platform-adapters.md)            | Understanding `generic`, `drupal`, platform resolution order, and Drupal SDC behavior.                                |
| [Extension Points](extension-points.md)              | Adding Vite plugins, Tailwind CSS, Storybook preview overrides, and other framework tooling.                          |
| [Native Twig Extensions](native-twig-extensions.md)  | Using `bem()`, `add_attributes()`, and `switch/case/default/endswitch` in Twig.js.                                    |
| [Migration](migration-4x.md)                         | Upgrading from earlier versions while preserving existing structures.                                                 |
