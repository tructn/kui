use reqwest::{Client, Url};

use crate::model::LambdaRuntime;
use crate::{Error, Result};

pub fn client() -> Result<Client> {
    // reqwest is built without a bundled crypto provider; this picks the one the
    // updater uses. It fails harmlessly when one is already installed.
    let _ = rustls::crypto::ring::default_provider().install_default();
    Client::builder()
        .user_agent(concat!("KUI/", env!("CARGO_PKG_VERSION")))
        // Never follow a redirect away from the endpoint the user configured.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| Error::msg(format!("Couldn't create the HTTP client: {e}")))
}

pub fn invocation_url(endpoint: &Url, function: &str) -> Result<Url> {
    endpoint_url(endpoint, &["2015-03-31", "functions", function, "invocations"])
}

pub(super) fn endpoint_url(endpoint: &Url, segments: &[&str]) -> Result<Url> {
    let mut url = endpoint.clone();
    url.path_segments_mut().map_err(|_| Error::msg("The endpoint can't take a path"))?.clear().extend(segments);
    Ok(url)
}

pub(super) fn not_running(url: &Url, runtime: LambdaRuntime) -> String {
    let at = url.host_str().map(|h| format!("{h}:{}", url.port_or_known_default().unwrap_or(80))).unwrap_or_default();
    format!("Nothing is listening at {at}. Start it with `{}`.", runtime.start_command())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_escape_the_function_name() {
        let endpoint = Url::parse("http://127.0.0.1:3001/").unwrap();
        let url = invocation_url(&endpoint, "Order:Fn").unwrap();
        assert_eq!(url.as_str(), "http://127.0.0.1:3001/2015-03-31/functions/Order:Fn/invocations");
    }
}
