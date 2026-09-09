# Maintainer Decision Register

Reviewed September 9, 2026 against PR #314 source
[`3750022`](https://github.com/emulsify-ds/emulsify-core/commit/3750022a47a8f862015ffbce4a7215ebe92f7365).
This register holds unresolved decisions, not consumer support commitments.
The [consumer policy](version-evolution.md#compatibility-and-support-policy)
records current contracts and the existing 4.x compatibility rule, which this
review preserves.

The [release PR](https://github.com/emulsify-ds/emulsify-core/pull/314) had an
unfilled description and no review or discussion recording decisions for these
items at this check. The reviewed repository guidance and release records do
not establish owners for them. No owner is assigned here. When a maintainer
decides an item, record the decision, its approval link, scope, and any verified
owner or review date; then update the consumer guide if it creates a commitment.

"Follow-up candidate" below is a proposed disposition, not an approved deferral.
It means unchanged 4.5.0 behavior does not depend on solving that roadmap
question. Immediate release dispositions still need the
[maintainer release review](release-review.md#before-merge). This register adds
no automated gate and does not authorize publication.

## Maintenance Commitments And Backports

- **Question:** Which fixes, if any, are committed for the latest 4.x minor,
  earlier 4.x minors, 3.x, and 1.x/2.x? Are any maintenance periods promised?
- **Why it matters:** Consumers need to distinguish an upgrade path from a
  promise to receive security or correctness fixes on their current line.
- **Evidence:** The [version history and compatibility rule](version-evolution.md)
  preserve the published Node requirements and output contracts. The previous
  [policy change](https://github.com/emulsify-ds/emulsify-core/commit/71426a81acf26986a30d502a2d52cd4bf550e32b)
  deliberately left all four maintenance rows unresolved. Neither runtime
  compatibility nor passing CI establishes staffing or a support period.
- **Options:** Maintain only the latest minor; define selected older lines for
  security-only or correctness backports; or retain case-by-case decisions
  without a fixed window. Backports must respect each target line's existing
  requirements; directing a consumer to upgrade can entail the documented
  4.3.0 Node floor change. No option or date is selected.
- **Status:** Unresolved. **Release treatment:** Follow-up candidate; the 4.5.0
  compatibility contract does not depend on a maintenance calendar.
- **Next action:** Record the covered lines and fix classes, and approve any
  resource commitment before publishing a supported-lines table.

<!-- MAINTAINER DECISION REQUIRED: Define which fixes the latest 4.x minor receives and its maintenance commitment. -->
<!-- MAINTAINER DECISION REQUIRED: Identify which earlier 4.x minors receive backports and whether those cover security, correctness, or other fixes. -->
<!-- MAINTAINER DECISION REQUIRED: Decide whether 3.x receives fixes, which kinds, and any maintenance commitment. -->
<!-- MAINTAINER DECISION REQUIRED: Decide whether 1.x or 2.x receives fixes, which kinds, and any maintenance commitment. -->

## Security Reporting For Older Lines

- **Question:** What confidential channel accepts Core vulnerability reports,
  including 3.x and older lines, and how is report intake separated from fix
  eligibility?
- **Why it matters:** A reporter needs a safe destination even when backport
  coverage is undecided. A general issue link or package-author address is
  not evidence of a designated security contact.
- **Evidence:** On September 9, neither the
  [Core tree](https://github.com/emulsify-ds/emulsify-core/tree/3750022a47a8f862015ffbce4a7215ebe92f7365)
  nor the [organization fallback tree](https://github.com/emulsify-ds/.github/tree/89866b0dbe4258d879469128af75997b0f56c7c3)
  contained `SECURITY.md`. GitHub's
  [private-reporting endpoint](https://api.github.com/repos/emulsify-ds/emulsify-core/private-vulnerability-reporting)
  returned `{"enabled":false}`. The inherited
  [contribution guide](https://github.com/emulsify-ds/.github/blob/89866b0dbe4258d879469128af75997b0f56c7c3/CONTRIBUTING.md)
  gives general contribution routes, not a vulnerability process. The
  [conduct contact](../CODE_OF_CONDUCT.md) and package-author address do not
  designate security intake. No confidential Core reporting channel was
  verified; this does not rule out private or off-platform arrangements. The
  [security assessment](security-4.5.0.md) is a dependency-exposure record,
  not a disclosure or response-time policy.
- **Options:** Enable and document a monitored private GitHub reporting route;
  designate a private contact or existing organization process; and state
  separately whether older-line reports are accepted for triage, backported,
  or addressed through an upgrade. Each option needs verified access and
  monitoring; none implies a response deadline or fix entitlement.
- **Status:** Unresolved. **Release treatment:** The intake gap needs an explicit
  release-review disposition. Older-line fix eligibility can be a separate
  follow-up; it is not a technical failure of the unchanged package.
- **Next action:** Confirm and test a confidential reporting route, publish it
  in repository security guidance, and state older-line triage scope. Do not
  send vulnerability details to a public issue tracker while this is unresolved.

<!-- MAINTAINER DECISION REQUIRED: Name the destination and reporting process for 3.x security reports. -->

## Residual Browser-Chain Acceptance

- **Question:** Is the residual Pa11y browser-installation exposure acceptable
  for this release, in which environments and with which controls, accountable
  owner, and review date?
- **Why it matters:** Successful scans do not accept the risks of installing
  affected browser archives on developer or CI machines.
- **Evidence:** The September 9 [assessment](security-4.5.0.md) records
  `GHSA-jmr9-qjv8-65gv` and `GHSA-7pqw-9j4j-h8q3` through
  `pa11y → puppeteer / puppeteer-core → @puppeteer/browsers → extract-zip`.
  Clean Core and packed-consumer audits remain nonzero. There is no compatible
  Pa11y 9 patch in that assessment. The optional managed-browser configuration
  avoids download/extraction in the tested setup; it neither removes the
  affected packages nor certifies browser provisioning or patch maintenance.
- **Options:** Accept a bounded exposure with verified operational controls;
  use the tested optional managed-browser path where suitable; or defer release
  while evaluating remediation. Pa11y 10 requires separate compatibility work;
  forcing a major override is not a compatible patch. Consumer lockfiles need
  independent refresh and validation for compatible fixes.
- **Status:** No explicit acceptance, owner, or next review date recorded for
  either advisory. **Release treatment:** Immediate release decision pending;
  the technical mitigation alone cannot settle it.
- **Next action:** Record acceptance or refusal for both advisories and covered
  environments. Any acceptance needs its accountable owner, required controls,
  and expiry or review date. Proposed review triggers are an upstream patch,
  Pa11y/Puppeteer change, CI image or browser-provisioning change, new download
  source/cache, or new exploit evidence. These triggers await agreement.

<!-- MAINTAINER DECISION REQUIRED: Assign an accountable owner for the residual Pa11y/Puppeteer/extract-zip chain and decide whether its current exposure is temporarily acceptable. -->
<!-- MAINTAINER DECISION REQUIRED: Set the next review date for the residual browser extraction chain and identify the supported CI images and download/caching practices to review. -->

## Supported Emulsify Tools Counterparts

- **Question:** Which released Emulsify Tools versions, if any, form an
  officially supported pairing with Core 4.x, and for which template features?
- **Why it matters:** A reproducible PHP comparison does not establish a
  supported release matrix or full shared-template portability.
- **Evidence:** The [14-case helper corpus](twig-php-parity.md) pins Tools
  revision `26a5b7cf7abd5f6d05843c70af17f09a354a8e81`, PHP 8.5.10, Drupal
  11.4.6, and Twig PHP 3.28.0. It records exact outputs and known divergences,
  not compatibility across Tools releases or every helper/tag. PHP execution
  remains an optional maintainer check.
- **Options:** Validate a named Tools release and limited feature set; build a
  tested version matrix; or continue documenting only the pinned comparison.
  A broader pairing needs additional evidence and may require coordinated
  changes; selecting a version cannot silently change Core output or impose a
  PHP requirement on npm consumers.
- **Status:** Unresolved. **Release treatment:** Follow-up candidate; 4.5.0 can
  document the pinned evidence without promising a pairing.
- **Next action:** Select candidate released versions and scope, run the
  corresponding compatibility checks, and obtain approval before advertising
  a supported pairing.

<!-- MAINTAINER DECISION REQUIRED: Name the supported Emulsify Tools version counterpart to Core 4.x; the pinned evidence revision is not a support commitment. -->

## Future BEM And Attribute-Helper Behavior

- **Question:** Which future behavior should Core and Tools share for object
  BEM argument order, utility-class punctuation, false attribute overrides,
  list merging, and repeated context consumption?
- **Why it matters:** Changes can alter CSS selectors, disabled state, ARIA
  references, escaping, and serialized HTML in existing themes.
- **Evidence:** The [parity differences and portable subset](twig-php-parity.md)
  and [exact Core tests](../src/extensions/twig/__tests__/php-parity.test.js)
  preserve current observations. Neither runtime is declared canonical by the
  corpus. The [4.x rule](version-evolution.md#compatibility-within-4x) protects
  current generated classes and serialization.
- **Options:** Retain documented differences; add a separately designed opt-in
  mode with unchanged defaults; or coordinate a major migration to agreed
  behavior. Choosing Core, Tools, or a new common rule has different consumer
  migration costs. Do not normalize recorded expectations to hide a change.
- **Status:** Unresolved. **Release treatment:** Follow-up candidate; no
  harmonization is required for 4.5.0's unchanged helper outputs.
- **Next action:** Decide each divergence with both implementations' maintainers,
  then document before/after output and migration implications before coding
  a behavior change.

<!-- MAINTAINER DECISION REQUIRED: Choose which runtime defines canonical future behavior for object BEM, utility-class punctuation, false attribute overrides, list merging, and context consumption; coordinate compatibility and migration requirements before changing outputs. -->

## Package Metadata And License File

- **Question:** How should the existing inconsistency between package license
  metadata and the repository license text be resolved with proper authority?
- **Why it matters:** Consumers may be unable to complete a license review when
  the distributed materials disagree.
- **Evidence:** [`package.json`](../package.json) declares `GPL-2.0` while
  [`LICENSE`](../LICENSE) contains the GNU GPL version 3 text. The
  [September 8 verification record](releases/4.5.0-verification.md#unresolved-maintainer-decisions)
  already recorded this inconsistency. `LICENSE` is unchanged from the
  [initial commit](https://github.com/emulsify-ds/emulsify-core/commit/29b0e8887b7cfad73477882079ee19039c63aa3a);
  package metadata [changed from ISC to GPL-2.0](https://github.com/emulsify-ds/emulsify-core/commit/c0f3af594fc2a92ba80b6f0162512928dc3b6972)
  without a corresponding license-file edit. These are observed records, not
  a conclusion about which terms legally govern.
- **Options:** After reviewing project history and the relevant authority,
  correct metadata to the authorized terms, correct the distributed text to
  the authorized terms, or pursue any separately authorized licensing change.
  No option is selected. Licensing cannot be settled by a dependency audit,
  GitHub's detected label, or runtime compatibility tests.
- **Status:** Unresolved. **Release treatment:** Maintainer disposition pending;
  this may block a consumer's license review, but this register does not invent
  a repository-wide release prohibition or a legal conclusion.
- **Next action:** Obtain an authorized determination and record its source
  before changing license metadata or text. Identify whether the unresolved
  inconsistency blocks publication as part of release review.
