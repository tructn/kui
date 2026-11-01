//! Committed offsets of many consumer groups through the shared admin client.
//!
//! rust-rdkafka doesn't wrap librdkafka's ListConsumerGroupOffsets, so this
//! calls it directly. The alternative, a consumer per group carrying its
//! group id, pays a new client's connection, TLS + SASL handshake and
//! coordinator lookup for every group (~65 ms each locally, far more against
//! a remote cluster). Here every request rides the admin client's existing
//! broker connections and all of them are in flight at once.

use std::collections::HashMap;
use std::ffi::{CStr, CString, c_void};
use std::ptr;
use std::time::{Duration, Instant};

use rdkafka::admin::AdminClient;
use rdkafka::bindings as rd;
use rdkafka::client::DefaultClientContext;
use rdkafka::types::RDKafkaErrorCode;

use super::TIMEOUT;
use super::offsets::PartitionKey;
use crate::error::{Error, Result};

/// Every offset each of `groups` has committed, in the order given. A group
/// that never committed anything gets an empty map.
pub fn list(admin: &AdminClient<DefaultClientContext>, groups: &[String]) -> Vec<Result<HashMap<PartitionKey, i64>>> {
    let mut results: Vec<Option<Result<HashMap<PartitionKey, i64>>>> = (0..groups.len()).map(|_| None).collect();
    if groups.is_empty() {
        return Vec::new();
    }
    let rk = admin.inner().native_ptr();
    // SAFETY: `rk` stays valid while `admin` is borrowed. Requests and options
    // are copied by librdkafka when sent, so they are destroyed right after.
    // The queue is reference counted: replies arriving after it is destroyed
    // (on timeout) are dropped by librdkafka.
    unsafe {
        let queue = rd::rd_kafka_queue_new(rk);
        for (index, group) in groups.iter().enumerate() {
            if let Err(e) = send(rk, queue, index, group) {
                results[index] = Some(Err(e));
            }
        }
        let deadline = Instant::now() + TIMEOUT + Duration::from_secs(1);
        while results.iter().any(Option::is_none) {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            let event = rd::rd_kafka_queue_poll(queue, left.as_millis() as i32);
            if event.is_null() {
                continue;
            }
            if rd::rd_kafka_event_type(event) == rd::RD_KAFKA_EVENT_LISTCONSUMERGROUPOFFSETS_RESULT {
                let index = rd::rd_kafka_event_opaque(event) as usize;
                if let Some(slot) = results.get_mut(index) {
                    *slot = Some(read(event));
                }
            }
            rd::rd_kafka_event_destroy(event);
        }
        rd::rd_kafka_queue_destroy(queue);
    }
    results.into_iter().map(|r| r.unwrap_or_else(|| Err(Error::msg("Timed out reading committed offsets")))).collect()
}

/// Asks for every partition `group` committed; the reply carries `index`.
unsafe fn send(rk: *mut rd::rd_kafka_t, queue: *mut rd::rd_kafka_queue_t, index: usize, group: &str) -> Result<()> {
    let name = CString::new(group).map_err(|_| Error::msg(format!("Invalid group name: {group}")))?;
    unsafe {
        let options =
            rd::rd_kafka_AdminOptions_new(rk, rd::rd_kafka_admin_op_t::RD_KAFKA_ADMIN_OP_LISTCONSUMERGROUPOFFSETS);
        let mut errstr = [0 as std::ffi::c_char; 256];
        rd::rd_kafka_AdminOptions_set_request_timeout(
            options,
            TIMEOUT.as_millis() as i32,
            errstr.as_mut_ptr(),
            errstr.len(),
        );
        rd::rd_kafka_AdminOptions_set_opaque(options, index as *mut c_void);
        // NULL partitions: all the group has committed.
        let mut request = rd::rd_kafka_ListConsumerGroupOffsets_new(name.as_ptr(), ptr::null());
        // librdkafka accepts one group per call.
        rd::rd_kafka_ListConsumerGroupOffsets(rk, &mut request, 1, options, queue);
        rd::rd_kafka_ListConsumerGroupOffsets_destroy(request);
        rd::rd_kafka_AdminOptions_destroy(options);
    }
    Ok(())
}

/// The committed offsets in a ListConsumerGroupOffsets result event.
unsafe fn read(event: *mut rd::rd_kafka_event_t) -> Result<HashMap<PartitionKey, i64>> {
    unsafe {
        let err = rd::rd_kafka_event_error(event);
        if err != rd::rd_kafka_resp_err_t::RD_KAFKA_RESP_ERR_NO_ERROR {
            return Err(Error::msg(cstr(rd::rd_kafka_event_error_string(event))));
        }
        let result = rd::rd_kafka_event_ListConsumerGroupOffsets_result(event);
        let mut count = 0;
        let groups = rd::rd_kafka_ListConsumerGroupOffsets_result_groups(result, &mut count);
        let Some(&group) = (count > 0).then(|| &*groups) else {
            return Ok(HashMap::new());
        };
        let error = rd::rd_kafka_group_result_error(group);
        if !error.is_null() {
            return Err(Error::msg(cstr(rd::rd_kafka_error_string(error))));
        }
        let list = rd::rd_kafka_group_result_partitions(group);
        if list.is_null() || (*list).cnt <= 0 {
            return Ok(HashMap::new());
        }
        Ok(std::slice::from_raw_parts((*list).elems, (*list).cnt as usize)
            .iter()
            // A negative offset (-1001) means never committed.
            .filter(|p| RDKafkaErrorCode::from(p.err) == RDKafkaErrorCode::NoError && p.offset >= 0)
            .map(|p| ((cstr(p.topic), p.partition), p.offset))
            .collect())
    }
}

pub(super) unsafe fn cstr(s: *const std::ffi::c_char) -> String {
    if s.is_null() { String::new() } else { unsafe { CStr::from_ptr(s) }.to_string_lossy().into_owned() }
}
