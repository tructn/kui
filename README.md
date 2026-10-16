<p align="center">
  <img src="public/logo.svg" alt="KUI logo" width="112" height="112" />
</p>

<h1 align="center">KUI</h1>

<p align="center">
  <strong>A fast, friendly desktop app for Apache Kafka.</strong><br />
  Browse topics, read and produce messages, and see consumer lag at a glance, without a single CLI flag.
</p>

<p align="center">
  <a href="https://github.com/tructn/kui/releases"><strong>Download for macOS &amp; Windows</strong></a>
</p>

<p align="center">
  <img src="docs/topics.png" alt="KUI showing the topics of a Kafka cluster" width="900" />
</p>

## Why KUI

The Kafka CLI can do almost anything, as long as you remember the flags. Web consoles are friendlier, but someone has
to deploy and run them first. KUI is a desktop app instead: open it, add your cluster, and every topic, message and
consumer group is a click or a keystroke away.

- **Small and fast.** Built in Rust with [Tauri](https://tauri.app), using your system's built-in webview instead of
  bundling a browser. Quick startup, no JVM, no Docker, no server to run.
- **Your data stays local.** Connection settings live on your machine. Nothing is sent anywhere else.
- **Built for daily use.** Keyboard shortcuts everywhere, a topic search on <kbd>⌘</kbd> <kbd>K</kbd>, and light and
  dark themes.

## Read messages the way you think about them

Jump to the newest or oldest messages, a specific offset, or a point in time, in any partition. Flip on **Live**
and new messages stream in as they arrive.

<p align="center">
  <img src="docs/messages.png" alt="Messages of a topic, with partition, offset, timestamp, key and value" width="900" />
</p>

Open any message to see its value, key and headers. KUI detects the format and shows it readably: JSON and
XML pretty-printed, plain text, MessagePack, and **Avro, Protobuf and JSON Schema** through a Confluent-compatible
Schema Registry (add its URL to the cluster). Protobuf without a registry is shown field by field. When producing,
write a value as JSON and pick a subject: KUI encodes it as Avro, Protobuf or JSON Schema with the subject's latest
version. Then **copy or duplicate** a message to another topic, byte for byte, headers included.

<p align="center">
  <img src="docs/message-value.png" alt="A message opened in a side panel with formatted JSON" width="900" />
</p>

## See consumer lag at a glance

Every consumer group shows how far it has read each partition, with progress bars, lag per partition and a clear
status. Spot the stuck consumer in seconds.

<p align="center">
  <img src="docs/topic-consumers.png" alt="Consumers of a topic with per-partition progress and lag" width="900" />
</p>

<p align="center">
  <img src="docs/topic-lags.png" alt="A consumer group's lag across partitions, in dark mode" width="900" />
</p>

## Connect to any cluster

PLAINTEXT, SSL and SASL (PLAIN, SCRAM) work out of the box, and any librdkafka property can be added for the
unusual setups. Test the connection before you save it, and switch between clusters from the sidebar.

<p align="center">
  <img src="docs/add-cluster.png" alt="The Add cluster dialog" width="900" />
</p>

## And more

- Create and delete topics; inspect partitions, watermarks, replicas and configuration
- Consumer group members and assignments; delete groups
- Broker overview with under-replicated and offline partition counts
- Sortable, resizable columns and fast filtering across every table

## Install

Grab the latest installer from the [Releases](https://github.com/tructn/kui/releases) page.

| Platform | Download |
| --- | --- |
| macOS (Apple Silicon) | `KUI_<version>_aarch64.dmg` |
| Windows 10/11 (x64) | `KUI_<version>_x64-setup.exe` |

**macOS:** open the `.dmg` and drag KUI into Applications. Builds aren't notarized yet, so the first launch shows
*"Apple could not verify “KUI” is free of malware"*. Click **Done**, then open **System Settings → Privacy &
Security**, scroll to *"KUI" was blocked*, click **Open Anyway** and confirm. (On macOS 15 and later, right-click →
Open no longer works for this.) Or remove the download quarantine from a terminal:

```bash
xattr -dr com.apple.quarantine /Applications/KUI.app
```

**Windows:** run the installer. No admin rights are needed. The installer isn't code-signed yet, so SmartScreen may
show *"Windows protected your PC"*: click **More info** → **Run anyway**. If Microsoft Defender or another antivirus
flags or removes the file, it's a false positive on an unsigned download. Check the file came from this repo's
Releases page (`gh attestation verify <file> --repo tructn/kui`), then restore it from quarantine, and please
[open an issue](https://github.com/tructn/kui/issues) so it can be reported to the vendor.

Updates installed from inside the app don't show these prompts.

**Updates:** KUI checks for new versions at startup and offers to install them; it restarts to finish. To try
new features early, turn on **Settings → Updates → Include release candidates**. You can also turn automatic
checks off there and use **Check now** instead.

## Contributing

Bug reports and ideas are welcome in [Issues](https://github.com/tructn/kui/issues). To build KUI yourself, see
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](./LICENSE) © 2026 Truc Nguyen
