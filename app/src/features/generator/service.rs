use std::time::{Duration, Instant};

use fake::faker::impls::address::CityNameGenFn;
use fake::locales::{DE_DE, EN, FR_FR, IT_IT, JA_JP, NL_NL, PT_BR, ZH_CN};
use fake::rand::rngs::StdRng;
use fake::rand::{RngExt, SeedableRng};
use rdkafka::error::{KafkaError, RDKafkaErrorCode};
use rdkafka::message::{Header, OwnedHeaders};
use rdkafka::producer::FutureRecord;

use super::model::{GenerateProgress, GenerateRequest, GeneratedHeader, GeneratedRecord, Locale, RecordTemplate};
use super::template::Template;
use crate::error::{Error, Result};
use crate::kafka::KafkaClients;
use crate::kafka::metadata::ensure_writable;
use crate::tasks::CancelToken;

const MAX_COUNT: u64 = 10_000_000;
const MAX_PREVIEW: usize = 20;
/// Records handed to librdkafka before waiting for their delivery reports.
const MAX_BATCH: u64 = 500;

/// A `RecordTemplate` with every template parsed and checked.
struct Compiled {
    key: Option<Template>,
    value: Template,
    headers: Vec<(String, Template)>,
    locale: Locale,
}

impl Compiled {
    fn new(source: &RecordTemplate) -> Result<Self> {
        let parse = |what: &str, s: &str| Template::parse(s).map_err(|e| Error::msg(format!("{what}: {e}")));
        Ok(Self {
            key: source.key.as_deref().filter(|k| !k.is_empty()).map(|k| parse("Key", k)).transpose()?,
            value: parse("Value", &source.value)?,
            headers: source
                .headers
                .iter()
                .map(|h| Ok((h.key.clone(), parse(&format!("Header {}", h.key), &h.value)?)))
                .collect::<Result<_>>()?,
            locale: source.locale,
        })
    }

    fn render<R: RngExt + ?Sized>(&self, index: u64, rng: &mut R) -> GeneratedRecord {
        macro_rules! with_locale {
            ($($variant:ident => $data:expr),*) => {
                match self.locale { $(Locale::$variant => self.render_in($data, index, rng)),* }
            };
        }
        with_locale!(En => EN, FrFr => FR_FR, DeDe => DE_DE, ItIt => IT_IT, NlNl => NL_NL, PtBr => PT_BR, JaJp => JA_JP, ZhCn => ZH_CN)
    }

    fn render_in<L, R>(&self, locale: L, index: u64, rng: &mut R) -> GeneratedRecord
    where
        L: CityNameGenFn,
        R: RngExt + ?Sized,
    {
        GeneratedRecord {
            key: self.key.as_ref().map(|t| t.render(index, locale, rng)),
            value: self.value.render(index, locale, rng),
            headers: self
                .headers
                .iter()
                .map(|(key, t)| GeneratedHeader { key: key.clone(), value: t.render(index, locale, rng) })
                .collect(),
        }
    }
}

/// Renders a few sample records without producing anything.
pub fn preview(template: &RecordTemplate, count: usize) -> Result<Vec<GeneratedRecord>> {
    let compiled = Compiled::new(template)?;
    let mut rng = fake::rand::rng();
    Ok((0..count.clamp(1, MAX_PREVIEW) as u64).map(|i| compiled.render(i, &mut rng)).collect())
}

/// Produces `count` generated records, optionally throttled to `rate` per second.
///
/// Reports progress after every batch and stops early when `cancel` fires.
/// Returns the final tally; delivery failures are counted, not fatal.
pub async fn generate(
    clients: &KafkaClients,
    request: &GenerateRequest,
    cancel: &CancelToken,
    mut progress: impl FnMut(&GenerateProgress),
) -> Result<GenerateProgress> {
    ensure_writable(&request.topic)?;
    let compiled = Compiled::new(&request.template)?;
    let total = request.count.clamp(1, MAX_COUNT);
    let rate = request.rate.filter(|r| *r > 0).map(u64::from);
    // Small batches when throttled so progress and pacing stay smooth.
    let batch_size = rate.map_or(MAX_BATCH, |r| (r / 4).clamp(1, MAX_BATCH));
    // StdRng (unlike the thread-local rng) is `Send`, so it can live across awaits.
    let mut rng = StdRng::from_rng(&mut fake::rand::rng());

    let started = Instant::now();
    let mut stats = GenerateProgress { total, ..Default::default() };
    let mut next = 0;
    while next < total && !cancel.is_cancelled() {
        let end = (next + batch_size).min(total);
        let records: Vec<GeneratedRecord> = (next..end).map(|i| compiled.render(i, &mut rng)).collect();

        let mut deliveries = Vec::with_capacity(records.len());
        for record in &records {
            let headers = record
                .headers
                .iter()
                .fold(OwnedHeaders::new(), |hs, h| hs.insert(Header { key: &h.key, value: Some(h.value.as_bytes()) }));
            let mut out: FutureRecord<'_, str, str> =
                FutureRecord::to(&request.topic).payload(record.value.as_str()).headers(headers);
            if let Some(key) = &record.key {
                out = out.key(key);
            }
            if let Some(partition) = request.partition {
                out = out.partition(partition);
            }
            // Enqueue without waiting; if librdkafka's queue is full, give it a moment to drain.
            loop {
                match clients.producer.send_result(out) {
                    Ok(delivery) => break deliveries.push(delivery),
                    Err((KafkaError::MessageProduction(RDKafkaErrorCode::QueueFull), back)) => {
                        out = back;
                        tokio::time::sleep(Duration::from_millis(20)).await;
                    }
                    Err((e, _)) => return Err(e.into()),
                }
            }
        }

        for delivery in deliveries {
            match delivery.await {
                Ok(Ok(_)) => stats.sent += 1,
                Ok(Err((e, _))) => {
                    stats.failed += 1;
                    stats.first_error.get_or_insert_with(|| e.to_string());
                }
                Err(_) => stats.failed += 1,
            }
        }
        next = end;
        stats.elapsed_ms = started.elapsed().as_millis() as u64;
        progress(&stats);

        if let Some(rate) = rate {
            let due = Duration::from_secs_f64(next as f64 / rate as f64);
            if let Some(wait) = due.checked_sub(started.elapsed()) {
                tokio::time::sleep(wait).await;
            }
        }
    }
    stats.elapsed_ms = started.elapsed().as_millis() as u64;
    Ok(stats)
}
