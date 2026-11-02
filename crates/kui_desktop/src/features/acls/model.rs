// The ACL types are shared with the Kafka layer, which already serializes
// them the way the UI expects (camelCase fields, PascalCase enum values).
pub use kui_kafka::acls::{Acl, Operation, PatternType, Permission, ResourceType};
