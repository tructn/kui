//! Message templates with `{{placeholders}}` filled by the `fake` crate.
//!
//!   {"id": {{seq}}, "user": "{{name}}", "amount": {{float 1 500 2}}, "status": "{{pick new paid shipped}}"}
//!
//! A template is parsed once (so a typo fails before anything is produced) and
//! then rendered for every record. Pure logic, no Kafka.

use chrono::{DateTime, Duration, SecondsFormat, Utc};
use fake::faker::impls::address::CityNameGenFn;
use fake::faker::{
    address::raw as address, company::raw as company, currency::raw as currency, internet::raw as internet,
    job::raw as job, lorem::raw as lorem, name::raw as name, phone_number::raw as phone,
};
use fake::uuid::UUIDv4;
use fake::{Fake, RngExt};

use super::model::GeneratorInfo;
use crate::error::{Error, Result};

/// Every placeholder: (name, example, description). The UI shows this as a cheat sheet,
/// and a test checks each example parses, so the docs can't drift from the parser.
pub const GENERATORS: &[(&str, &str, &str)] = &[
    ("seq", "{{seq}} / {{seq 1000}}", "Record number, counting from 1 (or the given start)"),
    ("uuid", "{{uuid}}", "Random UUID v4"),
    ("int", "{{int 1 100}}", "Whole number in [min, max]"),
    ("float", "{{float 0 1 3}}", "Decimal in [min, max] with N decimals (default 2)"),
    ("bool", "{{bool}} / {{bool 80}}", "true/false, optionally with a % chance of true"),
    ("pick", "{{pick new paid \"in transit\"}}", "One of the given values"),
    ("digits", "{{digits \"###-####\"}}", "Replaces each # with a digit"),
    ("hex", "{{hex 16}}", "Random hex string of N characters"),
    ("first_name", "{{first_name}}", "First name"),
    ("last_name", "{{last_name}}", "Last name"),
    ("name", "{{name}}", "Full name"),
    ("email", "{{email}}", "Email address on a safe example domain"),
    ("username", "{{username}}", "Username"),
    ("password", "{{password}}", "Password (8-16 characters)"),
    ("phone", "{{phone}}", "Phone number"),
    ("company", "{{company}}", "Company name"),
    ("industry", "{{industry}}", "Industry"),
    ("job_title", "{{job_title}}", "Job title"),
    ("catch_phrase", "{{catch_phrase}}", "Marketing catch phrase"),
    ("street", "{{street}}", "Street address"),
    ("city", "{{city}}", "City"),
    ("state", "{{state}}", "State or region"),
    ("zip", "{{zip}}", "Postal code"),
    ("country", "{{country}}", "Country name"),
    ("country_code", "{{country_code}}", "ISO country code"),
    ("latitude", "{{latitude}}", "Latitude"),
    ("longitude", "{{longitude}}", "Longitude"),
    ("word", "{{word}}", "Lorem ipsum word"),
    ("words", "{{words 3}}", "N lorem ipsum words"),
    ("sentence", "{{sentence}}", "Lorem ipsum sentence"),
    ("paragraph", "{{paragraph}}", "Lorem ipsum paragraph"),
    ("ipv4", "{{ipv4}}", "IPv4 address"),
    ("ipv6", "{{ipv6}}", "IPv6 address"),
    ("mac", "{{mac}}", "MAC address"),
    ("user_agent", "{{user_agent}}", "Browser user agent"),
    ("currency", "{{currency}}", "Currency code, e.g. EUR"),
    ("now", "{{now}}", "Current time, epoch millis"),
    ("now_iso", "{{now_iso}}", "Current time, ISO 8601"),
    ("timestamp", "{{timestamp}} / {{timestamp 7}}", "Random time in the last N days (default 30), epoch millis"),
    ("datetime", "{{datetime}} / {{datetime 7}}", "Random time in the last N days (default 30), ISO 8601"),
    ("date", "{{date}} / {{date 365}}", "Random date in the last N days (default 365), YYYY-MM-DD"),
];

