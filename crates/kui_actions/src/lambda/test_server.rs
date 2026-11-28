use std::time::Duration;

use reqwest::Url;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

pub fn http(status: &str, headers: &str, body: &str) -> String {
    format!("HTTP/1.1 {status}\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
}

async fn listen() -> (TcpListener, Url) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = Url::parse(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
    (listener, url)
}

/// Answers one request with `response` and hands back the request it got.
pub async fn serve_once(response: String) -> (Url, JoinHandle<String>) {
    let (listener, url) = listen().await;
    let handle = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = vec![0; 8192];
        let n = socket.read(&mut request).await.unwrap();
        socket.write_all(response.as_bytes()).await.unwrap();
        String::from_utf8_lossy(&request[..n]).into_owned()
    });
    (url, handle)
}

/// Accepts a connection and never answers.
pub async fn silent_endpoint() -> (Url, JoinHandle<()>) {
    let (listener, url) = listen().await;
    let handle = tokio::spawn(async move {
        let (_socket, _) = listener.accept().await.unwrap();
        tokio::time::sleep(Duration::from_secs(30)).await;
    });
    (url, handle)
}

/// An address nothing listens on.
pub async fn closed_endpoint() -> Url {
    listen().await.1
}
