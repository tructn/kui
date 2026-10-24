# Changelog

All notable changes to KUI are documented here. Versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file is written by [release-please](https://github.com/googleapis/release-please) from the
Conventional Commit titles on `main`; see "Releasing" in CONTRIBUTING.md rather than editing it by hand.

## [0.1.0-alpha.15](https://github.com/tructn/kui/compare/v0.1.0-alpha.14...v0.1.0-alpha.15) (2026-10-24)


### Added

* **clusters:** keep passwords in the system keychain ([eb69e54](https://github.com/tructn/kui/commit/eb69e5463c2a862d462a19e0d9096bf5caffc0ed))

## [0.1.0-alpha.14](https://github.com/tructn/kui/compare/v0.1.0-alpha.13...v0.1.0-alpha.14) (2026-10-24)


### Added

* **clusters:** add TLS certificates and OAuth sign-in ([316b776](https://github.com/tructn/kui/commit/316b7769a1f0ebca8e102e9388a8d332fc2165fb))


### Fixed

* **consumer-groups:** show groups on the KIP-848 consumer protocol ([f12bab2](https://github.com/tructn/kui/commit/f12bab267087f660c4171b504b3b360b24cca0e2))

## [0.1.0-alpha.13](https://github.com/tructn/kui/compare/v0.1.0-alpha.12...v0.1.0-alpha.13) (2026-10-23)


### Fixed

* **e2e:** make the end-to-end suite pass again ([245c573](https://github.com/tructn/kui/commit/245c57322a7cb0e277b5c6f671d19a4187c79dc5))
* **settings:** apply the editor font size outside the preview ([d7d00f5](https://github.com/tructn/kui/commit/d7d00f50c564d8d1fe383de864a2006d671e804c))

## [0.1.0-alpha.12](https://github.com/tructn/kui/compare/v0.1.0-alpha.11...v0.1.0-alpha.12) (2026-10-22)


### Added

* **settings:** add more code fonts and an accent color picker ([16c417b](https://github.com/tructn/kui/commit/16c417be17298ac3415092f449071baaf1621993))

## [0.1.0-alpha.11](https://github.com/tructn/kui/compare/v0.1.0-alpha.10...v0.1.0-alpha.11) (2026-10-22)


### Added

* **messages:** default to 25 rows per page ([3432c9b](https://github.com/tructn/kui/commit/3432c9b6ef0c6629cfe68d15a1cb61c0cb69e64d))
* **ui:** add subtle motion to pages, tables and the sidebar ([cc7fe7c](https://github.com/tructn/kui/commit/cc7fe7c4533de82aca0aec0ca4223809f44f42ec))
* **ui:** move Settings into a General sidebar group ([de84ffa](https://github.com/tructn/kui/commit/de84ffa42e626497973cd2cbf7d5385fb84980a9))


### Fixed

* **e2e:** skip install scripts in the e2e image ([d565d3d](https://github.com/tructn/kui/commit/d565d3d16c33430827005ecd73e874a4ce286583))


### Performance

* **messages:** speed up expanding all rows ([f72f602](https://github.com/tructn/kui/commit/f72f602b716120f92a0a430cb850466a12705e90))

## [0.1.0-alpha.10](https://github.com/tructn/kui/compare/v0.1.0-alpha.9...v0.1.0-alpha.10) (2026-10-22)


### Fixed

* **deps:** bump webpki crates for RustSec advisories ([#29](https://github.com/tructn/kui/issues/29)) ([b1edc38](https://github.com/tructn/kui/commit/b1edc38516defce0235fa8b20a2678269d309483))

## [0.1.0-alpha.9](https://github.com/tructn/kui/compare/v0.1.0-alpha.8...v0.1.0-alpha.9) (2026-10-22)


### Added

* export messages and reset consumer group offsets ([#27](https://github.com/tructn/kui/issues/27)) ([9e5f3f1](https://github.com/tructn/kui/commit/9e5f3f1b5eee9e373672bbee852df29ad2bd19fd))
* **messages:** expand message rows to preview key, headers and value ([#25](https://github.com/tructn/kui/issues/25)) ([fe314da](https://github.com/tructn/kui/commit/fe314da12713e8f6c9ef037d08a835e287e19773))

## [0.1.0-alpha.8](https://github.com/tructn/kui/compare/v0.1.0-alpha.7...v0.1.0-alpha.8) (2026-10-20)


### Fixed

* show screens while their data loads or fails ([#22](https://github.com/tructn/kui/issues/22)) ([d1b09ba](https://github.com/tructn/kui/commit/d1b09ba5d6fc2ba464b7d71b96c4fb8c2e01e57b))

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
