//! Access control lists through librdkafka's admin API (DescribeAcls,
//! CreateAcls and DeleteAcls), which rust-rdkafka doesn't wrap.
//!
//! Brokers only answer these when an authorizer is configured; otherwise
//! every call fails with a message saying ACLs are off.

use std::ffi::{CString, c_char};
use std::ptr;

use rdkafka::bindings as rd;
use serde::{Deserialize, Serialize};

use crate::admin::{Admin, cstr, error_message, request, slice};
use crate::{Error, Result};

/// A Kafka enum and its librdkafka counterpart. Values librdkafka reports
/// that KUI doesn't know (from a newer broker) read as `Unknown`.
macro_rules! rd_enum {
    ($(#[$doc:meta])* $name:ident => $rd:ident { $($variant:ident = $rd_variant:ident),+ $(,)? }) => {
        $(#[$doc])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
        pub enum $name {
            $($variant),+
        }

        impl $name {
            fn to_rd(self) -> rd::$rd {
                match self {
                    $(Self::$variant => rd::$rd::$rd_variant),+
                }
            }

            fn from_rd(value: rd::$rd) -> Self {
                match value {
                    $(rd::$rd::$rd_variant => Self::$variant,)+
                    #[allow(unreachable_patterns)]
                    _ => Self::Unknown,
                }
            }
        }
    };
}

rd_enum! {
    /// What kind of resource an ACL protects. `Cluster` is the cluster itself
    /// (always named `kafka-cluster`); librdkafka calls it BROKER.
    ResourceType => rd_kafka_ResourceType_t {
        Topic = RD_KAFKA_RESOURCE_TOPIC,
        Group = RD_KAFKA_RESOURCE_GROUP,
        Cluster = RD_KAFKA_RESOURCE_BROKER,
        TransactionalId = RD_KAFKA_RESOURCE_TRANSACTIONAL_ID,
        Unknown = RD_KAFKA_RESOURCE_UNKNOWN,
    }
}

rd_enum! {
    /// How the resource name matches: exactly, or as a prefix of names.
    PatternType => rd_kafka_ResourcePatternType_t {
        Literal = RD_KAFKA_RESOURCE_PATTERN_LITERAL,
        Prefixed = RD_KAFKA_RESOURCE_PATTERN_PREFIXED,
        Unknown = RD_KAFKA_RESOURCE_PATTERN_UNKNOWN,
    }
}

rd_enum! {
    Operation => rd_kafka_AclOperation_t {
        All = RD_KAFKA_ACL_OPERATION_ALL,
        Read = RD_KAFKA_ACL_OPERATION_READ,
        Write = RD_KAFKA_ACL_OPERATION_WRITE,
        Create = RD_KAFKA_ACL_OPERATION_CREATE,
        Delete = RD_KAFKA_ACL_OPERATION_DELETE,
        Alter = RD_KAFKA_ACL_OPERATION_ALTER,
        Describe = RD_KAFKA_ACL_OPERATION_DESCRIBE,
        ClusterAction = RD_KAFKA_ACL_OPERATION_CLUSTER_ACTION,
        DescribeConfigs = RD_KAFKA_ACL_OPERATION_DESCRIBE_CONFIGS,
        AlterConfigs = RD_KAFKA_ACL_OPERATION_ALTER_CONFIGS,
        IdempotentWrite = RD_KAFKA_ACL_OPERATION_IDEMPOTENT_WRITE,
        Unknown = RD_KAFKA_ACL_OPERATION_UNKNOWN,
    }
}

rd_enum! {
    Permission => rd_kafka_AclPermissionType_t {
        Allow = RD_KAFKA_ACL_PERMISSION_TYPE_ALLOW,
        Deny = RD_KAFKA_ACL_PERMISSION_TYPE_DENY,
        Unknown = RD_KAFKA_ACL_PERMISSION_TYPE_UNKNOWN,
    }
}

/// One ACL: `principal` from `host` is allowed or denied `operation` on a resource.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Acl {
    /// e.g. `User:alice`.
    pub principal: String,
    /// The client's IP address, or `*` for any host.
    pub host: String,
    pub resource_type: ResourceType,
    pub resource_name: String,
    pub pattern_type: PatternType,
    pub operation: Operation,
    pub permission: Permission,
}

/// Every ACL on the cluster.
pub fn list(admin: &Admin) -> Result<Vec<Acl>> {
    // SAFETY: see `admin::request`. The filter is copied when the request is
    // sent; the bindings read live as long as the event.
    unsafe {
        let mut errstr = [0 as c_char; 512];
        let filter = rd::rd_kafka_AclBindingFilter_new(
            rd::rd_kafka_ResourceType_t::RD_KAFKA_RESOURCE_ANY,
            ptr::null(),
            rd::rd_kafka_ResourcePatternType_t::RD_KAFKA_RESOURCE_PATTERN_ANY,
            ptr::null(),
            ptr::null(),
            rd::rd_kafka_AclOperation_t::RD_KAFKA_ACL_OPERATION_ANY,
            rd::rd_kafka_AclPermissionType_t::RD_KAFKA_ACL_PERMISSION_TYPE_ANY,
            errstr.as_mut_ptr(),
            errstr.len(),
        );
        if filter.is_null() {
            return Err(Error::msg(cstr(errstr.as_ptr())));
        }
        let result = request(
            admin,
            rd::rd_kafka_admin_op_t::RD_KAFKA_ADMIN_OP_DESCRIBEACLS,
            |rk, options, queue| rd::rd_kafka_DescribeAcls(rk, filter, options, queue),
            |event| {
                let result = rd::rd_kafka_event_DescribeAcls_result(event);
                let mut count = 0;
                let acls = rd::rd_kafka_DescribeAcls_result_acls(result, &mut count);
                Ok(slice(acls, count).iter().map(|&a| read(a)).collect())
            },
        );
        rd::rd_kafka_AclBinding_destroy(filter);
        result
    }
}

/// Adds `acl`. Adding one that already exists succeeds and changes nothing.
pub fn create(admin: &Admin, acl: &Acl) -> Result<()> {
    // SAFETY: see `admin::request`. The binding is copied when the request is sent.
    unsafe {
        let binding = binding(acl, rd::rd_kafka_AclBinding_new)?;
        let mut bindings = [binding];
        let result = request(
            admin,
            rd::rd_kafka_admin_op_t::RD_KAFKA_ADMIN_OP_CREATEACLS,
            |rk, options, queue| rd::rd_kafka_CreateAcls(rk, bindings.as_mut_ptr(), 1, options, queue),
            |event| {
                let result = rd::rd_kafka_event_CreateAcls_result(event);
                let mut count = 0;
                let results = rd::rd_kafka_CreateAcls_result_acls(result, &mut count);
                match slice(results, count).first().map(|&r| rd::rd_kafka_acl_result_error(r)) {
                    Some(error) if !error.is_null() => Err(Error::msg(error_message(error))),
                    _ => Ok(()),
                }
            },
        );
        rd::rd_kafka_AclBinding_destroy(binding);
        result
    }
}

/// Removes exactly `acl` (every field must match) and returns how many ACLs
/// Kafka removed: 1, or 0 if it was already gone.
pub fn delete(admin: &Admin, acl: &Acl) -> Result<usize> {
    // SAFETY: see `admin::request`. The filter is copied when the request is sent.
    unsafe {
        let filter = binding(acl, rd::rd_kafka_AclBindingFilter_new)?;
        let mut filters = [filter];
        let result = request(
            admin,
            rd::rd_kafka_admin_op_t::RD_KAFKA_ADMIN_OP_DELETEACLS,
            |rk, options, queue| rd::rd_kafka_DeleteAcls(rk, filters.as_mut_ptr(), 1, options, queue),
            |event| {
                let result = rd::rd_kafka_event_DeleteAcls_result(event);
                let mut count = 0;
                let responses = rd::rd_kafka_DeleteAcls_result_responses(result, &mut count);
                let Some(&response) = slice(responses, count).first() else {
                    return Ok(0);
                };
                let error = rd::rd_kafka_DeleteAcls_result_response_error(response);
                if !error.is_null() {
                    return Err(Error::msg(error_message(error)));
                }
                let mut matched = 0;
                rd::rd_kafka_DeleteAcls_result_response_matching_acls(response, &mut matched);
                Ok(matched)
            },
        );
        rd::rd_kafka_AclBinding_destroy(filter);
        result
    }
}

/// The signature shared by `rd_kafka_AclBinding_new` and `rd_kafka_AclBindingFilter_new`.
type NewBinding = unsafe extern "C" fn(
    rd::rd_kafka_ResourceType_t,
    *const c_char,
    rd::rd_kafka_ResourcePatternType_t,
    *const c_char,
    *const c_char,
    rd::rd_kafka_AclOperation_t,
    rd::rd_kafka_AclPermissionType_t,
    *mut c_char,
    usize,
) -> *mut rd::rd_kafka_AclBinding_t;

/// `acl` as a librdkafka binding (or exact-match filter). The caller destroys it.
unsafe fn binding(acl: &Acl, new: NewBinding) -> Result<*mut rd::rd_kafka_AclBinding_t> {
    let name = c_string(&acl.resource_name)?;
    let principal = c_string(&acl.principal)?;
    let host = c_string(&acl.host)?;
    let mut errstr = [0 as c_char; 512];
    // SAFETY: librdkafka copies the strings.
    let binding = unsafe {
        new(
            acl.resource_type.to_rd(),
            name.as_ptr(),
            acl.pattern_type.to_rd(),
            principal.as_ptr(),
            host.as_ptr(),
            acl.operation.to_rd(),
            acl.permission.to_rd(),
            errstr.as_mut_ptr(),
            errstr.len(),
        )
    };
    if binding.is_null() {
        // SAFETY: librdkafka wrote a NUL-terminated message into `errstr`.
        return Err(Error::msg(unsafe { cstr(errstr.as_ptr()) }));
    }
    Ok(binding)
}

unsafe fn read(acl: *const rd::rd_kafka_AclBinding_t) -> Acl {
    unsafe {
        Acl {
            principal: cstr(rd::rd_kafka_AclBinding_principal(acl)),
            host: cstr(rd::rd_kafka_AclBinding_host(acl)),
            resource_type: ResourceType::from_rd(rd::rd_kafka_AclBinding_restype(acl)),
            resource_name: cstr(rd::rd_kafka_AclBinding_name(acl)),
            pattern_type: PatternType::from_rd(rd::rd_kafka_AclBinding_resource_pattern_type(acl)),
            operation: Operation::from_rd(rd::rd_kafka_AclBinding_operation(acl)),
            permission: Permission::from_rd(rd::rd_kafka_AclBinding_permission_type(acl)),
        }
    }
}

fn c_string(s: &str) -> Result<CString> {
    CString::new(s).map_err(|_| Error::msg(format!("Invalid character in {s:?}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enums_round_trip_through_librdkafka_values() {
        for op in [Operation::All, Operation::Read, Operation::IdempotentWrite, Operation::Unknown] {
            assert_eq!(Operation::from_rd(op.to_rd()), op);
        }
        assert_eq!(ResourceType::from_rd(ResourceType::Cluster.to_rd()), ResourceType::Cluster);
        assert_eq!(PatternType::from_rd(PatternType::Prefixed.to_rd()), PatternType::Prefixed);
        assert_eq!(Permission::from_rd(Permission::Deny.to_rd()), Permission::Deny);
    }

    #[test]
    fn filter_only_values_read_as_unknown() {
        // ANY and MATCH only appear in filters, never on a stored ACL.
        assert_eq!(Operation::from_rd(rd::rd_kafka_AclOperation_t::RD_KAFKA_ACL_OPERATION_ANY), Operation::Unknown);
        assert_eq!(
            PatternType::from_rd(rd::rd_kafka_ResourcePatternType_t::RD_KAFKA_RESOURCE_PATTERN_MATCH),
            PatternType::Unknown
        );
    }

    #[test]
    fn serializes_for_the_ui() {
        let acl = Acl {
            principal: "User:alice".into(),
            host: "*".into(),
            resource_type: ResourceType::TransactionalId,
            resource_name: "tx-".into(),
            pattern_type: PatternType::Prefixed,
            operation: Operation::DescribeConfigs,
            permission: Permission::Allow,
        };
        let json = serde_json::to_value(&acl).unwrap();
        assert_eq!(json["resourceType"], "TransactionalId");
        assert_eq!(json["operation"], "DescribeConfigs");
        assert_eq!(serde_json::from_value::<Acl>(json).unwrap(), acl);
    }
}
