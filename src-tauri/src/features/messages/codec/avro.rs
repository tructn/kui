//! Avro, which can only be read with the schema it was written with.

use std::collections::HashSet;

use apache_avro::Schema;
use apache_avro::reader::datum::GenericDatumReader;
use apache_avro::types::Value;
use apache_avro::writer::datum::GenericDatumWriter;

use crate::kafka::schema_registry::{Schema as Registered, SchemaSource};

/// A writer schema plus the named types it references.
pub struct AvroSchema {
    schema: Schema,
    references: Vec<Schema>,
}

pub fn parse(source: &dyn SchemaSource, registered: &Registered) -> Result<AvroSchema, String> {
    let mut references = Vec::new();
    collect_references(source, registered, &mut HashSet::new(), &mut references)?;
    let (schema, references) = Schema::parse_str_with_list(&registered.schema, &references)
        .map_err(|e| format!("Invalid Avro schema: {e}"))?;
    Ok(AvroSchema { schema, references })
}

/// Referenced schema sources, dependencies before the schemas that use them.
fn collect_references(
    source: &dyn SchemaSource,
    schema: &Registered,
    seen: &mut HashSet<(String, i32)>,
    out: &mut Vec<String>,
) -> Result<(), String> {
    for r in &schema.references {
        if !seen.insert((r.subject.clone(), r.version)) {
            continue;
        }
        let referenced = source.by_subject(&r.subject, r.version).map_err(|e| e.to_string())?;
        collect_references(source, &referenced, seen, out)?;
        out.push(referenced.schema.clone());
    }
    Ok(())
}

/// One Avro datum (no container-file header) as compact JSON.
pub fn decode(schema: &AvroSchema, body: &[u8]) -> Result<String, String> {
    // Referenced types first: names are resolved in order.
    let schemata = schema.references.iter().chain(std::iter::once(&schema.schema)).collect();
    let reader = GenericDatumReader::builder(&schema.schema)
        .writer_schemata(schemata)
        .and_then(|b| b.build())
        .map_err(|e| e.to_string())?;
    let value = reader.read_value(&mut &body[..]).map_err(|e| format!("Not valid for its Avro schema: {e}"))?;
    let json = serde_json::Value::try_from(value).map_err(|e| e.to_string())?;
    Ok(json.to_string())
}

/// Encodes plain JSON as one Avro datum: records are objects, and a union takes
/// whichever branch the value fits (`"rush"`, not Avro's `{"string": "rush"}`).
pub fn encode(schema: &AvroSchema, json: serde_json::Value) -> Result<Vec<u8>, String> {
    let schemata: Vec<&Schema> = schema.references.iter().chain(std::iter::once(&schema.schema)).collect();
    let value = Value::try_from(json)
        .and_then(|v| v.resolve_schemata(&schema.schema, schemata.clone()))
        .map_err(|e| format!("Doesn't match the Avro schema: {e}"))?;
    GenericDatumWriter::builder(&schema.schema)
        .schemata(schemata)
        .and_then(|b| b.build())
        .and_then(|w| w.write_value_to_vec(value))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use super::*;
    use crate::error::{Error, Result};
    use crate::kafka::schema_registry::SchemaType;

    /// Subject → schema source.
    struct Subjects(HashMap<&'static str, &'static str>);

    impl SchemaSource for Subjects {
        fn by_id(&self, _: u32) -> Result<Arc<Registered>> {
            Err(Error::msg("unused"))
        }
        fn by_subject(&self, subject: &str, _: i32) -> Result<Arc<Registered>> {
            let schema = self.0.get(subject).ok_or_else(|| Error::msg("missing"))?.to_string();
            Ok(Arc::new(Registered { schema_type: SchemaType::Avro, schema, references: vec![], ..Default::default() }))
        }
    }

    const ADDRESS: &str =
        r#"{"type":"record","name":"Address","namespace":"acme","fields":[{"name":"city","type":"string"}]}"#;

    #[test]
    fn decodes_a_record_with_a_referenced_type() {
        let registered: Registered = serde_json::from_value(serde_json::json!({
            "schema": r#"{"type":"record","name":"Order","namespace":"acme","fields":[
                {"name":"id","type":"long"},{"name":"note","type":["null","string"]},{"name":"ship","type":"acme.Address"}]}"#,
            "references": [{"name": "acme.Address", "subject": "address", "version": 1}],
        }))
        .unwrap();
        let schema = parse(&Subjects(HashMap::from([("address", ADDRESS)])), &registered).unwrap();

        let address = Value::Record(vec![("city".into(), Value::String("Hanoi".into()))]);
        let order = Value::Record(vec![
            ("id".into(), Value::Long(7)),
            ("note".into(), Value::Union(1, Box::new(Value::String("rush".into())))),
            ("ship".into(), address),
        ]);
        let bytes = GenericDatumWriter::builder(&schema.schema)
            .schemata(schema.references.iter().chain(std::iter::once(&schema.schema)).collect())
            .unwrap()
            .build()
            .unwrap()
            .write_value_to_vec(order)
            .unwrap();

        assert_eq!(decode(&schema, &bytes).unwrap(), r#"{"id":7,"note":"rush","ship":{"city":"Hanoi"}}"#);
    }

    #[test]
    fn bytes_that_dont_fit_the_schema_are_an_error() {
        let registered = Registered {
            schema_type: SchemaType::Avro,
            schema: r#""string""#.into(),
            references: vec![],
            ..Default::default()
        };
        let schema = parse(&Subjects(HashMap::new()), &registered).unwrap();
        let ok = GenericDatumWriter::builder(&schema.schema).build().unwrap().write_value_to_vec("hi").unwrap();
        assert_eq!(decode(&schema, &ok).unwrap(), r#""hi""#);
        assert!(decode(&schema, &[0x09]).is_err());
    }

    #[test]
    fn encodes_plain_json_and_reads_it_back() {
        let registered = Registered {
            schema: r#"{"type":"record","name":"Order","fields":[
                {"name":"id","type":"long"},
                {"name":"note","type":["null","string"],"default":null},
                {"name":"status","type":{"type":"enum","name":"Status","symbols":["NEW","PAID"]}}]}"#
                .into(),
            ..Default::default()
        };
        let schema = parse(&Subjects(HashMap::new()), &registered).unwrap();
        let json = serde_json::json!({"id": 3, "note": "rush", "status": "PAID"});
        let bytes = encode(&schema, json).unwrap();
        assert_eq!(decode(&schema, &bytes).unwrap(), r#"{"id":3,"note":"rush","status":"PAID"}"#);

        let defaulted = encode(&schema, serde_json::json!({"id": 4, "status": "NEW"})).unwrap();
        assert_eq!(decode(&schema, &defaulted).unwrap(), r#"{"id":4,"note":null,"status":"NEW"}"#);

        let wrong = encode(&schema, serde_json::json!({"id": "x", "status": "NEW"})).unwrap_err();
        assert!(wrong.contains("Doesn't match"), "{wrong}");
    }
}
