//! Helpers for calling librdkafka admin APIs that rust-rdkafka doesn't wrap
//! (consumer groups, ACLs). Each call gets its own queue, sends one request
//! and waits for its result event.

use std::ffi::{CStr, c_char};
use std::time::Duration;

use rdkafka::admin::AdminClient;
use rdkafka::bindings as rd;
use rdkafka::client::DefaultClientContext;

use super::TIMEOUT;
use crate::{Error, Result};

pub(crate) type Admin = AdminClient<DefaultClientContext>;

/// What Kafka's SECURITY_DISABLED means for the person using KUI.
const NO_AUTHORIZER: &str =
    "ACLs are turned off on this cluster: its brokers have no authorizer configured (authorizer.class.name).";

/// Sends one admin request on its own queue and hands the result event to `read`.
///
/// SAFETY: `rk` stays valid while `admin` is borrowed. librdkafka copies the
/// options and request arguments when the request is sent, and the queue is
/// reference counted: a reply arriving after it is destroyed (on timeout) is
/// dropped.
pub(crate) unsafe fn request<T>(
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
            Err(Error::msg("Timed out waiting for Kafka to answer"))
        } else {
            match rd::rd_kafka_event_error(event) {
                rd::rd_kafka_resp_err_t::RD_KAFKA_RESP_ERR_NO_ERROR => read(event),
                rd::rd_kafka_resp_err_t::RD_KAFKA_RESP_ERR_SECURITY_DISABLED => Err(Error::msg(NO_AUTHORIZER)),
                _ => Err(Error::msg(cstr(rd::rd_kafka_event_error_string(event)))),
            }
        };
        if !event.is_null() {
            rd::rd_kafka_event_destroy(event);
        }
        rd::rd_kafka_queue_destroy(queue);
        result
    }
}

/// The message of a per-item error inside a result event.
pub(crate) unsafe fn error_message(error: *const rd::rd_kafka_error_t) -> String {
    unsafe {
        if rd::rd_kafka_error_code(error) == rd::rd_kafka_resp_err_t::RD_KAFKA_RESP_ERR_SECURITY_DISABLED {
            NO_AUTHORIZER.to_string()
        } else {
            cstr(rd::rd_kafka_error_string(error))
        }
    }
}

/// A C array of `count` pointers as a slice; empty when null.
pub(crate) unsafe fn slice<'a, T>(ptr: *mut *const T, count: usize) -> &'a [*const T] {
    if ptr.is_null() || count == 0 { &[] } else { unsafe { std::slice::from_raw_parts(ptr, count) } }
}

/// A C string as an owned `String`; empty when null.
pub(crate) unsafe fn cstr(s: *const c_char) -> String {
    if s.is_null() { String::new() } else { unsafe { CStr::from_ptr(s) }.to_string_lossy().into_owned() }
}
