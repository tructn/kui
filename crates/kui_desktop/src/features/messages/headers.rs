//! Reading message headers without rdkafka's `Headers::iter`/`try_get`, which
//! `unwrap` a UTF-8 conversion of every header name. Kafka header names are
//! arbitrary bytes, so one hostile record would abort the whole app (panic = "abort").
#![allow(unsafe_code)]

use std::ffi::{CStr, c_char, c_void};
use std::slice;

use rdkafka::bindings::{rd_kafka_header_cnt, rd_kafka_header_get_all, rd_kafka_headers_t};
use rdkafka::error::IsError;
use rdkafka::message::BorrowedHeaders;

pub(super) struct RawHeader<'a> {
    pub name: String,
    pub value: Option<&'a [u8]>,
}

/// The first `limit` headers of a consumed message and how many it has in all; names that
/// are not UTF-8 are decoded lossily.
pub(super) fn read(headers: &BorrowedHeaders, limit: usize) -> (Vec<RawHeader<'_>>, usize) {
    // SAFETY: rdkafka builds a `&BorrowedHeaders` by casting the native
    // `rd_kafka_headers_t` pointer, so casting back yields the same valid list,
    // which lives as long as the message that `headers` borrows from.
    unsafe { read_native(headers as *const BorrowedHeaders as *const rd_kafka_headers_t, limit) }
}

/// # Safety
/// `list` must point to a valid `rd_kafka_headers_t` that outlives `'a`.
unsafe fn read_native<'a>(list: *const rd_kafka_headers_t, limit: usize) -> (Vec<RawHeader<'a>>, usize) {
    // SAFETY: `list` is valid per the contract; librdkafka bounds-checks `idx`.
    let count = unsafe { rd_kafka_header_cnt(list) };
    let mut out = Vec::with_capacity(count.min(limit));
    for idx in 0..count.min(limit) {
        let mut name: *const c_char = std::ptr::null();
        let mut value: *const c_void = std::ptr::null();
        let mut size = 0usize;
        // SAFETY: the out-pointers are valid locals; on success `name` is a
        // NUL-terminated string and `value` (if non-null) holds `size` bytes,
        // both owned by `list`.
        unsafe {
            if rd_kafka_header_get_all(list, idx, &mut name, &mut value, &mut size).is_error() || name.is_null() {
                continue;
            }
            out.push(RawHeader {
                name: CStr::from_ptr(name).to_string_lossy().into_owned(),
                value: (!value.is_null()).then(|| slice::from_raw_parts(value as *const u8, size)),
            });
        }
    }
    (out, count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rdkafka::bindings::{rd_kafka_header_add, rd_kafka_headers_destroy, rd_kafka_headers_new};

    fn add(list: *mut rd_kafka_headers_t, name: &[u8], value: Option<&[u8]>) {
        let name = std::ffi::CString::new(name).unwrap();
        let (ptr, len) = value.map_or((std::ptr::null(), 0), |v| (v.as_ptr() as *const c_void, v.len() as isize));
        let err = unsafe { rd_kafka_header_add(list, name.as_ptr(), -1, ptr, len) };
        assert!(!err.is_error());
    }

    #[test]
    fn non_utf8_header_name_is_decoded_lossily_instead_of_panicking() {
        let list = unsafe { rd_kafka_headers_new(3) };
        add(list, b"ok", Some(b"v"));
        add(list, &[0xff, 0xfe], Some(&[0x00, 0xff]));
        add(list, b"empty", None);

        let (headers, total) = unsafe { read_native(list, usize::MAX) };
        assert_eq!(total, 3);
        let names: Vec<_> = headers.iter().map(|h| h.name.as_str()).collect();
        assert_eq!(names, ["ok", "\u{fffd}\u{fffd}", "empty"]);
        assert_eq!(headers[1].value, Some(&[0x00, 0xff][..]));
        assert_eq!(headers[2].value, None);
        drop(headers);
        unsafe { rd_kafka_headers_destroy(list) };
    }

    #[test]
    fn reading_stops_at_the_limit_but_still_counts_every_header() {
        let list = unsafe { rd_kafka_headers_new(10) };
        for i in 0..1000 {
            add(list, format!("h{i}").as_bytes(), Some(b"v"));
        }
        let (headers, total) = unsafe { read_native(list, 7) };
        assert_eq!((headers.len(), total), (7, 1000));
        assert_eq!(headers[6].name, "h6");
        drop(headers);
        unsafe { rd_kafka_headers_destroy(list) };
    }
}
