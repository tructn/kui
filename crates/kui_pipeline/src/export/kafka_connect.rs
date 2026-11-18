//! A pipeline as Kafka Connect connectors: one Confluent HTTP Sink connector per route, with the
//! body shaped by Kafka's built-in single message transforms (SMTs).
//!
//! Connect has no MQL, no templates and no way to fan one record out into several requests, so a
//! pipeline using them can't be published. `compile` lists every such blocker at once. Features
//! that run with a visible difference (the envelope has no key or headers, there is no rate
//! limit) are warnings.

use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::HIDDEN;
use crate::model::{Action, Body, FieldMapping, Pipeline, Route, Source, Transform};

pub const CONNECTOR_CLASS: &str = "io.confluent.connect.http.HttpSinkConnector";
const SMT: &str = "org.apache.kafka.connect.transforms";
/// What KUI's `epochToIso` produces. TimestampConverter formats in UTC.
const ISO_FORMAT: &str = "yyyy-MM-dd'T'HH:mm:ss.SSSXXX";
const MAX_PREFIX: usize = 40;
const MAX_PROPERTIES: usize = 50;
const MAX_PROPERTY_VALUE: usize = 10_000;
/// Property names that usually hold a credential, hidden in a preview.
const SECRET_WORDS: &[&str] = &["password", "secret", "jaas", "token", "credential", "key"];

/// Settings for the connectors that aren't part of the pipeline itself.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectOptions {
    /// Starts every connector name, so KUI's connectors are easy to find.
    pub name_prefix: String,
    /// The Kafka cluster the Confluent connector keeps its license and delivery reports in, as the
    /// Connect workers reach it.
    pub bootstrap_servers: String,
    /// For the license and report topics; 1 on a single-broker development cluster.
    pub replication_factor: u16,
    /// Added to every connector, such as `confluent.topic.security.protocol` for a secured
    /// cluster. They may not replace what the pipeline sets.
    #[serde(default)]
    pub properties: BTreeMap<String, String>,
}

