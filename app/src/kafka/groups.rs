//! Consumer groups through librdkafka's admin API (ListConsumerGroups and
//! DescribeConsumerGroups), which rust-rdkafka doesn't wrap.
//!
//! rust-rdkafka's `fetch_group_list` uses the older ListGroups/DescribeGroups
//! requests, which only understand classic groups: a group on the KIP-848
//! `consumer` protocol (`group.protocol=consumer`, Kafka 4+) comes back as
//! Dead with no members, even while its consumers are reading.

use std::collections::BTreeMap;
use std::ffi::{CString, c_char};
use std::time::Duration;

use rdkafka::admin::AdminClient;
use rdkafka::bindings as rd;
use rdkafka::client::DefaultClientContext;

use super::TIMEOUT;
use super::group_offsets::cstr;
use crate::error::{Error, Result};

type Admin = AdminClient<DefaultClientContext>;

pub struct GroupDescription {
    pub name: String,
    /// e.g. `Stable`, `Empty`, `PreparingRebalance`, `Assigning`, `Dead`.
    pub state: String,
    /// Rebalance protocol: `Classic` or `Consumer` (KIP-848).
    pub group_type: String,
    /// Partition assignor, e.g. `range` or `uniform`.
    pub assignor: String,
    pub members: Vec<MemberDescription>,
    /// Why the group could not be described; the other fields are then empty.
    pub error: Option<String>,
}

pub struct MemberDescription {
    pub id: String,
    pub client_id: String,
    pub host: String,
    /// topic -> assigned partitions
    pub assignment: BTreeMap<String, Vec<i32>>,
}

/// Names of every consumer group, classic or KIP-848.
pub fn list(admin: &Admin) -> Result<Vec<String>> {
    // SAFETY: see `request`. The listings live as long as the event.
    unsafe {
        request(
            admin,
            rd::rd_kafka_admin_op_t::RD_KAFKA_ADMIN_OP_LISTCONSUMERGROUPS,
            |rk, options, queue| rd::rd_kafka_ListConsumerGroups(rk, options, queue),
            |event| {
                let result = rd::rd_kafka_event_ListConsumerGroups_result(event);
                let mut count = 0;
                let valid = rd::rd_kafka_ListConsumerGroups_result_valid(result, &mut count);
                let names: Vec<String> =
                    slice(valid, count).iter().map(|&g| cstr(rd::rd_kafka_ConsumerGroupListing_group_id(g))).collect();
                // Errors come from brokers that didn't answer; report them only
                // when no broker did, otherwise show what we got.
                let mut count = 0;
                let errors = rd::rd_kafka_ListConsumerGroups_result_errors(result, &mut count);
                if names.is_empty()
                    && let Some(&error) = slice(errors, count).first()
                {
                    return Err(Error::msg(cstr(rd::rd_kafka_error_string(error))));
                }
                Ok(names)
            },
        )
    }
}

/// Describes `groups` in one request, in no particular order.
pub fn describe(admin: &Admin, groups: &[String]) -> Result<Vec<GroupDescription>> {
    if groups.is_empty() {
        return Ok(Vec::new());
    }
    let names: Vec<CString> = groups
        .iter()
        .map(|g| CString::new(g.as_str()).map_err(|_| Error::msg(format!("Invalid group name: {g}"))))
        .collect::<Result<_>>()?;
    let mut ptrs: Vec<*const c_char> = names.iter().map(|n| n.as_ptr()).collect();
    // SAFETY: see `request`. `names` outlives the call, which copies them.
    unsafe {
        request(
            admin,
            rd::rd_kafka_admin_op_t::RD_KAFKA_ADMIN_OP_DESCRIBECONSUMERGROUPS,
            |rk, options, queue| rd::rd_kafka_DescribeConsumerGroups(rk, ptrs.as_mut_ptr(), ptrs.len(), options, queue),
            |event| {
                let result = rd::rd_kafka_event_DescribeConsumerGroups_result(event);
                let mut count = 0;
                let groups = rd::rd_kafka_DescribeConsumerGroups_result_groups(result, &mut count);
                Ok(slice(groups, count).iter().map(|&g| description(g)).collect())
            },
        )
    }
}

/// Describes one group; fails if Kafka can't.
pub fn describe_one(admin: &Admin, group: &str) -> Result<GroupDescription> {
    let description = describe(admin, &[group.to_string()])?
        .into_iter()
        .find(|d| d.name == group)
        .ok_or_else(|| Error::msg(format!("Group not found: {group}")))?;
    match description.error {
        Some(e) => Err(Error::msg(format!("Could not describe {group}: {e}"))),
        None => Ok(description),
    }
}

