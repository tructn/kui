<p align="center">
  <img src="public/logo.svg" alt="KUI logo" width="112" height="112" />
</p>

<h1 align="center">KUI</h1>

<p align="center">
  <strong>Kafka, without the terminal.</strong><br />
  A fast, free desktop app to browse topics, read and send messages, keep an eye on your consumers,<br />
  and run your own code on every message.
</p>

<p align="center">
  <a href="https://github.com/tructn/kui/actions/workflows/release.yml"><img src="https://github.com/tructn/kui/actions/workflows/release.yml/badge.svg" alt="Release" /></a>
  <a href="https://github.com/tructn/kui/actions/workflows/ci.yml"><img src="https://github.com/tructn/kui/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://github.com/tructn/kui/actions/workflows/security.yml"><img src="https://github.com/tructn/kui/actions/workflows/security.yml/badge.svg" alt="Security" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
</p>

<p align="center">
  <a href="https://github.com/tructn/kui/releases/latest"><strong>⬇&nbsp; Download for macOS &amp; Windows</strong></a>
  &nbsp;·&nbsp;
  <a href="#features">Features</a>
  &nbsp;·&nbsp;
  <a href="#install">Install</a>
</p>

<p align="center">
  <img src="docs/screenshots/02_messages.png" alt="KUI browsing the messages of a Kafka topic" width="820" />
</p>

## Why KUI

Most Kafka tools are either command-line scripts or web dashboards you have to deploy and keep running.
KUI is neither. It's a desktop app: download it, add your cluster, and you're looking at your data.

- **Nothing to set up.** No server, no Docker, no config files. Install it like any other app.
- **Small and fast.** Built with [Tauri](https://tauri.app) and Rust, so it starts quickly and uses little memory.
- **Private by design.** Your clusters and passwords stay on your computer, with passwords in the system keychain. KUI doesn't collect anything.
- **Free and open source.** MIT licensed, with no account and no paid tier.

## Features

### Connect to any cluster

<img src="docs/screenshots/00_cluster.png" alt="The Add cluster dialog" width="820" />

Add a cluster, test the connection and save it. TLS, mutual TLS and SASL (PLAIN, SCRAM, OAuth) are supported.

### Find any topic in seconds

Search topics with <kbd>⌘</kbd> <kbd>K</kbd>, see partitions and message counts at a glance, and create or
delete topics.

### Read and filter messages

<img src="docs/screenshots/02_messages_ql.png" alt="Query suggestions listing key values as you type a filter" width="820" />

Browse from the newest or oldest message, or watch new ones arrive live. Filter with SQL-like queries such as
`value.status = 'shipped'`, with suggestions as you type (see the [query guide](crates/kui_mql/README.md)), and
pick partitions and a starting point right in the query bar. Times are shown in UTC. Export to JSON or CSV, or
copy messages to another topic.

### Send messages and generate test data

<img src="docs/screenshots/06_generator.png" alt="The generator offering the topic's message shapes as templates" width="820" />

Send a message with its own key and headers, or fill a topic with generated test data. The generator reads the
messages already in a topic and offers their shapes as templates, so test data looks like the real thing.

### Run your own code on every message

<img src="docs/screenshots/05_actions.png" alt="A running action with its executions, the handler's response and its settings" width="820" />

<img src="docs/screenshots/05_actions_new.png" alt="Creating an action that sends messages to a local Lambda in the Lambda Test Tool" width="820" />

Actions hand Kafka messages to code running on your machine: a local AWS Lambda (through the Lambda Test Tool,
so you can stop on breakpoints) or any HTTP endpoint. Each run shows the request, the response and any error next
to the message that caused it, and you can send a single message to an action from the messages table. Actions
can be exported and imported as files to share with your team. See the [Lambda](examples/order-lambda/README.md)
and [HTTP](examples/order-api/README.md) examples to try it.

### Know which consumers are falling behind

<img src="docs/screenshots/03_consumers.png" alt="A consumer group's progress on each partition" width="820" />

See how far behind each consumer group is, and reset its offsets when it needs a fresh start.

### Make it yours

<img src="docs/screenshots/04_settings.png" alt="The Settings window" width="820" />

Light or dark theme, an accent color with an optional glossy finish, your own fonts, and automatic update
checks. Sharing your screen or recording a demo? Turn on privacy mode to hide cluster names and replace broker
addresses with made-up ones.

## Install

Download the installer from the [latest release](https://github.com/tructn/kui/releases/latest):

| Computer | File |
| --- | --- |
| Mac with Apple silicon (M1 or newer) | `KUI_<version>_aarch64.dmg` |
| Mac with an Intel processor | `KUI_<version>_x64.dmg` |
| Windows 10 or 11 | `KUI_<version>_x64-setup.exe` |

Not sure which Mac you have? Open the Apple menu → **About This Mac**: it lists a **Chip** (Apple M1 or newer)
on Apple silicon and a **Processor** (Intel) on an Intel Mac.

KUI isn't signed with a paid Apple or Microsoft certificate yet, so both systems warn you the first time you open
it. That's expected; you only need to allow it once.

<details>
<summary><strong>macOS</strong></summary>

1. Open the `.dmg` and drag KUI into **Applications**.
2. Open KUI. When macOS says it can't verify the app, click **Done**.
3. Go to **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to "KUI" was blocked.
   On macOS 11 and 12 it's **System Preferences → Security & Privacy → General**.

   Or run this in Terminal instead, then open KUI again:

   ```bash
   xattr -dr com.apple.quarantine /Applications/KUI.app
   ```

</details>

<details>
<summary><strong>Windows</strong></summary>

1. Run the installer.
2. If you see "Windows protected your PC", click **More info**, then **Run anyway**.

</details>

## Contributing

Bug reports and ideas are welcome in [Issues](https://github.com/tructn/kui/issues). If KUI saves you time,
a ⭐ on GitHub helps other people find it.

To build KUI yourself, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](./LICENSE) © 2026 Truc Nguyen
