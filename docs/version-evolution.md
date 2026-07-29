# Version Evolution

Emulsify Core has always focused on one job: package the build, Storybook, linting, and component-library conventions that Emulsify projects need, while still giving individual projects room to extend those conventions.

The implementation has moved from Webpack-centered tooling to Vite and
React/Vite Storybook while preserving that goal. Individual release notes,
including [4.3.0](releases/4.3.0.md), document minor-release scope and
compatibility changes.

## 1.x: Shared Tooling Foundation

The first major version established Emulsify Core as a reusable package instead of a set of copied project files. It bundled Storybook, Webpack, linting, a11y checks, Sass processing, Twig-related build support, asset handling, and project override hooks.

That release made it practical for themes and standalone projects to consume shared Emulsify tooling from npm while still keeping project-specific configuration in the consuming project.

## 2.x: Project Structure And Drupal SDC Support

The second major version expanded how Emulsify Core handled project structure. It added better support for older component layouts, multi-level component directories, global and foundational asset processing, Storybook static directories, and Drupal-oriented SDC workflows.

This version also continued dependency and Storybook upgrades while making more behavior configurable through project-level files. The important compatibility lesson from this era remains true: projects should not have to move working component directories just to keep using Emulsify Core.

## 3.x: Runtime Modernization

The third major version moved the package into a more modern JavaScript runtime
model. It adopted ESM, and its published `engines.node` contract required
Node.js 24 or later without a patch-specific floor. It also kept dependencies
current, refined PostCSS and Sass handling, improved component asset copying,
and continued to preserve existing Drupal SDC behavior.

It also set up the architectural runway for the current build model by cleaning up module scope, Storybook behavior, asset resolution, and package compatibility work.

## 4.x: Vite, React/Vite Storybook, And Platform Adapters

The fourth major version replaced Webpack with Vite as the build engine and
moved Storybook to the React/Vite framework. Twig templates render through
Emulsify's Storybook helper, React components use normal Storybook React
patterns, and a focused adapter renders autonomous custom elements with
documented property, attribute, default-slot, and native event boundaries.

Core 4.0 through 4.2 retained the public Node.js 24-or-later contract without a
patch-specific floor. Core 4.3.0 raised the consumer floor to Node.js 24.13.0
because of its published dependency set. This minor-release change is documented
in the [4.3.0 release notes](releases/4.3.0.md); it does not alter the
historical 3.x or earlier 4.x contracts.

The project model is also more explicit. `project.emulsify.json` drives platform and structure configuration. The normalized structure model supports `src/components`, root `./components`, and custom `variant.structureImplementations`. Platform adapters own platform-specific behavior such as Drupal behavior attachment, Drupal Twig filters, and Drupal SDC output mirroring. WordPress projects have an explicit neutral adapter that keeps Core focused on Twig authoring, Storybook, Vite, and `dist/` output while leaving WordPress runtime integration to `emulsify-wordpress-theme`.

That combination keeps existing Drupal and Twig-heavy projects viable while
making Emulsify Core a better fit for standalone Twig libraries, standalone
React libraries, custom element stories, and mixed design systems. It is not a
break from the project history; it is the same shared-tooling idea updated for
the way modern component libraries are built.
