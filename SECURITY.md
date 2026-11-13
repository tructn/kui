# Security policy

## Supported versions

Only the [latest release](https://github.com/tructn/kui/releases/latest) gets security fixes, and the
in-app updater delivers them.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through
[GitHub's vulnerability reporting](https://github.com/tructn/kui/security/advisories/new) instead.

Include what an attacker could do, the steps to reproduce, and the KUI version and operating system. You'll get a reply
within a week. Once a fix is released, the advisory is published and you're credited, unless you'd rather not be.

Examples of what counts: leaking saved cluster credentials, an update that isn't verified against the updater
key, or a message payload that runs code in the app.

## Cluster settings

- Passwords, OAuth client secrets and key passwords, including secret keys typed into Advanced properties (such as
  `sasl.password` or `ssl.key.pem`), are stored in the system keychain. Only when no keychain is available do they stay
  in `clusters.json`, readable by the owner only. A misspelled secret key (say `sasl.passwrd`) is not recognised and is
  stored as a plain setting; connecting fails on it and the error names the key but never its value.
- Advanced properties cannot load code or run commands. KUI refuses `plugin.*`, `interceptors`, `ssl.engine.*`,
  `sasl.kerberos.*`, anything ending in `.cmd`, and the settings KUI controls itself (`bootstrap.servers`,
  `security.protocol`, `group.id`, `enable.auto.commit`), both when saving and when connecting.
