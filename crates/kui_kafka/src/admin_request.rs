//! The plumbing shared by the librdkafka admin calls rust-rdkafka doesn't wrap
//! (consumer groups, ACLs): one request on its own queue, waited for in place.

use std::ffi::c_char;
use std::time::Duration;

use rdkafka::admin::AdminClient;
use rdkafka::bindings as rd;
use rdkafka::client::DefaultClientContext;

use super::TIMEOUT;
use super::group_offsets::cstr;
use crate::{Error, Result};

pub(crate) type Admin = AdminClient<DefaultClientContext>;

/// Sends one admin request on its own queue and hands the result event to `read`.
///
/// SAFETY: `rk` stays valid while `admin` is borrowed. librdkafka copies the
/// options and the request arguments when the request is sent, and the queue is
/// reference counted: a reply arriving after it is destroyed (on timeout) is dropped.
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
                code => Err(response_error(code, cstr(rd::rd_kafka_event_error_string(event)))),
            }
        };
        if !event.is_null() {
            rd::rd_kafka_event_destroy(event);
        }
        rd::rd_kafka_queue_destroy(queue);
        result
    }
}

/// An error Kafka returned for a request, reworded where the raw text doesn't say what to do.
pub(crate) fn response_error(code: rd::rd_kafka_resp_err_t, message: String) -> Error {
    match code {
        rd::rd_kafka_resp_err_t::RD_KAFKA_RESP_ERR_SECURITY_DISABLED => Error::msg(
            "This cluster has no authorizer, so it has no ACLs. \
             Set authorizer.class.name on the brokers to manage ACLs.",
        ),
        rd::rd_kafka_resp_err_t::RD_KAFKA_RESP_ERR_CLUSTER_AUTHORIZATION_FAILED => {
            Error::msg(format!("This connection is not allowed to do that: {message}"))
        }
        _ => Error::msg(message),
    }
}

/// A C array of `count` pointers as a slice; empty when null.
pub(crate) unsafe fn slice<'a, T>(ptr: *mut *const T, count: usize) -> &'a [*const T] {
    if ptr.is_null() || count == 0 { &[] } else { unsafe { std::slice::from_raw_parts(ptr, count) } }
}