#[derive(Clone, Serialize, PartialEq, Debug)]
pub struct Connector {
    pub name: String,
    pub config: BTreeMap<String, String>,
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConnectPlan {
    /// Empty when there are blockers.
    pub connectors: Vec<Connector>,
    /// Behaviour that differs from running the pipeline in KUI.
    pub warnings: Vec<String>,
    /// What has to change before the pipeline can be published.
    pub blockers: Vec<String>,
}

impl ConnectPlan {
    /// The plan with webhook URLs, header values and credential-like properties hidden, for display.
    ///
    /// Hidden by key rather than by searching for the secret values: a short header value such as
    /// `1` would otherwise blank unrelated settings.
    pub fn redacted(mut self) -> Self {
        for connector in &mut self.connectors {
            let separator = connector.config.get("header.separator").cloned().unwrap_or_else(|| "|".to_string());
            for (key, value) in &mut connector.config {
                if key == "headers" {
                    let names: Vec<String> = value
                        .split(separator.as_str())
                        .map(|h| format!("{}:{HIDDEN}", h.split_once(':').map_or(h, |(name, _)| name)))
                        .collect();
                    *value = names.join(&separator);
                } else if key == "http.api.url" || is_secret_property(key) {
                    *value = HIDDEN.to_string();
                }
            }
        }
        self
    }
}

pub fn is_secret_property(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    // `key.converter` names a class, not a key.
    !key.starts_with("key.converter") && SECRET_WORDS.iter().any(|word| key.contains(word))
}

fn has_text(query: Option<&str>) -> bool {
    query.is_some_and(|q| !q.trim().is_empty())
}

pub fn compile(pipeline: &Pipeline, options: &ConnectOptions) -> ConnectPlan {
    let mut plan = ConnectPlan::default();
    if let Err(why) = check_options(options) {
        plan.blockers.push(why);
    }
    if has_text(pipeline.query.as_deref()) {
        plan.blockers.push("The pipeline's filter can't run on Kafka Connect. Clear it to publish.".to_string());
    }
    plan.warnings.push(format!(
        "Kafka Connect doesn't limit requests per minute, so the limit of {} isn't applied.",
        pipeline.max_per_minute
    ));
    plan.warnings.push(
        "A new connector starts at the oldest message the topic keeps, not only new ones, and delivers each \
         message at least once."
            .to_string(),
    );

    let several = pipeline.routes.len() > 1;
    let mut names = HashSet::new();
    for (index, route) in pipeline.routes.iter().enumerate() {
        let label = |why: String| if several { format!("Route {}: {why}", index + 1) } else { why };
        let mut route_plan = RoutePlan::default();
        let connector = compile_route(pipeline, route, options, &mut route_plan);
        plan.blockers.extend(route_plan.blockers.into_iter().map(label));
        for warning in route_plan.warnings.into_iter().map(label) {
            if !plan.warnings.contains(&warning) {
                plan.warnings.push(warning);
            }
        }
        if !names.insert(connector.name.clone()) {
            plan.blockers.push(label("Two routes would get the same connector name. Rename one.".to_string()));
        }
        plan.connectors.push(connector);
    }
    if !plan.blockers.is_empty() {
        plan.connectors.clear();
    }
    plan
}

fn check_options(options: &ConnectOptions) -> Result<(), String> {
    let prefix = &options.name_prefix;
    if prefix.is_empty()
        || prefix.len() > MAX_PREFIX
        || !prefix.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
    {
        return Err(format!("The name prefix needs 1 to {MAX_PREFIX} lowercase letters, digits, - or _."));
    }
    let servers = options.bootstrap_servers.trim();
    if servers.is_empty() || servers.len() > 1000 || servers.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("Enter the bootstrap servers the Connect workers use, such as broker:9092.".to_string());
    }
    if options.replication_factor == 0 {
        return Err("The replication factor must be at least 1.".to_string());
    }
    if options.properties.len() > MAX_PROPERTIES {
        return Err(format!("Up to {MAX_PROPERTIES} extra properties can be added."));
    }
    for (key, value) in &options.properties {
        if key.trim().is_empty() || key.len() > 200 || key.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return Err("Every extra property needs a name without spaces.".to_string());
        }
        if value.len() > MAX_PROPERTY_VALUE {
            return Err(format!("The property \"{key}\" is too long."));
        }
    }
    Ok(())
}

#[derive(Default)]
struct RoutePlan {
    blockers: Vec<String>,
    warnings: Vec<String>,
}

/// Lowercase letters, digits and single dashes, for a connector name.
fn slug(text: &str) -> String {
    let mut out = String::new();
    for c in text.chars().flat_map(char::to_lowercase) {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
    }
    let out: String = out.trim_end_matches('-').chars().take(60).collect();
    out.trim_end_matches('-').to_string()
}

pub fn connector_name(prefix: &str, pipeline: &str, route: &str) -> String {
    let pipeline = Some(slug(pipeline)).filter(|s| !s.is_empty()).unwrap_or_else(|| "pipeline".to_string());
    let route = Some(slug(route)).filter(|s| !s.is_empty()).unwrap_or_else(|| "route".to_string());
    format!("{prefix}-{pipeline}-{route}")
}

