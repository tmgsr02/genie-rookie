# Source provenance

Standalone extraction prepared on 24 October 2026 from the working Genie & Rookie adaptation of [pipecat-ai/ios-little-voices](https://github.com/pipecat-ai/ios-little-voices).

The adaptation's documented upstream baseline is `7f5613cd9071d4668d3aab9cfe8691ff8c59b4b2`. The parent checkout was at `10a004878dfea0ec07a50aeb9f026ad41f58a978` when submission preparation began and had additional working-tree changes. This standalone repository starts with a fresh history; the parent SHA is not a claim that every exported file is identical to that commit.

Included: Genie & Rookie native and embedded Python sources, its prepared scene and tests, tutoring/backend sources, vendored scene tooling with existing notices, and required build helpers. The established `apps/GeniusRookie` paths remain to minimize build-path changes.

Excluded: Tiny Alibis, the original standalone Little Voices app target, parent Git history, private submission/contact notes, environment files, logs, model downloads, build products, local account state and custom Phonon voice binaries. No deployment, account credentials or signing identity is transferred by this extraction.

Extraction changes: Genie-only build defaults and CLI choices, app-local shared resource paths, public display name, standalone package metadata, selected test configuration, a portable Cloudflare config without a pinned account ID, and standalone setup documentation. Product behavior is inherited from the exported working snapshot.

Original BSD copyright and license are retained verbatim. The app's runtime/model/voice notices and vendored component notices remain applicable. Miguel's design/development credit describes the adaptation; it does not claim authorship of the upstream foundation.
