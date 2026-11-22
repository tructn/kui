//! ACLs through librdkafka's admin API (DescribeAcls, CreateAcls and
//! DeleteAcls), which rust-rdkafka doesn't wrap.

use std::ffi::{CString, c_char};
use std::ptr;

use rd::rd_kafka_AclOperation_t as RdOperation;
use rd::rd_kafka_AclPermissionType_t as RdPermission;
use rd::rd_kafka_ResourcePatternType_t as RdPattern;
use rd::rd_kafka_ResourceType_t as RdResource;
use rdkafka::bindings as rd;

use super::acls::{AclBinding, Operation, PatternType, Permission, ResourceType};
use super::admin_request::{Admin, request, response_error, slice};
use super::group_offsets::cstr;
use crate::{Error, Result};

/// Every ACL on the cluster, in no particular order. An ACL with a value this
/// version doesn't know is left out rather than shown as something it isn't.
pub fn describe(admin: &Admin) -> Result<Vec<AclBinding>> {
    let filter = Bindings::any_filter()?;
    // SAFETY: see `request`. `filter` outlives the call, which copies it.
    unsafe {
        request(
            admin,
            rd::rd_kafka_admin_op_t::RD_KAFKA_ADMIN_OP_DESCRIBEACLS,
            |rk, options, queue| rd::rd_kafka_DescribeAcls(rk, filter.0[0], options, queue),
            |event| {
                let result = rd::rd_kafka_event_DescribeAcls_result(event);
                let mut count = 0;
                let acls = rd::rd_kafka_DescribeAcls_result_acls(result, &mut count);
                Ok(slice(acls, count).iter().filter_map(|&a| binding(a)).collect())
            },
        )
    }
}

/// Creates `acls` in one request. Fails if Kafka refused any of them; the others may still have been created.
pub fn create(admin: &Admin, acls: &[AclBinding]) -> Result<()> {
    if acls.is_empty() {
        return Ok(());
    }
    let mut bindings = Bindings::new(acls, Kind::Binding)?;
    // SAFETY: see `request`. `bindings` outlives the call, which copies them.
    unsafe {
        request(
            admin,
            rd::rd_kafka_admin_op_t::RD_KAFKA_ADMIN_OP_CREATEACLS,
            |rk, options, queue| rd::rd_kafka_CreateAcls(rk, bindings.0.as_mut_ptr(), bindings.0.len(), options, queue),
            |event| {
                let result = rd::rd_kafka_event_CreateAcls_result(event);
                let mut count = 0;
                let results = rd::rd_kafka_CreateAcls_result_acls(result, &mut count);
                let errors = slice(results, count).iter().filter_map(|&r| error(rd::rd_kafka_acl_result_error(r)));
                refused(errors.collect(), acls.len(), "created")
            },
        )
    }
}

/// Deletes exactly `acls` in one request and returns how many ACLs Kafka removed.
///
/// Each filter repeats every field of its ACL, never a wildcard (`ANY`/`MATCH`),
/// so it can't also remove other ACLs that happen to match.
pub fn delete(admin: &Admin, acls: &[AclBinding]) -> Result<usize> {
    if acls.is_empty() {
        return Ok(0);
    }
    let mut filters = Bindings::new(acls, Kind::Filter)?;
    // SAFETY: see `request`. `filters` outlives the call, which copies them.
    unsafe {
        request(
            admin,
            rd::rd_kafka_admin_op_t::RD_KAFKA_ADMIN_OP_DELETEACLS,
            |rk, options, queue| rd::rd_kafka_DeleteAcls(rk, filters.0.as_mut_ptr(), filters.0.len(), options, queue),
            |event| {
                let result = rd::rd_kafka_event_DeleteAcls_result(event);
                let mut count = 0;
                let responses = rd::rd_kafka_DeleteAcls_result_responses(result, &mut count);
                let mut deleted = 0;
                let mut errors = Vec::new();
                for &response in slice(responses, count) {
                    match error(rd::rd_kafka_DeleteAcls_result_response_error(response)) {
                        Some(e) => errors.push(e),
                        None => {
                            let mut matched = 0;
                            rd::rd_kafka_DeleteAcls_result_response_matching_acls(response, &mut matched);
                            deleted += matched;
                        }
                    }
                }
                refused(errors, acls.len(), "deleted").map(|()| deleted)
            },
        )
    }
}

fn refused(errors: Vec<Error>, requested: usize, verb: &str) -> Result<()> {
    let Some(first) = errors.first() else { return Ok(()) };
    Err(match requested {
        1 => Error::msg(first.to_string()),
        _ => Error::msg(format!("{} of {requested} ACLs were not {verb}: {first}", errors.len())),
    })
}

enum Kind {
    Binding,
    Filter,
}

/// librdkafka ACL bindings (filters are the same type), destroyed on drop.
struct Bindings(Vec<*mut rd::rd_kafka_AclBinding_t>);

