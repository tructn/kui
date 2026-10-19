# Changelog

All notable changes to KUI are documented here. Versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file is written by [release-please](https://github.com/googleapis/release-please) from the
Conventional Commit titles on `main`; see "Releasing" in CONTRIBUTING.md rather than editing it by hand.

## [0.1.0-alpha.3](https://github.com/tructn/kui/compare/v0.1.0-alpha.2...v0.1.0-alpha.3) (2026-10-19)


### Added

* **messages:** show payloads as JSON or Base64 only ([58293f8](https://github.com/tructn/kui/commit/58293f87e7479a3dc26e243524e641507cd184dc))


### Fixed

* **kafka:** explain connection failures instead of raw librdkafka errors ([#8](https://github.com/tructn/kui/issues/8)) ([dc8b92b](https://github.com/tructn/kui/commit/dc8b92b3ccd998e1c3582d8d84bf228d1596077c))
* **kafka:** retry metadata while the cluster connection comes up ([#6](https://github.com/tructn/kui/issues/6)) ([58293f8](https://github.com/tructn/kui/commit/58293f87e7479a3dc26e243524e641507cd184dc))
* **topics:** debounce the topic and consumer group filters ([58293f8](https://github.com/tructn/kui/commit/58293f87e7479a3dc26e243524e641507cd184dc))


### Performance

* **settings:** save settings off the main thread ([58293f8](https://github.com/tructn/kui/commit/58293f87e7479a3dc26e243524e641507cd184dc))

## [0.1.0-alpha.2](https://github.com/tructn/kui/compare/v0.1.0-alpha.1...v0.1.0-alpha.2) (2026-10-18)


### Fixed

* **settings:** simplify remember sorting and filters description ([#4](https://github.com/tructn/kui/issues/4)) ([acb76ab](https://github.com/tructn/kui/commit/acb76ab074ff6dece4b09923654b2dbd2fbaf027))

## [0.1.0-alpha.1](https://github.com/tructn/kui/releases/tag/v0.1.0-alpha.1) (2026-10-17)

First public release.
