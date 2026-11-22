//! Kafka ACLs as plain data, and the checks a new ACL must pass before it is
//! sent. The librdkafka calls that read and change them are in `acl_admin`.

use serde::{Deserialize, Serialize};

use crate::{Error, Result};

/// The name a cluster resource always has; Kafka rejects any other.
pub const CLUSTER_RESOURCE_NAME: &str = "kafka-cluster";

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "camelCase")]
pub enum ResourceType {
    Topic,
    Group,
    Cluster,
    TransactionalId,
}

/// How `resource_name` matches resources.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "camelCase")]
pub enum PatternType {
    /// Exactly this name, or every resource when the name is `*`.
    Literal,
    /// Every resource whose name starts with it.
    Prefixed,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "camelCase")]
pub enum Operation {
    All,
    Read,
    Write,
    Create,
    Delete,
    Alter,
    Describe,
    ClusterAction,
    DescribeConfigs,
    AlterConfigs,
    IdempotentWrite,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "camelCase")]
pub enum Permission {
    Allow,
    Deny,
}

/// One ACL: `principal` from `host` is allowed or denied `operation` on the resource.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "camelCase")]
pub struct AclBinding {
    pub resource_type: ResourceType,
    pub resource_name: String,
    pub pattern_type: PatternType,
    /// e.g. `User:alice`, or `User:*` for everyone.
    pub principal: String,
    /// An IP address, or `*` for any host.
    pub host: String,
    pub operation: Operation,
    pub permission: Permission,
}

impl ResourceType {
    /// The operations Kafka checks on this kind of resource. An ACL for any other
    /// is accepted by the broker but never grants or denies anything.
    pub fn operations(self) -> &'static [Operation] {
        use Operation::*;
        match self {
            ResourceType::Topic => &[All, Read, Write, Create, Delete, Alter, Describe, DescribeConfigs, AlterConfigs],
            ResourceType::Group => &[All, Read, Delete, Describe],
            ResourceType::Cluster => {
                &[All, Create, Alter, Describe, ClusterAction, DescribeConfigs, AlterConfigs, IdempotentWrite]
            }
            ResourceType::TransactionalId => &[All, Write, Describe],
        }
    }
}

/// Rejects an ACL that Kafka would refuse or that could never take effect.
/// Values are quoted in the messages: none of these fields are secrets.
pub fn validate(acl: &AclBinding) -> Result<()> {
    let name = acl.resource_name.as_str();
    if name.trim().is_empty() {
        return Err(Error::msg("Resource name is required"));
    }
    if name != name.trim() {
        return Err(Error::msg(format!("Resource name \"{name}\" has leading or trailing spaces")));
    }
    if acl.resource_type == ResourceType::Cluster
        && (name != CLUSTER_RESOURCE_NAME || acl.pattern_type != PatternType::Literal)
    {
        return Err(Error::msg(format!("A cluster ACL must use the literal name \"{CLUSTER_RESOURCE_NAME}\"")));
    }
    if acl.pattern_type == PatternType::Prefixed && name == "*" {
        return Err(Error::msg("\"*\" already matches every resource: use a literal pattern"));
    }
    let principal = acl.principal.as_str();
    let well_formed = principal.trim() == principal
        && principal.split_once(':').is_some_and(|(kind, who)| !kind.trim().is_empty() && !who.trim().is_empty());
    if !well_formed {
        return Err(Error::msg(format!(
            "Principal \"{principal}\" must look like Type:name, e.g. User:alice or User:*"
        )));
    }
    if acl.host.trim().is_empty() || acl.host.trim() != acl.host {
        return Err(Error::msg("Host must be an IP address, or * for any host"));
    }
    if !acl.resource_type.operations().contains(&acl.operation) {
        return Err(Error::msg(format!(
            "{:?} does not apply to a {:?} resource, so this ACL would have no effect",
            acl.operation, acl.resource_type
        )));
    }
    let fields = [name, acl.principal.as_str(), acl.host.as_str()];
    if fields.iter().any(|f| f.contains('\0')) {
        return Err(Error::msg("ACL fields cannot contain NUL characters"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn acl() -> AclBinding {
        AclBinding {
            resource_type: ResourceType::Topic,
            resource_name: "orders".into(),
            pattern_type: PatternType::Literal,
            principal: "User:alice".into(),
            host: "*".into(),
            operation: Operation::Read,
            permission: Permission::Allow,
        }
    }

    fn rejects(change: impl FnOnce(&mut AclBinding)) -> bool {
        let mut a = acl();
        change(&mut a);
        validate(&a).is_err()
    }

    #[test]
    fn accepts_ordinary_acls() {
        assert!(validate(&acl()).is_ok());
        let mut wildcard = acl();
        wildcard.resource_name = "*".into();
        wildcard.principal = "User:*".into();
        assert!(validate(&wildcard).is_ok());
        let mut cluster = acl();
        cluster.resource_type = ResourceType::Cluster;
        cluster.resource_name = CLUSTER_RESOURCE_NAME.into();
        cluster.operation = Operation::IdempotentWrite;
        assert!(validate(&cluster).is_ok());
    }

    #[test]
    fn rejects_malformed_principals() {
        for principal in ["alice", "User:", ":alice", "", " User:alice"] {
            assert!(rejects(|a| a.principal = principal.into()), "principal {principal:?}");
        }
    }

    #[test]
    fn rejects_blank_or_padded_names_and_hosts() {
        assert!(rejects(|a| a.resource_name = " ".into()));
        assert!(rejects(|a| a.resource_name = "orders ".into()));
        assert!(rejects(|a| a.host = String::new()));
        assert!(rejects(|a| a.host = " *".into()));
    }

    #[test]
    fn cluster_acls_need_the_fixed_literal_name() {
        let cluster = |a: &mut AclBinding| {
            a.resource_type = ResourceType::Cluster;
            a.operation = Operation::Describe;
        };
        assert!(rejects(|a| {
            cluster(a);
            a.resource_name = "prod".into();
        }));
        assert!(rejects(|a| {
            cluster(a);
            a.resource_name = CLUSTER_RESOURCE_NAME.into();
            a.pattern_type = PatternType::Prefixed;
        }));
    }

    #[test]
    fn rejects_a_prefixed_wildcard() {
        assert!(rejects(|a| {
            a.resource_name = "*".into();
            a.pattern_type = PatternType::Prefixed;
        }));
    }

    #[test]
    fn rejects_operations_that_never_apply_to_the_resource() {
        assert!(rejects(|a| a.operation = Operation::IdempotentWrite));
        assert!(rejects(|a| {
            a.resource_type = ResourceType::Group;
            a.operation = Operation::Write;
        }));
    }

    #[test]
    fn rejects_nul_characters() {
        assert!(rejects(|a| a.resource_name = "or\0ders".into()));
        assert!(rejects(|a| a.principal = "User:al\0ice".into()));
    }

    #[test]
    fn every_resource_allows_all() {
        for r in [ResourceType::Topic, ResourceType::Group, ResourceType::Cluster, ResourceType::TransactionalId] {
            assert!(r.operations().contains(&Operation::All), "{r:?}");
        }
    }

    #[test]
    fn serializes_as_camel_case_for_the_ui() {
        let json = serde_json::to_value(AclBinding {
            resource_type: ResourceType::TransactionalId,
            operation: Operation::IdempotentWrite,
            ..acl()
        })
        .unwrap();
        assert_eq!(json["resourceType"], "transactionalId");
        assert_eq!(json["operation"], "idempotentWrite");
        assert_eq!(json["patternType"], "literal");
        assert_eq!(json["permission"], "allow");
    }
}