impl Bindings {
    fn new(acls: &[AclBinding], kind: Kind) -> Result<Self> {
        let mut bindings = Bindings(Vec::with_capacity(acls.len()));
        for acl in acls {
            bindings.0.push(new_binding(acl, &kind)?);
        }
        Ok(bindings)
    }

    /// A filter matching every ACL.
    fn any_filter() -> Result<Self> {
        let mut errstr = [0 as c_char; 512];
        // SAFETY: null strings mean "any"; errstr is a writable buffer of the given size.
        let filter = unsafe {
            rd::rd_kafka_AclBindingFilter_new(
                RdResource::RD_KAFKA_RESOURCE_ANY,
                ptr::null(),
                RdPattern::RD_KAFKA_RESOURCE_PATTERN_ANY,
                ptr::null(),
                ptr::null(),
                RdOperation::RD_KAFKA_ACL_OPERATION_ANY,
                RdPermission::RD_KAFKA_ACL_PERMISSION_TYPE_ANY,
                errstr.as_mut_ptr(),
                errstr.len(),
            )
        };
        checked(filter, &errstr).map(|f| Bindings(vec![f]))
    }
}

impl Drop for Bindings {
    fn drop(&mut self) {
        for &binding in &self.0 {
            // SAFETY: each pointer came from AclBinding(Filter)_new and is destroyed once, here.
            unsafe { rd::rd_kafka_AclBinding_destroy(binding) }
        }
    }
}

fn new_binding(acl: &AclBinding, kind: &Kind) -> Result<*mut rd::rd_kafka_AclBinding_t> {
    let text = |s: &str| CString::new(s).map_err(|_| Error::msg("ACL fields cannot contain NUL characters"));
    let (name, principal, host) = (text(&acl.resource_name)?, text(&acl.principal)?, text(&acl.host)?);
    let new = match kind {
        Kind::Binding => rd::rd_kafka_AclBinding_new,
        Kind::Filter => rd::rd_kafka_AclBindingFilter_new,
    };
    let mut errstr = [0 as c_char; 512];
    // SAFETY: the strings are NUL-terminated and copied by librdkafka; errstr is a
    // writable buffer of the given size.
    let binding = unsafe {
        new(
            resource_type(acl.resource_type),
            name.as_ptr(),
            pattern_type(acl.pattern_type),
            principal.as_ptr(),
            host.as_ptr(),
            operation(acl.operation),
            permission(acl.permission),
            errstr.as_mut_ptr(),
            errstr.len(),
        )
    };
    checked(binding, &errstr)
}

fn checked(binding: *mut rd::rd_kafka_AclBinding_t, errstr: &[c_char]) -> Result<*mut rd::rd_kafka_AclBinding_t> {
    if binding.is_null() {
        // SAFETY: librdkafka NUL-terminates errstr when it fails.
        return Err(Error::msg(unsafe { cstr(errstr.as_ptr()) }));
    }
    Ok(binding)
}

/// The error librdkafka reports for one item of a result, if any.
unsafe fn error(e: *const rd::rd_kafka_error_t) -> Option<Error> {
    if e.is_null() {
        return None;
    }
    unsafe { Some(response_error(rd::rd_kafka_error_code(e), cstr(rd::rd_kafka_error_string(e)))) }
}

unsafe fn binding(a: *const rd::rd_kafka_AclBinding_t) -> Option<AclBinding> {
    unsafe {
        Some(AclBinding {
            resource_type: match rd::rd_kafka_AclBinding_restype(a) {
                RdResource::RD_KAFKA_RESOURCE_GROUP => ResourceType::Group,
                RdResource::RD_KAFKA_RESOURCE_BROKER => ResourceType::Cluster,
                RdResource::RD_KAFKA_RESOURCE_TOPIC => ResourceType::Topic,
                RdResource::RD_KAFKA_RESOURCE_TRANSACTIONAL_ID => ResourceType::TransactionalId,
                _ => return None,
            },
            resource_name: cstr(rd::rd_kafka_AclBinding_name(a)),
            pattern_type: match rd::rd_kafka_AclBinding_resource_pattern_type(a) {
                RdPattern::RD_KAFKA_RESOURCE_PATTERN_LITERAL => PatternType::Literal,
                RdPattern::RD_KAFKA_RESOURCE_PATTERN_PREFIXED => PatternType::Prefixed,
                _ => return None,
            },
            principal: cstr(rd::rd_kafka_AclBinding_principal(a)),
            host: cstr(rd::rd_kafka_AclBinding_host(a)),
            operation: match rd::rd_kafka_AclBinding_operation(a) {
                RdOperation::RD_KAFKA_ACL_OPERATION_ALL => Operation::All,
                RdOperation::RD_KAFKA_ACL_OPERATION_READ => Operation::Read,
                RdOperation::RD_KAFKA_ACL_OPERATION_WRITE => Operation::Write,
                RdOperation::RD_KAFKA_ACL_OPERATION_CREATE => Operation::Create,
                RdOperation::RD_KAFKA_ACL_OPERATION_DELETE => Operation::Delete,
                RdOperation::RD_KAFKA_ACL_OPERATION_ALTER => Operation::Alter,
                RdOperation::RD_KAFKA_ACL_OPERATION_DESCRIBE => Operation::Describe,
                RdOperation::RD_KAFKA_ACL_OPERATION_CLUSTER_ACTION => Operation::ClusterAction,
                RdOperation::RD_KAFKA_ACL_OPERATION_DESCRIBE_CONFIGS => Operation::DescribeConfigs,
                RdOperation::RD_KAFKA_ACL_OPERATION_ALTER_CONFIGS => Operation::AlterConfigs,
                RdOperation::RD_KAFKA_ACL_OPERATION_IDEMPOTENT_WRITE => Operation::IdempotentWrite,
                _ => return None,
            },
            permission: match rd::rd_kafka_AclBinding_permission_type(a) {
                RdPermission::RD_KAFKA_ACL_PERMISSION_TYPE_ALLOW => Permission::Allow,
                RdPermission::RD_KAFKA_ACL_PERMISSION_TYPE_DENY => Permission::Deny,
                _ => return None,
            },
        })
    }
}