fn compile_route(pipeline: &Pipeline, route: &Route, options: &ConnectOptions, plan: &mut RoutePlan) -> Connector {
    if has_text(route.query.as_deref()) {
        plan.blockers.push("Its filter can't run on Kafka Connect.".to_string());
    }
    if route.split.is_some() {
        plan.blockers.push("Sending one request per list item can't run on Kafka Connect.".to_string());
    }
    let Action::Webhook(webhook) = &route.action;
    let rf = options.replication_factor.to_string();
    let servers = options.bootstrap_servers.trim();
    let mut config: BTreeMap<String, String> = [
        ("connector.class", CONNECTOR_CLASS),
        ("tasks.max", "1"),
        ("topics", pipeline.topic.as_str()),
        ("http.api.url", webhook.url.trim()),
        ("request.method", webhook.method.as_str()),
        ("request.body.format", "json"),
        // One request per message, as in KUI.
        ("batch.max.size", "1"),
        ("batch.json.as.array", "false"),
        // KUI counts a failed request and carries on; Connect's default stops the task.
        ("behavior.on.error", "log"),
        // A value that isn't JSON fails in the converter, which would also stop the task.
        ("errors.tolerance", "all"),
        ("errors.log.enable", "true"),
        ("key.converter", "org.apache.kafka.connect.storage.StringConverter"),
        ("value.converter", "org.apache.kafka.connect.json.JsonConverter"),
        ("value.converter.schemas.enable", "false"),
        ("confluent.topic.bootstrap.servers", servers),
        ("confluent.topic.replication.factor", &rf),
        ("reporter.bootstrap.servers", servers),
        ("reporter.result.topic.replication.factor", &rf),
        ("reporter.error.topic.replication.factor", &rf),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect();

    if !webhook.headers.is_empty() {
        let used = |s: &str| webhook.headers.iter().any(|h| h.name.contains(s) || h.value.contains(s));
        match ["|", "^", "~", "`"].into_iter().find(|s| !used(s)) {
            Some(separator) => {
                let headers: Vec<String> =
                    webhook.headers.iter().map(|h| format!("{}:{}", h.name.trim(), h.value)).collect();
                config.insert("headers".to_string(), headers.join(separator));
                config.insert("header.separator".to_string(), separator.to_string());
            }
            None => plan.blockers.push("A header uses every separator Kafka Connect allows (| ^ ~ `).".to_string()),
        }
    }

    let transforms = body_transforms(&webhook.body, &pipeline.name, plan);
    if !transforms.is_empty() {
        let aliases: Vec<&str> = transforms.iter().map(|t| t.alias.as_str()).collect();
        config.insert("transforms".to_string(), aliases.join(","));
        for t in &transforms {
            for (key, value) in &t.settings {
                config.insert(format!("transforms.{}.{key}", t.alias), value.clone());
            }
        }
    }

    for (key, value) in &options.properties {
        if config.contains_key(key) {
            plan.blockers.push(format!("The extra property \"{key}\" is set by the pipeline and can't be replaced."));
        } else {
            config.insert(key.clone(), value.clone());
        }
    }
    Connector { name: connector_name(&options.name_prefix, &pipeline.name, &route.id), config }
}

/// One single message transform: an alias and its settings, `type` included.
struct Smt {
    alias: String,
    settings: Vec<(&'static str, String)>,
}

fn smt(alias: impl Into<String>, kind: &str, settings: Vec<(&'static str, String)>) -> Smt {
    let mut all = vec![("type", format!("{SMT}.{kind}$Value"))];
    all.extend(settings);
    Smt { alias: alias.into(), settings: all }
}

fn body_transforms(body: &Body, pipeline: &str, plan: &mut RoutePlan) -> Vec<Smt> {
    match body {
        Body::Envelope => {
            plan.warnings.push(
                "On Kafka Connect the message body has the topic, partition, offset, time and value, but not \
                 the key or headers."
                    .to_string(),
            );
            vec![
                smt("wrap", "HoistField", vec![("field", "value".to_string())]),
                smt(
                    "describe",
                    "InsertField",
                    vec![
                        ("topic.field", "topic".to_string()),
                        ("partition.field", "partition".to_string()),
                        ("offset.field", "offset".to_string()),
                        ("timestamp.field", "timestamp".to_string()),
                        ("static.field", "automation".to_string()),
                        ("static.value", pipeline.to_string()),
                    ],
                ),
            ]
        }
        Body::Template { .. } => {
            plan.blockers.push(
                "A body template can't run on Kafka Connect. Send the whole message or map fields instead.".to_string(),
            );
            Vec::new()
        }
        Body::Mapping { fields } => mapping_transforms(fields, plan),
    }
}

/// Where a mapped field's value comes from on Connect.
enum ConnectSource {
    /// A field of the record value; nested paths are read after `Flatten` joins them with dots.
    Value(String),
    /// Record metadata `InsertField` can add, by its setting name.
    Metadata(&'static str),
}

fn connect_source(path: &str) -> Option<ConnectSource> {
    let path = path.trim();
    let metadata = match path {
        "topic" => Some("topic.field"),
        "partition" => Some("partition.field"),
        "offset" => Some("offset.field"),
        "timestamp" => Some("timestamp.field"),
        _ => None,
    };
    if let Some(setting) = metadata {
        return Some(ConnectSource::Metadata(setting));
    }
    let steps: Vec<&str> = path.strip_prefix("value.")?.split('.').collect();
    let plain = |s: &&str| !s.is_empty() && s.parse::<usize>().is_err() && !s.contains([',', ':']);
    steps.iter().all(plain).then(|| ConnectSource::Value(steps.join(".")))
}

fn transform_name(transform: Transform) -> &'static str {
    match transform {
        Transform::Trim => "trim",
        Transform::Upper => "uppercase",
        Transform::Lower => "lowercase",
        Transform::ToNumber => "to number",
        Transform::ToString => "to text",
        Transform::ToBoolean => "to true/false",
        Transform::EpochToIso => "epoch to date",
        Transform::Count => "count",
        Transform::Join => "join",
        Transform::First => "first",
        Transform::Last => "last",
    }
}

fn mapping_transforms(fields: &[FieldMapping], plan: &mut RoutePlan) -> Vec<Smt> {
    let mut flatten = false;
    let (mut include, mut renames) = (Vec::new(), Vec::new());
    let mut inserts = Vec::new();
    let (mut casts, mut dates) = (Vec::new(), Vec::new());
    let mut read = HashSet::new();

    for field in fields {
        let target = field.target.trim();
        let mut block = |why: &str| plan.blockers.push(format!("\"{target}\": {why}"));
        if target.is_empty() || target.contains(['.', ',', ':']) || target.parse::<usize>().is_ok() {
            block("only top-level field names can be set on Kafka Connect.");
            continue;
        }
        if field.default.is_some() {
            block("a default value can't run on Kafka Connect.");
        }
        match &field.source {
            Source::Field { path } => match connect_source(path) {
                Some(ConnectSource::Value(name)) => {
                    flatten |= name.contains('.');
                    if !read.insert(name.clone()) {
                        block("Kafka Connect can't copy the same field twice.");
                    }
                    if name != target {
                        renames.push(format!("{name}:{target}"));
                    }
                    include.push(name);
                }
                Some(ConnectSource::Metadata(setting)) => inserts.push(vec![(setting, target.to_string())]),
                None => block(
                    "only the value's fields, the topic, partition, offset and timestamp can be read on Kafka Connect.",
                ),
            },
            Source::Fixed { value: Value::String(text) } => {
                inserts.push(vec![("static.field", target.to_string()), ("static.value", text.clone())]);
            }
            Source::Fixed { .. } => block("only text can be a fixed value on Kafka Connect."),
            Source::Template { .. } => block("templates can't run on Kafka Connect."),
            Source::Each { .. } => block("mapping a list item by item can't run on Kafka Connect."),
        }
        match field.transform {
            None => {}
            Some(Transform::ToNumber) => casts.push(format!("{target}:float64")),
            Some(Transform::ToString) => casts.push(format!("{target}:string")),
            Some(Transform::ToBoolean) => casts.push(format!("{target}:boolean")),
            Some(Transform::EpochToIso) => dates.push(target.to_string()),
            Some(other) => block(&format!("the \"{}\" conversion can't run on Kafka Connect.", transform_name(other))),
        }
    }
    if include.is_empty() {
        plan.blockers
            .push("Map at least one field of the message value: Kafka Connect builds the body from it.".to_string());
    }

    let mut smts = Vec::new();
    if flatten {
        smts.push(smt("flatten", "Flatten", vec![("delimiter", ".".to_string())]));
    }
    let mut pick = vec![("include", include.join(","))];
    if !renames.is_empty() {
        pick.push(("renames", renames.join(",")));
    }
    smts.push(smt("pick", "ReplaceField", pick));
    for (n, settings) in inserts.into_iter().enumerate() {
        smts.push(smt(format!("insert{}", n + 1), "InsertField", settings));
    }
    if !casts.is_empty() {
        smts.push(smt("cast", "Cast", vec![("spec", casts.join(","))]));
    }
    for (n, field) in dates.into_iter().enumerate() {
        smts.push(smt(
            format!("date{}", n + 1),
            "TimestampConverter",
            vec![("field", field), ("target.type", "string".to_string()), ("format", ISO_FORMAT.to_string())],
        ));
    }
    smts
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{HttpMethod, Webhook, WebhookHeader};

    fn options() -> ConnectOptions {
        ConnectOptions {
            name_prefix: "kui".into(),
            bootstrap_servers: "broker:29092".into(),
            replication_factor: 1,
            properties: BTreeMap::new(),
        }
    }

    fn pipeline(body: Body) -> Pipeline {
        Pipeline {
            name: "Order alerts".into(),
            topic: "orders".into(),
            query: None,
            max_per_minute: 60,
            routes: vec![Route {
                id: "route-1".into(),
                query: None,
                split: None,
                action: Action::Webhook(Webhook {
                    url: "https://hooks.example.com/SECRET-URL".into(),
                    method: HttpMethod::Patch,
                    headers: vec![
                        WebhookHeader { name: "Authorization".into(), value: "Bearer SECRET|TOKEN".into() },
                        WebhookHeader { name: "X-Source".into(), value: "kui".into() },
                    ],
                    body,
                }),
            }],
        }
    }

    fn field(target: &str, path: &str, transform: Option<Transform>) -> FieldMapping {
        FieldMapping { target: target.into(), source: Source::Field { path: path.into() }, transform, default: None }
    }

    fn config(plan: &ConnectPlan) -> &BTreeMap<String, String> {
        assert!(plan.blockers.is_empty(), "{:?}", plan.blockers);
        &plan.connectors[0].config
    }

    #[test]
    fn a_route_becomes_an_http_sink_connector() {
        let plan = compile(&pipeline(Body::Envelope), &options());
        let c = config(&plan);
        assert_eq!(plan.connectors[0].name, "kui-order-alerts-route-1");
        assert_eq!(c["connector.class"], CONNECTOR_CLASS);
        assert_eq!((c["topics"].as_str(), c["request.method"].as_str()), ("orders", "PATCH"));
        assert_eq!(c["http.api.url"], "https://hooks.example.com/SECRET-URL");
        assert_eq!((c["batch.max.size"].as_str(), c["batch.json.as.array"].as_str()), ("1", "false"));
        assert_eq!(c["reporter.bootstrap.servers"], "broker:29092");
        assert_eq!((c["behavior.on.error"].as_str(), c["errors.tolerance"].as_str()), ("log", "all"));
        assert_eq!(c["confluent.topic.replication.factor"], "1");
    }

    #[test]
    fn headers_use_a_separator_no_header_contains() {
        let plan = compile(&pipeline(Body::Envelope), &options());
        let c = config(&plan);
        assert_eq!(c["header.separator"], "^");
        assert_eq!(c["headers"], "Authorization:Bearer SECRET|TOKEN^X-Source:kui");
    }

    #[test]
    fn the_envelope_wraps_the_value_and_adds_where_it_came_from() {
        let plan = compile(&pipeline(Body::Envelope), &options());
        let c = config(&plan);
        assert_eq!(c["transforms"], "wrap,describe");
        assert_eq!(c["transforms.wrap.type"], "org.apache.kafka.connect.transforms.HoistField$Value");
        assert_eq!(c["transforms.wrap.field"], "value");
        assert_eq!(c["transforms.describe.static.value"], "Order alerts");
        assert!(plan.warnings.iter().any(|w| w.contains("not the key or headers")));
    }

    #[test]
    fn a_mapping_becomes_flatten_pick_insert_cast_and_date_transforms() {
        let mut fixed = field("source", "", None);
        fixed.source = Source::Fixed { value: Value::from("kui") };
        let body = Body::Mapping {
            fields: vec![
                field("id", "value.id", None),
                field("customer", "value.customer.name", None),
                field("total", "value.total", Some(Transform::ToNumber)),
                field("placedAt", "value.placedAt", Some(Transform::EpochToIso)),
                field("from", "topic", None),
                fixed,
            ],
        };
        let plan = compile(&pipeline(body), &options());
        let c = config(&plan);
        assert_eq!(c["transforms"], "flatten,pick,insert1,insert2,cast,date1");
        assert_eq!(c["transforms.pick.include"], "id,customer.name,total,placedAt");
        assert_eq!(c["transforms.pick.renames"], "customer.name:customer");
        assert_eq!(c["transforms.insert1.topic.field"], "from");
        assert_eq!(
            (c["transforms.insert2.static.field"].as_str(), c["transforms.insert2.static.value"].as_str()),
            ("source", "kui")
        );
        assert_eq!(c["transforms.cast.spec"], "total:float64");
        assert_eq!(
            (c["transforms.date1.field"].as_str(), c["transforms.date1.format"].as_str()),
            ("placedAt", ISO_FORMAT)
        );
    }

    #[test]
    fn everything_connect_cannot_run_is_listed_at_once() {
        let mut p = pipeline(Body::Mapping {
            fields: vec![
                field("a.b", "value.x", None),
                field("k", "key", None),
                field("n", "value.name", Some(Transform::Upper)),
                FieldMapping {
                    target: "lines".into(),
                    source: Source::Each { path: "value.items".into(), fields: vec![] },
                    transform: None,
                    default: None,
                },
            ],
        });
        p.query = Some("value.x = 1".into());
        p.routes[0].split = Some("value.items".into());
        let mut second = p.routes[0].clone();
        second.id = "route-2".into();
        let Action::Webhook(w) = &mut second.action;
        w.body = Body::Template { text: "{{value}}".into() };
        p.routes.push(second);

        let plan = compile(&p, &options());
        assert!(plan.connectors.is_empty());
        let all = plan.blockers.join("\n");
        for expected in [
            "The pipeline's filter",
            "Route 1: Sending one request per list item",
            "Route 1: \"a.b\": only top-level",
            "Route 1: \"k\": only the value's fields",
            "Route 1: \"n\": the \"uppercase\" conversion",
            "Route 1: \"lines\": mapping a list item by item",
            "Route 2: A body template",
        ] {
            assert!(all.contains(expected), "missing {expected:?} in\n{all}");
        }
    }

    #[test]
    fn extra_properties_are_added_but_cannot_replace_the_pipelines() {
        let mut o = options();
        o.properties.insert("confluent.topic.security.protocol".into(), "SASL_SSL".into());
        let plan = compile(&pipeline(Body::Envelope), &o);
        assert_eq!(config(&plan)["confluent.topic.security.protocol"], "SASL_SSL");

        o.properties.insert("http.api.url".into(), "https://elsewhere".into());
        assert!(compile(&pipeline(Body::Envelope), &o).blockers[0].contains("\"http.api.url\" is set by the pipeline"));
    }

    #[test]
    fn bad_options_block_publishing() {
        for change in [
            (|o: &mut ConnectOptions| o.name_prefix = "KUI prod".into()) as fn(&mut ConnectOptions),
            |o| o.bootstrap_servers = " ".into(),
            |o| o.replication_factor = 0,
            |o| _ = o.properties.insert("bad key".into(), "v".into()),
        ] {
            let mut o = options();
            change(&mut o);
            assert_eq!(compile(&pipeline(Body::Envelope), &o).blockers.len(), 1);
        }
    }

    #[test]
    fn a_redacted_plan_hides_urls_header_values_and_credential_properties() {
        let mut o = options();
        o.properties.insert("confluent.topic.sasl.jaas.config".into(), "user=\"u\" password=\"p\"".into());
        let p = pipeline(Body::Envelope);
        let plan = compile(&p, &o).redacted();
        let text = format!("{:?}", plan.connectors);
        assert!(!text.contains("SECRET") && !text.contains("password=\"p\""), "the preview leaks a credential");
        let c = &plan.connectors[0].config;
        assert_eq!(c["headers"], "Authorization:<hidden>^X-Source:<hidden>");
        assert_eq!(c["key.converter"], "org.apache.kafka.connect.storage.StringConverter");
    }

    #[test]
    fn connector_names_are_safe_slugs() {
        assert_eq!(connector_name("kui", "  Orders → CRM!! ", "Route 1"), "kui-orders-crm-route-1");
        assert_eq!(connector_name("kui", "日本", "--"), "kui-pipeline-route");
    }
}
