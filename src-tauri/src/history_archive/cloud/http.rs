//! The cloud providers' HTTP client: blocking (providers run on the blocking pool), with
//! retries and backoff for rate limits and transient failures.

use std::thread;
use std::time::Duration;

use reqwest::blocking::{Client, RequestBuilder};
use reqwest::header::RETRY_AFTER;
use reqwest::StatusCode;

use super::super::crypto::random_bytes;
use super::super::ArchiveError;

/// How often and how long a request is retried.
#[derive(Debug, Clone, Copy)]
pub(crate) struct RetryPolicy {
    /// Attempts in total, the first included.
    pub attempts: u32,
    /// The first backoff; each retry doubles it, up to `max_delay`.
    pub base_delay: Duration,
    pub max_delay: Duration,
    /// The longest `Retry-After` honored as given; a longer one is cut to this.
    pub max_retry_after: Duration,
}

impl RetryPolicy {
    pub(crate) const DEFAULT: Self = Self {
        attempts: 6,
        base_delay: Duration::from_millis(500),
        max_delay: Duration::from_secs(16),
        max_retry_after: Duration::from_secs(60),
    };

    /// Revoking a token on disconnect: one try, so going offline does not hold the user up.
    pub(crate) const ONCE: Self = Self {
        attempts: 1,
        ..Self::DEFAULT
    };

    /// Exponential backoff with jitter: somewhere between half and all of the capped delay,
    /// so devices that failed together do not retry together.
    fn backoff(&self, retry: u32) -> Duration {
        let capped = self
            .base_delay
            .saturating_mul(1u32 << retry.min(16))
            .min(self.max_delay);
        let jitter = random_bytes::<1>().map(|b| b[0]).unwrap_or(128);
        capped / 2 + capped / 2 * u32::from(jitter) / 255
    }
}

/// A response, read whole. Archive files are at most a few MiB.
#[derive(Debug)]
pub(crate) struct Reply {
    pub status: StatusCode,
    pub body: Vec<u8>,
}

impl Reply {
    pub(crate) fn ok(&self) -> bool {
        self.status.is_success()
    }

    pub(crate) fn json<T: serde::de::DeserializeOwned>(&self) -> Result<T, ArchiveError> {
        serde_json::from_slice(&self.body)
            .map_err(|e| ArchiveError::Io(format!("unexpected answer from the server: {e}")))
    }

    /// The body as text, shortened, for error messages.
    pub(crate) fn text(&self) -> String {
        let text = String::from_utf8_lossy(&self.body);
        text.chars().take(300).collect()
    }
}

/// Decides whether an answer is a rate limit or a transient failure worth retrying, beyond
/// the generic 429 and 5xx (Google Drive also signals rate limits with a 403).
pub(crate) type RetryClassifier = fn(StatusCode, &[u8]) -> bool;

pub(crate) struct Http {
    client: Client,
    policy: RetryPolicy,
    /// Named in errors: "Google Drive", "Dropbox".
    service: &'static str,
    classify: RetryClassifier,
}

impl Http {
    pub(crate) fn new(
        service: &'static str,
        policy: RetryPolicy,
        classify: RetryClassifier,
    ) -> Result<Self, ArchiveError> {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(15))
            // A 4 MiB segment on a slow uplink.
            .timeout(Duration::from_secs(180))
            .user_agent(concat!("rim-ui/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| ArchiveError::Io(format!("http client: {e}")))?;
        Ok(Self {
            client,
            policy,
            service,
            classify,
        })
    }

    pub(crate) fn service(&self) -> &'static str {
        self.service
    }

    /// Send the request `build` makes, again on a rate limit, a 5xx or a network failure,
    /// with backoff. `build` is called once per attempt. The last answer is returned whatever
    /// its status; only a request that never got an answer is an error.
    pub(crate) fn send(
        &self,
        build: impl Fn(&Client) -> RequestBuilder,
    ) -> Result<Reply, ArchiveError> {
        let mut retry = 0;
        loop {
            let last = retry + 1 >= self.policy.attempts;
            let wait = match build(&self.client).send() {
                Ok(response) => {
                    let status = response.status();
                    let retry_after = response
                        .headers()
                        .get(RETRY_AFTER)
                        .and_then(|v| v.to_str().ok())
                        .and_then(|v| v.trim().parse::<u64>().ok())
                        .map(Duration::from_secs);
                    let body = response
                        .bytes()
                        .map(|b| b.to_vec())
                        .map_err(|e| self.unreachable(&e));
                    match body {
                        Ok(body) => {
                            let reply = Reply { status, body };
                            if last || !self.retryable(&reply) {
                                return Ok(reply);
                            }
                            log::info!(
                                "[history_archive] {} answered {status}; retrying",
                                self.service
                            );
                            retry_after.map(|d| d.min(self.policy.max_retry_after))
                        }
                        Err(e) if last => return Err(e),
                        Err(_) => None,
                    }
                }
                Err(e) if last => return Err(self.unreachable(&e)),
                Err(e) => {
                    log::info!(
                        "[history_archive] {} request failed: {e}; retrying",
                        self.service
                    );
                    None
                }
            };
            thread::sleep(wait.unwrap_or_else(|| self.policy.backoff(retry)));
            retry += 1;
        }
    }

    fn retryable(&self, reply: &Reply) -> bool {
        reply.status == StatusCode::TOO_MANY_REQUESTS
            || reply.status.is_server_error()
            || (self.classify)(reply.status, &reply.body)
    }

    fn unreachable(&self, e: &reqwest::Error) -> ArchiveError {
        ArchiveError::Unavailable(format!("cannot reach {}: {e}", self.service))
    }

    /// The error for an answer the caller did not expect.
    pub(crate) fn failure(&self, what: &str, reply: &Reply) -> ArchiveError {
        if reply.status == StatusCode::TOO_MANY_REQUESTS
            || reply.status.is_server_error()
            || (self.classify)(reply.status, &reply.body)
        {
            ArchiveError::Unavailable(format!(
                "{} is busy or unavailable ({}); try again later",
                self.service, reply.status
            ))
        } else if reply.status == StatusCode::UNAUTHORIZED {
            ArchiveError::CloudAuth(format!("{} no longer accepts this sign-in", self.service))
        } else {
            ArchiveError::Io(format!(
                "{} {what}: {} {}",
                self.service,
                reply.status,
                reply.text()
            ))
        }
    }
}

/// Never retry beyond 429 and 5xx.
pub(crate) fn no_extra_retries(_: StatusCode, _: &[u8]) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_doubles_up_to_the_cap_with_jitter() {
        let policy = RetryPolicy {
            attempts: 10,
            base_delay: Duration::from_millis(100),
            max_delay: Duration::from_millis(1_000),
            max_retry_after: Duration::from_secs(1),
        };
        for (retry, cap) in [
            (0, 100),
            (1, 200),
            (2, 400),
            (3, 800),
            (4, 1_000),
            (30, 1_000),
        ] {
            let delay = policy.backoff(retry);
            let cap = Duration::from_millis(cap);
            assert!(delay >= cap / 2 && delay <= cap, "retry {retry}: {delay:?}");
        }
    }
}