fn resource_type(r: ResourceType) -> RdResource {
    match r {
        ResourceType::Topic => RdResource::RD_KAFKA_RESOURCE_TOPIC,
        ResourceType::Group => RdResource::RD_KAFKA_RESOURCE_GROUP,
        ResourceType::Cluster => RdResource::RD_KAFKA_RESOURCE_BROKER,
        ResourceType::TransactionalId => RdResource::RD_KAFKA_RESOURCE_TRANSACTIONAL_ID,
    }
}

fn pattern_type(p: PatternType) -> RdPattern {
    match p {
        PatternType::Literal => RdPattern::RD_KAFKA_RESOURCE_PATTERN_LITERAL,
        PatternType::Prefixed => RdPattern::RD_KAFKA_RESOURCE_PATTERN_PREFIXED,
    }
}

fn operation(o: Operation) -> RdOperation {
    match o {
        Operation::All => RdOperation::RD_KAFKA_ACL_OPERATION_ALL,
        Operation::Read => RdOperation::RD_KAFKA_ACL_OPERATION_READ,
        Operation::Write => RdOperation::RD_KAFKA_ACL_OPERATION_WRITE,
        Operation::Create => RdOperation::RD_KAFKA_ACL_OPERATION_CREATE,
        Operation::Delete => RdOperation::RD_KAFKA_ACL_OPERATION_DELETE,
        Operation::Alter => RdOperation::RD_KAFKA_ACL_OPERATION_ALTER,
        Operation::Describe => RdOperation::RD_KAFKA_ACL_OPERATION_DESCRIBE,
        Operation::ClusterAction => RdOperation::RD_KAFKA_ACL_OPERATION_CLUSTER_ACTION,
        Operation::DescribeConfigs => RdOperation::RD_KAFKA_ACL_OPERATION_DESCRIBE_CONFIGS,
        Operation::AlterConfigs => RdOperation::RD_KAFKA_ACL_OPERATION_ALTER_CONFIGS,
        Operation::IdempotentWrite => RdOperation::RD_KAFKA_ACL_OPERATION_IDEMPOTENT_WRITE,
    }
}

fn permission(p: Permission) -> RdPermission {
    match p {
        Permission::Allow => RdPermission::RD_KAFKA_ACL_PERMISSION_TYPE_ALLOW,
        Permission::Deny => RdPermission::RD_KAFKA_ACL_PERMISSION_TYPE_DENY,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acls::CLUSTER_RESOURCE_NAME;

    #[test]
    fn bindings_round_trip_through_librdkafka() {
        let acl = AclBinding {
            resource_type: ResourceType::Cluster,
            resource_name: CLUSTER_RESOURCE_NAME.into(),
            pattern_type: PatternType::Literal,
            principal: "User:alice".into(),
            host: "10.0.0.1".into(),
            operation: Operation::IdempotentWrite,
            permission: Permission::Deny,
        };
        for kind in [Kind::Binding, Kind::Filter] {
            let built = Bindings::new(std::slice::from_ref(&acl), kind).unwrap();
            // SAFETY: `built` owns a valid binding until it is dropped below.
            assert_eq!(unsafe { binding(built.0[0]) }, Some(acl.clone()));
        }
    }

    #[test]
    fn nul_in_a_field_is_an_error_not_a_truncated_name() {
        let mut acl = AclBinding {
            resource_type: ResourceType::Topic,
            resource_name: "orders".into(),
            pattern_type: PatternType::Literal,
            principal: "User:alice".into(),
            host: "*".into(),
            operation: Operation::Read,
            permission: Permission::Allow,
        };
        acl.resource_name = "or\0ders".into();
        assert!(Bindings::new(&[acl], Kind::Binding).is_err());
    }
}
