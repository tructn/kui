# Changelog

All notable changes to KUI are documented here. Versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file is written by [release-please](https://github.com/googleapis/release-please) from the
Conventional Commit titles on `main`; see "Releasing" in CONTRIBUTING.md rather than editing it by hand.

## [0.2.0](https://github.com/tructn/kui/compare/v0.1.1...v0.2.0) (2026-11-14)


### Added

* **release:** ship installers for Intel Macs ([72837fc](https://github.com/tructn/kui/commit/72837fc903aa11186ed5066eb00e0b12389d9c14))

## [0.1.1](https://github.com/tructn/kui/compare/v0.1.0...v0.1.1) (2026-11-14)


### Fixed

* **clusters:** keep secret values out of test assertion messages ([ff6fe50](https://github.com/tructn/kui/commit/ff6fe5043aa6ab59b6bd4e21d0c3442c49bd1741))

## [0.1.0](https://github.com/tructn/kui/compare/v0.1.0-alpha.20...v0.1.0) (2026-11-13)


### chore

* graduate from alpha to stable releases ([3b8b96c](https://github.com/tructn/kui/commit/3b8b96c3368acaba5e9f20a6a2278e1589b03feb))


### Added

* **desktop:** navy and amber app icon, amber default accent ([2c8dec1](https://github.com/tructn/kui/commit/2c8dec163faaf7e9daf7a92443177a94171541af))
* **desktop:** violet and cyan Pipeline K icon, violet accent ([f93399d](https://github.com/tructn/kui/commit/f93399dfdd411f0bda3b78402687fac3fe2170e4))

## [0.1.0-alpha.20](https://github.com/tructn/kui/compare/v0.1.0-alpha.19...v0.1.0-alpha.20) (2026-11-10)


### Fixed

* **clusters:** filter advanced properties, keep secrets out of file ([708177f](https://github.com/tructn/kui/commit/708177f89234beee1b4f78fec945e50c49f495f7))
* **desktop:** stop panicking on a poisoned lock ([dd40676](https://github.com/tructn/kui/commit/dd40676f109f8a403ec8aa4d18c12683d779f60d))
* **generator:** reject template arguments that overflow ([71eb9ce](https://github.com/tructn/kui/commit/71eb9ce2e453db302344c5b766fa01241b8244eb))
* **messages:** survive hostile records, bound memory per page ([1a9ab63](https://github.com/tructn/kui/commit/1a9ab63e664b8ab41739fb4bfd1348afb2e7903f))
* **tql:** bound query nesting and evaluation cost ([7f186f1](https://github.com/tructn/kui/commit/7f186f1a4afe7512937e78ac48a9204cc89a38fc))

## [0.1.0-alpha.19](https://github.com/tructn/kui/compare/v0.1.0-alpha.18...v0.1.0-alpha.19) (2026-11-09)


### Added

* **messages:** JSON tree view for message values ([829b93e](https://github.com/tructn/kui/commit/829b93e8e13b12f80fed3b6b1ea294ca9f0ef949))
* **seed:** add nested catalog and multi-encoded webhook demo topics ([5d13b36](https://github.com/tructn/kui/commit/5d13b3637675fb1fb368b271f28b8ff74acfc91d))

## [0.1.0-alpha.18](https://github.com/tructn/kui/compare/v0.1.0-alpha.17...v0.1.0-alpha.18) (2026-11-02)


### Added

* **appearance:** pick any accent color ([6c6e91e](https://github.com/tructn/kui/commit/6c6e91ec52ec814e965a308ba46edf85be7a5ec9))

## [0.1.0-alpha.17](https://github.com/tructn/kui/compare/v0.1.0-alpha.16...v0.1.0-alpha.17) (2026-11-02)


### Added

* **messages:** query into JSON written as a string ([6c24165](https://github.com/tructn/kui/commit/6c24165dbaae0d161b3a2a33352be301e709c2e1))

## [0.1.0-alpha.16](https://github.com/tructn/kui/compare/v0.1.0-alpha.15...v0.1.0-alpha.16) (2026-11-01)


### Added

* **messages:** accept query suggestions with Tab ([8b6bebd](https://github.com/tructn/kui/commit/8b6bebda47d418336cba288e4e8be8ce60146629))
* **messages:** expandable multi-line filter editor ([e5846fe](https://github.com/tructn/kui/commit/e5846fed66b8a0443dd0d425e7f1379c77288c52))
* **messages:** filter messages with SQL-like queries ([020ef12](https://github.com/tructn/kui/commit/020ef12385ef84237d0efdf2dd2bd5a4699c9331))
* **messages:** open query suggestions only when typing or asked ([eecd526](https://github.com/tructn/kui/commit/eecd526abc2e5fb5f6bd4679beb0845f90ca19fc))


### Fixed

* **deps:** resolve security audit failures ([e3d49ab](https://github.com/tructn/kui/commit/e3d49abac45cfe677a6bb73a89f57532cec84ec9))

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