unsafe fn description(g: *const rd::rd_kafka_ConsumerGroupDescription_t) -> GroupDescription {
    unsafe {
        let name = cstr(rd::rd_kafka_ConsumerGroupDescription_group_id(g));
        let error = rd::rd_kafka_ConsumerGroupDescription_error(g);
        if !error.is_null() {
            return GroupDescription {
                name,
                state: "Unknown".into(),
                group_type: String::new(),
                assignor: String::new(),
                members: Vec::new(),
                error: Some(cstr(rd::rd_kafka_error_string(error))),
            };
        }
        let members = (0..rd::rd_kafka_ConsumerGroupDescription_member_count(g))
            .map(|i| member(rd::rd_kafka_ConsumerGroupDescription_member(g, i)))
            .collect();
        GroupDescription {
            name,
            state: cstr(rd::rd_kafka_consumer_group_state_name(rd::rd_kafka_ConsumerGroupDescription_state(g))),
            group_type: cstr(rd::rd_kafka_consumer_group_type_name(rd::rd_kafka_ConsumerGroupDescription_type(g))),
            assignor: cstr(rd::rd_kafka_ConsumerGroupDescription_partition_assignor(g)),
            members,
            error: None,
        }
    }
}

unsafe fn member(m: *const rd::rd_kafka_MemberDescription_t) -> MemberDescription {
    unsafe {
        let mut assignment: BTreeMap<String, Vec<i32>> = BTreeMap::new();
        let assigned = rd::rd_kafka_MemberDescription_assignment(m);
        let list =
            if assigned.is_null() { std::ptr::null() } else { rd::rd_kafka_MemberAssignment_partitions(assigned) };
        if !list.is_null() && (*list).cnt > 0 {
            for p in std::slice::from_raw_parts((*list).elems, (*list).cnt as usize) {
                assignment.entry(cstr(p.topic)).or_default().push(p.partition);
            }
        }
        for partitions in assignment.values_mut() {
            partitions.sort_unstable();
        }
        MemberDescription {
            id: cstr(rd::rd_kafka_MemberDescription_consumer_id(m)),
            client_id: cstr(rd::rd_kafka_MemberDescription_client_id(m)),
            host: cstr(rd::rd_kafka_MemberDescription_host(m)),
            assignment,
        }
    }
}

/// Sends one admin request on its own queue and hands the result event to `read`.
///
/// SAFETY: `rk` stays valid while `admin` is borrowed. librdkafka copies the
/// options when the request is sent, and the queue is reference counted: a
/// reply arriving after it is destroyed (on timeout) is dropped.
unsafe fn request<T>(
    admin: &Admin,
    op: rd::rd_kafka_admin_op_t,
    send: impl FnOnce(*mut rd::rd_kafka_t, *const rd::rd_kafka_AdminOptions_t, *mut rd::rd_kafka_queue_t),
    read: impl FnOnce(*mut rd::rd_kafka_event_t) -> Result<T>,
) -> Result<T> {
    unsafe {
        let rk = admin.inner().native_ptr();
        let queue = rd::rd_kafka_queue_new(rk);
        let options = rd::rd_kafka_AdminOptions_new(rk, op);
        let mut errstr = [0 as c_char; 256];
        rd::rd_kafka_AdminOptions_set_request_timeout(
            options,
            TIMEOUT.as_millis() as i32,
            errstr.as_mut_ptr(),
            errstr.len(),
        );
        send(rk, options, queue);
        rd::rd_kafka_AdminOptions_destroy(options);

        let event = rd::rd_kafka_queue_poll(queue, (TIMEOUT + Duration::from_secs(1)).as_millis() as i32);
        let result = if event.is_null() {
            Err(Error::msg("Timed out reading consumer groups"))
        } else if rd::rd_kafka_event_error(event) != rd::rd_kafka_resp_err_t::RD_KAFKA_RESP_ERR_NO_ERROR {
            Err(Error::msg(cstr(rd::rd_kafka_event_error_string(event))))
        } else {
            read(event)
        };
        if !event.is_null() {
            rd::rd_kafka_event_destroy(event);
        }
        rd::rd_kafka_queue_destroy(queue);
        result
    }
}

/// A C array of `count` pointers as a slice; empty when null.
unsafe fn slice<'a, T>(ptr: *mut *const T, count: usize) -> &'a [*const T] {
    if ptr.is_null() || count == 0 { &[] } else { unsafe { std::slice::from_raw_parts(ptr, count) } }
}
