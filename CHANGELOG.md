# Changelog

All notable changes to KUI are documented here. Versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file is written by [release-please](https://github.com/googleapis/release-please) from the
Conventional Commit titles on `main`; see "Releasing" in CONTRIBUTING.md rather than editing it by hand.

## [0.1.0-alpha.7](https://github.com/tructn/kui/compare/v0.1.0-alpha.6...v0.1.0-alpha.7) (2026-10-20)


### Added

* **topics:** filter topics by regular expression ([#20](https://github.com/tructn/kui/issues/20)) ([5c52307](https://github.com/tructn/kui/commit/5c52307837fe2f939e1e76b274106bec70edf1b2))

## [0.1.0-alpha.6](https://github.com/tructn/kui/compare/v0.1.0-alpha.5...v0.1.0-alpha.6) (2026-10-20)


### Added

* **messages:** copy several messages to a topic at once ([#18](https://github.com/tructn/kui/issues/18)) ([2550c8c](https://github.com/tructn/kui/commit/2550c8cbd6346ce53dcae0eff1667ed84308c790))

## [0.1.0-alpha.5](https://github.com/tructn/kui/compare/v0.1.0-alpha.4...v0.1.0-alpha.5) (2026-10-19)


### Fixed

* **messages:** label the produce copy "Copy to topic" ([#16](https://github.com/tructn/kui/issues/16)) ([ae4e0be](https://github.com/tructn/kui/commit/ae4e0bee1fcd769b1a8f937da489dd77aeef852f))

## [0.1.0-alpha.4](https://github.com/tructn/kui/compare/v0.1.0-alpha.3...v0.1.0-alpha.4) (2026-10-19)


### Added

* **settings:** add a system theme that follows the OS appearance ([#14](https://github.com/tructn/kui/issues/14)) ([8cecd63](https://github.com/tructn/kui/commit/8cecd63d61c283dba3c2160c65709c5577eeb3d0))
* **topics:** copy the topic name from the topic page ([#13](https://github.com/tructn/kui/issues/13)) ([ec2b109](https://github.com/tructn/kui/commit/ec2b109a1c44fe52990b6c8740172bd3348bba3c))

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