pub fn generator_infos() -> Vec<GeneratorInfo> {
    GENERATORS
        .iter()
        .map(|(name, example, description)| GeneratorInfo {
            name: name.to_string(),
            example: example.to_string(),
            description: description.to_string(),
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq)]
pub struct Template {
    parts: Vec<Part>,
}

#[derive(Debug, Clone, PartialEq)]
enum Part {
    Text(String),
    Fake(Gen),
}

#[derive(Debug, Clone, PartialEq)]
enum Gen {
    Seq(i64),
    Uuid,
    Int(i64, i64),
    Float(f64, f64, usize),
    Bool(u8),
    Pick(Vec<String>),
    Digits(String),
    Hex(usize),
    FirstName,
    LastName,
    Name,
    Email,
    Username,
    Password,
    Phone,
    Company,
    Industry,
    JobTitle,
    CatchPhrase,
    Street,
    City,
    State,
    Zip,
    Country,
    CountryCode,
    Latitude,
    Longitude,
    Word,
    Words(usize),
    Sentence,
    Paragraph,
    Ipv4,
    Ipv6,
    Mac,
    UserAgent,
    Currency,
    Now,
    NowIso,
    /// Random instant in the last N days, as epoch millis / ISO 8601 / date.
    Timestamp(i64),
    DateTime(i64),
    Date(i64),
}

impl Template {
    pub fn parse(source: &str) -> Result<Self> {
        let mut parts = Vec::new();
        let mut rest = source;
        while let Some(open) = rest.find("{{") {
            let Some(close) = rest[open..].find("}}") else {
                return Err(Error::msg("Unclosed {{ in template"));
            };
            if open > 0 {
                parts.push(Part::Text(rest[..open].to_string()));
            }
            let inner = &rest[open + 2..open + close];
            parts.push(Part::Fake(parse_placeholder(inner)?));
            rest = &rest[open + close + 2..];
        }
        if !rest.is_empty() {
            parts.push(Part::Text(rest.to_string()));
        }
        Ok(Self { parts })
    }

    /// Renders record number `index` (0-based). `{{seq}}` derives from it, so a key
    /// and value rendered with the same index share the same sequence number.
    pub fn render<L: CityNameGenFn, R: RngExt + ?Sized>(&self, index: u64, locale: L, rng: &mut R) -> String {
        let mut out = String::new();
        for part in &self.parts {
            match part {
                Part::Text(text) => out.push_str(text),
                Part::Fake(generator) => out.push_str(&generator.value(index, locale, rng)),
            }
        }
        out
    }
}

fn parse_placeholder(inner: &str) -> Result<Gen> {
    let args = split_args(inner)?;
    let Some((name, args)) = args.split_first() else {
        return Err(Error::msg("Empty {{ }} in template"));
    };
    let bad = |usage: &str| Error::msg(format!("{{{{{}}}}}: expected {usage}", inner.trim()));
    let int = |i: usize, default: Option<i64>| -> Result<i64> {
        match args.get(i) {
            Some(a) => a.parse().map_err(|_| bad("whole numbers")),
            None => default.ok_or_else(|| bad("more arguments")),
        }
    };
    let float = |i: usize| -> Result<f64> {
        args.get(i).ok_or_else(|| bad("min and max"))?.parse().map_err(|_| bad("numbers"))
    };
    let days = |default: i64| -> Result<i64> {
        let n = int(0, Some(default))?;
        if n > 0 { Ok(n) } else { Err(bad("a positive number of days")) }
    };

    Ok(match name.as_str() {
        "seq" => Gen::Seq(int(0, Some(1))?),
        "uuid" => Gen::Uuid,
        "int" => {
            let (min, max) = (int(0, None)?, int(1, None)?);
            if min > max {
                return Err(bad("min <= max"));
            }
            Gen::Int(min, max)
        }
        "float" => {
            let (min, max) = (float(0)?, float(1)?);
            if min > max {
                return Err(bad("min <= max"));
            }
            Gen::Float(min, max, int(2, Some(2))?.clamp(0, 10) as usize)
        }
        "bool" => Gen::Bool(int(0, Some(50))?.clamp(0, 100) as u8),
        "pick" if args.is_empty() => return Err(bad("at least one value")),
        "pick" => Gen::Pick(args.to_vec()),
        "digits" => Gen::Digits(args.first().cloned().ok_or_else(|| bad("a format like \"###-####\""))?),
        "hex" => Gen::Hex(int(0, Some(16))?.clamp(1, 1024) as usize),
        "first_name" => Gen::FirstName,
        "last_name" => Gen::LastName,
        "name" => Gen::Name,
        "email" => Gen::Email,
        "username" => Gen::Username,
        "password" => Gen::Password,
        "phone" => Gen::Phone,
        "company" => Gen::Company,
        "industry" => Gen::Industry,
        "job_title" => Gen::JobTitle,
        "catch_phrase" => Gen::CatchPhrase,
        "street" => Gen::Street,
        "city" => Gen::City,
        "state" => Gen::State,
        "zip" => Gen::Zip,
        "country" => Gen::Country,
        "country_code" => Gen::CountryCode,
        "latitude" => Gen::Latitude,
        "longitude" => Gen::Longitude,
        "word" => Gen::Word,
        "words" => Gen::Words(int(0, Some(3))?.clamp(1, 100) as usize),
        "sentence" => Gen::Sentence,
        "paragraph" => Gen::Paragraph,
        "ipv4" => Gen::Ipv4,
        "ipv6" => Gen::Ipv6,
        "mac" => Gen::Mac,
        "user_agent" => Gen::UserAgent,
        "currency" => Gen::Currency,
        "now" => Gen::Now,
        "now_iso" => Gen::NowIso,
        "timestamp" => Gen::Timestamp(days(30)?),
        "datetime" => Gen::DateTime(days(30)?),
        "date" => Gen::Date(days(365)?),
        other => return Err(Error::msg(format!("Unknown placeholder {{{{{other}}}}}"))),
    })
}

/// Splits on whitespace, keeping "double quoted" arguments together.
fn split_args(inner: &str) -> Result<Vec<String>> {
    let mut args = Vec::new();
    let mut chars = inner.trim().chars().peekable();
    while let Some(&c) = chars.peek() {
        if c.is_whitespace() {
            chars.next();
        } else if c == '"' {
            chars.next();
            let quoted: String = chars.by_ref().take_while(|&c| c != '"').collect();
            args.push(quoted);
        } else {
            let mut word = String::new();
            while let Some(&c) = chars.peek().filter(|c| !c.is_whitespace()) {
                word.push(c);
                chars.next();
            }
            args.push(word);
        }
    }
    if inner.matches('"').count() % 2 == 1 {
        return Err(Error::msg(format!("Unclosed quote in {{{{{}}}}}", inner.trim())));
    }
    Ok(args)
}

impl Gen {
    fn value<L: CityNameGenFn, R: RngExt + ?Sized>(&self, index: u64, l: L, rng: &mut R) -> String {
        match self {
            Gen::Seq(start) => (start + index as i64).to_string(),
            Gen::Uuid => UUIDv4.fake_with_rng::<String, _>(rng),
            Gen::Int(min, max) => rng.random_range(*min..=*max).to_string(),
            Gen::Float(min, max, decimals) => {
                let n = if min == max { *min } else { rng.random_range(*min..*max) };
                format!("{n:.decimals$}")
            }
            Gen::Bool(percent) => rng.random_ratio(u32::from(*percent), 100).to_string(),
            Gen::Pick(values) => values[rng.random_range(0..values.len())].clone(),
            Gen::Digits(format) => format
                .chars()
                .map(|c| if c == '#' { char::from(b'0' + rng.random_range(0..10u8)) } else { c })
                .collect(),
            Gen::Hex(len) => (0..*len).map(|_| char::from_digit(rng.random_range(0..16), 16).unwrap()).collect(),
            Gen::FirstName => name::FirstName(l).fake_with_rng(rng),
            Gen::LastName => name::LastName(l).fake_with_rng(rng),
            Gen::Name => name::Name(l).fake_with_rng(rng),
            Gen::Email => internet::SafeEmail(l).fake_with_rng(rng),
            Gen::Username => internet::Username(l).fake_with_rng(rng),
            Gen::Password => internet::Password(l, 8..17).fake_with_rng(rng),
            Gen::Phone => phone::PhoneNumber(l).fake_with_rng(rng),
            Gen::Company => company::CompanyName(l).fake_with_rng(rng),
            Gen::Industry => company::Industry(l).fake_with_rng(rng),
            Gen::JobTitle => job::Title(l).fake_with_rng(rng),
            Gen::CatchPhrase => company::CatchPhrase(l).fake_with_rng(rng),
            Gen::Street => format!(
                "{} {} {}",
                address::BuildingNumber(l).fake_with_rng::<String, _>(rng),
                address::StreetName(l).fake_with_rng::<String, _>(rng),
                address::StreetSuffix(l).fake_with_rng::<String, _>(rng),
            ),
            Gen::City => address::CityName(l).fake_with_rng(rng),
            Gen::State => address::StateName(l).fake_with_rng(rng),
            Gen::Zip => address::ZipCode(l).fake_with_rng(rng),
            Gen::Country => address::CountryName(l).fake_with_rng(rng),
            Gen::CountryCode => address::CountryCode(l).fake_with_rng(rng),
            Gen::Latitude => address::Latitude(l).fake_with_rng(rng),
            Gen::Longitude => address::Longitude(l).fake_with_rng(rng),
            Gen::Word => lorem::Word(l).fake_with_rng(rng),
            Gen::Words(n) => lorem::Words(l, *n..*n + 1).fake_with_rng::<Vec<String>, _>(rng).join(" "),
            Gen::Sentence => lorem::Sentence(l, 4..10).fake_with_rng(rng),
            Gen::Paragraph => lorem::Paragraph(l, 3..6).fake_with_rng(rng),
            Gen::Ipv4 => internet::IPv4(l).fake_with_rng(rng),
            Gen::Ipv6 => internet::IPv6(l).fake_with_rng(rng),
            Gen::Mac => internet::MACAddress(l).fake_with_rng(rng),
            Gen::UserAgent => internet::UserAgent(l).fake_with_rng(rng),
            Gen::Currency => currency::CurrencyCode(l).fake_with_rng(rng),
            Gen::Now => Utc::now().timestamp_millis().to_string(),
            Gen::NowIso => Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            Gen::Timestamp(days) => random_past(*days, rng).timestamp_millis().to_string(),
            Gen::DateTime(days) => random_past(*days, rng).to_rfc3339_opts(SecondsFormat::Millis, true),
            Gen::Date(days) => random_past(*days, rng).format("%Y-%m-%d").to_string(),
        }
    }
}

fn random_past<R: RngExt + ?Sized>(days: i64, rng: &mut R) -> DateTime<Utc> {
    Utc::now() - Duration::milliseconds(rng.random_range(0..days * 86_400_000))
}

#[cfg(test)]
mod tests {
    use fake::locales::EN;
    use fake::rand::SeedableRng;
    use fake::rand::rngs::StdRng;

    use super::*;

    fn render(source: &str, index: u64) -> String {
        Template::parse(source).unwrap().render(index, EN, &mut StdRng::seed_from_u64(7))
    }

    #[test]
    fn plain_text_passes_through() {
        assert_eq!(render("no placeholders", 0), "no placeholders");
    }

    #[test]
    fn seq_follows_the_record_index() {
        assert_eq!(render("{{seq}}", 0), "1");
        assert_eq!(render("id-{{seq 100}}", 5), "id-105");
    }

    #[test]
    fn numbers_stay_in_range() {
        let mut rng = StdRng::seed_from_u64(1);
        let int = Template::parse("{{int -3 3}}").unwrap();
        let float = Template::parse("{{ float 1 2 3 }}").unwrap();
        for i in 0..200 {
            let n: i64 = int.render(i, EN, &mut rng).parse().unwrap();
            assert!((-3..=3).contains(&n));
            let f = float.render(i, EN, &mut rng);
            assert_eq!(f.split('.').nth(1).unwrap().len(), 3);
            assert!((1.0..2.0).contains(&f.parse::<f64>().unwrap()));
        }
    }

    #[test]
    fn pick_keeps_quoted_values_together() {
        let picked = render(r#"{{pick "in transit" "in transit"}}"#, 0);
        assert_eq!(picked, "in transit");
    }

    #[test]
    fn digits_and_hex_have_the_requested_shape() {
        let phone = render(r####"{{digits "###-##"}}"####, 0);
        assert!(phone.len() == 6 && phone.chars().nth(3) == Some('-'));
        assert_eq!(render("{{hex 8}}", 0).len(), 8);
    }

    #[test]
    fn json_template_renders_valid_json() {
        let source = r#"{"id": {{seq}}, "user": "{{name}}", "email": "{{email}}", "ok": {{bool}}, "at": "{{datetime}}", "day": "{{date}}"}"#;
        let value: serde_json::Value = serde_json::from_str(&render(source, 41)).unwrap();
        assert_eq!(value["id"], 42);
        assert!(value["email"].as_str().unwrap().contains('@'));
        assert_eq!(value["day"].as_str().unwrap().len(), 10);
    }

    #[test]
    fn mistakes_are_reported_at_parse_time() {
        for bad in [
            "{{nope}}",
            "{{int 5}}",
            "{{int 9 1}}",
            "{{pick}}",
            "{{seq x}}",
            "{{date 0}}",
            "{{ }}",
            "{{name",
            r#"{{pick "a}}"#,
        ] {
            assert!(Template::parse(bad).is_err(), "{bad} should fail");
        }
    }

    #[test]
    fn every_documented_example_parses() {
        for (name, example, _) in GENERATORS {
            for snippet in example.split(" / ") {
                Template::parse(snippet).unwrap_or_else(|e| panic!("{name}: {snippet}: {e}"));
            }
        }
    }
}
