use super::model::{Acl, Operation, PatternType, Permission, ResourceType};
use crate::error::{Error, Result};
use kui_kafka::KafkaClients;
use kui_kafka::acls;

/// The only name a cluster resource can have.
const CLUSTER_NAME: &str = "kafka-cluster";

/// Every ACL, grouped by resource and then principal.
pub fn list(clients: &KafkaClients) -> Result<Vec<Acl>> {
    let mut acls = acls::list(&clients.admin)?;
    acls.sort_by(|a, b| {
        (&a.resource_name, &a.principal, &a.host, a.operation as u8).cmp(&(
            &b.resource_name,
            &b.principal,
            &b.host,
            b.operation as u8,
        ))
    });
    Ok(acls)
}

pub fn create(clients: &KafkaClients, acl: Acl) -> Result<()> {
    Ok(acls::create(&clients.admin, &normalize(acl)?)?)
}

/// Deletes exactly the ACL given, as `list` returned it.
pub fn delete(clients: &KafkaClients, acl: &Acl) -> Result<()> {
    match acls::delete(&clients.admin, acl)? {
        0 => Err(Error::msg("Kafka found no matching ACL. It may have been deleted already.")),
        _ => Ok(()),
    }
}

/// Trims the form input, fills in defaults and rejects what Kafka would.
fn normalize(mut acl: Acl) -> Result<Acl> {
    acl.principal = acl.principal.trim().to_string();
    match acl.principal.split_once(':') {
        Some((kind, name)) if !kind.trim().is_empty() && !name.trim().is_empty() => {}
        _ => return Err(Error::msg("The principal must look like User:alice (or User:* for everyone).")),
    }
    acl.host = match acl.host.trim() {
        "" => "*".to_string(),
        host => host.to_string(),
    };
    if acl.resource_type == ResourceType::Cluster {
        acl.resource_name = CLUSTER_NAME.to_string();
        acl.pattern_type = PatternType::Literal;
    }
    acl.resource_name = acl.resource_name.trim().to_string();
    if acl.resource_name.is_empty() {
        return Err(Error::msg("Enter a resource name, or * for all of them."));
    }
    if acl.resource_type == ResourceType::Unknown
        || acl.pattern_type == PatternType::Unknown
        || acl.operation == Operation::Unknown
        || acl.permission == Permission::Unknown
    {
        return Err(Error::msg("Pick a resource type, pattern, operation and permission."));
    }
    Ok(acl)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn acl() -> Acl {
        Acl {
            principal: " User:alice ".into(),
            host: " ".into(),
            resource_type: ResourceType::Topic,
            resource_name: " orders ".into(),
            pattern_type: PatternType::Literal,
            operation: Operation::Read,
            permission: Permission::Allow,
        }
    }

    #[test]
    fn trims_input_and_defaults_the_host_to_any() {
        let acl = normalize(acl()).unwrap();
        assert_eq!((acl.principal.as_str(), acl.host.as_str()), ("User:alice", "*"));
        assert_eq!(acl.resource_name, "orders");
    }

    #[test]
    fn rejects_a_principal_without_a_type() {
        for principal in ["alice", "User:", ":alice"] {
            let error = normalize(Acl { principal: principal.into(), ..acl() }).unwrap_err();
            assert!(error.to_string().contains("User:alice"), "{principal}");
        }
    }

    #[test]
    fn cluster_acls_always_name_the_cluster() {
        let acl = normalize(Acl {
            resource_type: ResourceType::Cluster,
            resource_name: String::new(),
            pattern_type: PatternType::Prefixed,
            ..acl()
        })
        .unwrap();
        assert_eq!((acl.resource_name.as_str(), acl.pattern_type), (CLUSTER_NAME, PatternType::Literal));
    }

    #[test]
    fn rejects_a_blank_resource_name() {
        assert!(normalize(Acl { resource_name: "  ".into(), ..acl() }).is_err());
    }

    #[test]
    fn rejects_unknown_values() {
        assert!(normalize(Acl { operation: Operation::Unknown, ..acl() }).is_err());
    }
}
