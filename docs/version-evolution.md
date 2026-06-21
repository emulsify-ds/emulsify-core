# Version Evolution

Emulsify Core has always focused on one job: package the build, Storybook, linting, and component-library conventions that Emulsify projects need, while still giving individual projects room to extend those conventions.

The current release keeps that goal and moves the implementation forward. It replaces the older Webpack-centered stack with Vite, uses React/Vite Storybook, supports Twig and React stories in the same library, and uses `project.emulsify.json` as the source of truth for platform and structure decisions.

## 1.x: Shared Tooling Foundation

The first major version established Emulsify Core as a reusable package instead of a set of copied project files. It bundled Storybook, Webpack, linting, a11y checks, Sass processing, Twig-related build support, asset handling, and project override hooks.

That release made it practical for themes and standalone projects to consume shared Emulsify tooling from npm while still keeping project-specific configuration in the consuming project.

## 2.x: Project Structure And Drupal SDC Support

The second major version expanded how Emulsify Core handled project structure. It added better support for older component layouts, multi-level component directories, global and foundational asset processing, Storybook static directories, and Drupal-oriented SDC workflows.

This version also continued dependency and Storybook upgrades while making more behavior configurable through project-level files. The important compatibility lesson from this era remains true: projects should not have to move working component directories just to keep using Emulsify Core.

## 3.x: Runtime Modernization

The third major version moved the package into a more modern JavaScript runtime model. It adopted ESM, raised the runtime floor to Node 24, kept dependencies current, refined PostCSS and Sass handling, improved component asset copying, and continued to preserve existing Drupal SDC behavior.

It also set up the architectural runway for the current build model by cleaning up module scope, Storybook behavior, asset resolution, and package compatibility work.

## Current Release: Vite, React/Vite Storybook, And Platform Adapters

The current release is the next evolution of Emulsify Core. Vite replaces Webpack as the build engine. Storybook runs on the React/Vite framework. Twig templates render through Emulsify's Storybook helper, and React components render through normal Storybook React patterns.

The project model is also more explicit. `project.emulsify.json` drives platform and structure configuration. The normalized structure model supports `src/components`, root `./components`, and custom `variant.structureImplementations`. Platform adapters own platform-specific behavior such as Drupal behavior attachment, Drupal Twig filters, and Drupal SDC output mirroring.

That combination keeps existing Drupal and Twig-heavy projects viable while making Emulsify Core a better fit for standalone Twig libraries, standalone React libraries, and mixed design systems. It is not a break from the project history; it is the same shared-tooling idea updated for the way modern component libraries are built.
