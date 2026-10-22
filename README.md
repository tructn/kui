<p align="center">
  <img src="public/logo.svg" alt="KUI logo" width="112" height="112" />
</p>

<h1 align="center">KUI</h1>

<p align="center">
  <strong>Kafka, without the terminal.</strong><br />
  A fast, free desktop app to browse topics, read and send messages, and keep an eye on your consumers.
</p>

<p align="center">
  <a href="https://github.com/tructn/kui/actions/workflows/release.yml"><img src="https://github.com/tructn/kui/actions/workflows/release.yml/badge.svg" alt="Release" /></a>
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
  <img src="docs/01_topics.png" alt="KUI showing the topics of a Kafka cluster" width="820" />
</p>

## Why KUI

Most Kafka tools are either command-line scripts or web dashboards you have to deploy and keep running.
KUI is neither. It's a desktop app: download it, add your cluster, and you're looking at your data.

- **Nothing to set up.** No server, no Docker, no config files. Install it like any other app.
- **Small and fast.** Built with [Tauri](https://tauri.app) and Rust, so it starts quickly and uses little memory.
- **Private by design.** Your clusters and passwords stay on your computer. KUI doesn't collect anything.
- **Free and open source.** MIT licensed, with no account and no paid tier.

## Features

### Find any topic in seconds

Search every topic from anywhere with <kbd>⌘</kbd> <kbd>K</kbd>, or filter the list with a regular expression.
See each topic's partitions, replicas and message count at a glance, create and delete topics, and copy a
topic's name with one click. A Brokers page shows the machines your cluster runs on.

### Read messages the way you want

<img src="docs/02_messages.png" alt="The messages of a topic, with one row expanded" width="820" />

- Start from the newest or oldest message, or **watch new ones arrive live**.
- Expand any row to see its key, headers and value side by side. Values show as formatted JSON or Base64.
- **Export** messages to JSON, NDJSON or CSV.
- **Copy** one or many messages to another topic, which is handy for replaying a message or moving test data.

### Send messages and generate test data

Write a message with its own key and headers and send it, or have KUI fill a topic with generated test data
in a few clicks.

### Know which consumers are falling behind

<img src="docs/03_consumers.png" alt="A consumer group's progress on each partition" width="820" />

See every consumer group, whether it's caught up, and how far behind it is on each partition.
When a group needs a fresh start, **reset its offsets** to the earliest message, the latest one, or a point in time.

### Connect to any cluster

<img src="docs/00_cluster.png" alt="The Add cluster dialog" width="820" />

Add a cluster with its address, test the connection, and save it. Secure clusters work too:
SSL, plus SASL with PLAIN, SCRAM-SHA-256 or SCRAM-SHA-512. If a connection fails, KUI tells you why in plain
words instead of showing a raw error.

### Make it yours

<img src="docs/04_settings.png" alt="The Settings window" width="820" />

Light, dark, or follow your system. Pick your own fonts. KUI also checks for updates when it starts and asks
before installing them.

## Install

Download the installer from the [latest release](https://github.com/tructn/kui/releases/latest):

| Computer | File |
| --- | --- |
| Mac with Apple silicon (M1 or newer) | `KUI_<version>_aarch64.dmg` |
| Windows 10 or 11 | `KUI_<version>_x64-setup.exe` |

KUI isn't signed with a paid Apple or Microsoft certificate yet, so both systems warn you the first time you open
it. That's expected; you only need to allow it once.

<details>
<summary><strong>macOS</strong></summary>

1. Open the `.dmg` and drag KUI into **Applications**.
2. Open KUI. When macOS says it can't verify the app, click **Done**.
3. Go to **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to "KUI" was blocked.

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

> [!NOTE]
> KUI is in early development (alpha). It works well day to day, but expect rough edges and frequent updates.
> If something breaks, please [open an issue](https://github.com/tructn/kui/issues).

## Contributing

Bug reports and ideas are welcome in [Issues](https://github.com/tructn/kui/issues). If KUI saves you time,
a ⭐ on GitHub helps other people find it.

To build KUI yourself, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](./LICENSE) © 2026 Truc Nguyen
