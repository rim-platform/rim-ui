//! AWS Signature Version 4: the `Authorization` header S3 and S3-compatible storage take.
//!
//! The canonical request names the method, the path, the query, the signed headers and the
//! payload's SHA-256; its hash is signed with a key derived from the secret, the date, the region
//! and the service.

use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

use super::super::ArchiveError;
use super::http::percent_encode;

const ALGORITHM: &str = "AWS4-HMAC-SHA256";

/// `x-amz-date`'s format.
pub(crate) const AMZ_DATE: &str = "%Y%m%dT%H%M%SZ";

/// Hex SHA-256 of a payload, as `x-amz-content-sha256` and the canonical request carry it.
pub(crate) fn payload_hash(payload: &[u8]) -> String {
    hex::encode(Sha256::digest(payload))
}

/// A request to sign.
pub(crate) struct Request<'a> {
    pub method: &'a str,
    /// The path as sent, already encoded.
    pub path: &'a str,
    /// The query's pairs, not encoded.
    pub query: &'a [(String, String)],
    /// Every header to sign, `host` and `x-amz-date` included; names in any case.
    pub headers: &'a [(&'a str, &'a str)],
    /// [`payload_hash`] of the body.
    pub payload_hash: &'a str,
}

/// Who signs, where.
pub(crate) struct Key<'a> {
    pub access_key_id: &'a str,
    pub secret: &'a str,
    pub region: &'a str,
    pub service: &'a str,
}

/// The query as the canonical request and the URL carry it: encoded pairs, sorted.
pub(crate) fn canonical_query(query: &[(String, String)]) -> String {
    let mut pairs: Vec<(String, String)> = query
        .iter()
        .map(|(k, v)| (percent_encode(k, false), percent_encode(v, false)))
        .collect();
    pairs.sort();
    pairs
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&")
}

/// A header value trimmed, with runs of spaces inside it made one.
fn canonical_value(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn hmac(key: &[u8], message: &str) -> Result<Vec<u8>, ArchiveError> {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key)
        .map_err(|e| ArchiveError::Crypto(format!("request signing key: {e}")))?;
    mac.update(message.as_bytes());
    Ok(mac.finalize().into_bytes().to_vec())
}

/// The canonical request, and the signed headers' names it lists.
pub(crate) fn canonical_request(request: &Request) -> (String, String) {
    let mut headers: Vec<(String, String)> = request
        .headers
        .iter()
        .map(|(n, v)| (n.to_ascii_lowercase(), canonical_value(v)))
        .collect();
    headers.sort();
    let signed_headers = headers
        .iter()
        .map(|(n, _)| n.as_str())
        .collect::<Vec<_>>()
        .join(";");
    let canonical_headers: String = headers.iter().map(|(n, v)| format!("{n}:{v}\n")).collect();
    let text = format!(
        "{}\n{}\n{}\n{canonical_headers}\n{signed_headers}\n{}",
        request.method,
        request.path,
        canonical_query(request.query),
        request.payload_hash
    );
    (text, signed_headers)
}

fn scope(key: &Key, time: DateTime<Utc>) -> String {
    format!(
        "{}/{}/{}/aws4_request",
        time.format("%Y%m%d"),
        key.region,
        key.service
    )
}

/// What is signed: the algorithm, the time, the scope and the canonical request's hash.
pub(crate) fn string_to_sign(canonical_request: &str, key: &Key, time: DateTime<Utc>) -> String {
    format!(
        "{ALGORITHM}\n{}\n{}\n{}",
        time.format(AMZ_DATE),
        scope(key, time),
        payload_hash(canonical_request.as_bytes())
    )
}

/// The `Authorization` header of `request` at `time`, which must be its `x-amz-date`.
pub(crate) fn authorization(
    request: &Request,
    key: &Key,
    time: DateTime<Utc>,
) -> Result<String, ArchiveError> {
    let (canonical, signed_headers) = canonical_request(request);
    let date = time.format("%Y%m%d").to_string();
    let mut signing_key = hmac(format!("AWS4{}", key.secret).as_bytes(), &date)?;
    for part in [key.region, key.service, "aws4_request"] {
        signing_key = hmac(&signing_key, part)?;
    }
    let signature = hex::encode(hmac(&signing_key, &string_to_sign(&canonical, key, time))?);
    Ok(format!(
        "{ALGORITHM} Credential={}/{}, SignedHeaders={signed_headers}, Signature={signature}",
        key.access_key_id,
        scope(key, time)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The credentials and time of the AWS Signature Version 4 test suite.
    const SUITE: Key = Key {
        access_key_id: "AKIDEXAMPLE",
        secret: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
        region: "us-east-1",
        service: "service",
    };
    const EMPTY: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    fn suite_time() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2015-08-30T12:36:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    /// One case of the suite: the request, then the canonical request, string to sign and
    /// `Authorization` it expects.
    fn suite_case(
        method: &str,
        query: &[(&str, &str)],
        extra_headers: &[(&str, &str)],
        payload: &[u8],
        expected: (&str, &str, &str),
    ) {
        let query: Vec<(String, String)> = query
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        let mut headers = extra_headers.to_vec();
        headers.extend([
            ("Host", "example.amazonaws.com"),
            ("X-Amz-Date", "20150830T123600Z"),
        ]);
        let hash = payload_hash(payload);
        let request = Request {
            method,
            path: "/",
            query: &query,
            headers: &headers,
            payload_hash: &hash,
        };
        let (canonical, _) = canonical_request(&request);
        assert_eq!(canonical, expected.0);
        assert_eq!(string_to_sign(&canonical, &SUITE, suite_time()), expected.1);
        assert_eq!(
            authorization(&request, &SUITE, suite_time()).unwrap(),
            expected.2
        );
    }

    #[test]
    fn get_vanilla() {
        suite_case(
            "GET",
            &[],
            &[],
            b"",
            (
                &format!("GET\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n{EMPTY}"),
                "AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\nbb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63",
                "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
            ),
        );
    }

    #[test]
    fn get_vanilla_query_order_key_case() {
        suite_case(
            "GET",
            &[("Param2", "value2"), ("Param1", "value1")],
            &[],
            b"",
            (
                &format!("GET\n/\nParam1=value1&Param2=value2\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n{EMPTY}"),
                "AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\n816cd5b414d056048ba4f7c5386d6e0533120fb1fcfa93762cf0fc39e2cf19e0",
                "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500",
            ),
        );
    }

    #[test]
    fn get_vanilla_query_unreserved() {
        let unreserved = "-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
        suite_case(
            "GET",
            &[(unreserved, unreserved)],
            &[],
            b"",
            (
                &format!("GET\n/\n{unreserved}={unreserved}\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n{EMPTY}"),
                "AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\nc30d4703d9f799439be92736156d47ccfb2d879ddf56f5befa6d1d6aab979177",
                "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=9c3e54bfcdf0b19771a7f523ee5669cdf59bc7cc0884027167c21bb143a40197",
            ),
        );
    }

    #[test]
    fn post_vanilla() {
        suite_case(
            "POST",
            &[],
            &[],
            b"",
            (
                &format!("POST\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n{EMPTY}"),
                "AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\n553f88c9e4d10fc9e109e2aeb65f030801b70c2f6468faca261d401ae622fc87",
                "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b",
            ),
        );
    }

    #[test]
    fn post_x_www_form_urlencoded() {
        suite_case(
            "POST",
            &[],
            &[("Content-Type", "application/x-www-form-urlencoded")],
            b"Param1=value1",
            (
                "POST\n/\n\ncontent-type:application/x-www-form-urlencoded\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\ncontent-type;host;x-amz-date\n9095672bbd1f56dfc5b65f3e153adc8731a4a654192329106275f4c7b24d0b6e",
                "AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\n42a5e5bb34198acb3e84da4f085bb7927f2bc277ca766e6d19c73c2154021281",
                "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a",
            ),
        );
    }

    /// The `GET Object` example of the Amazon S3 documentation: a path, a range, and the
    /// payload hash header S3 requires.
    #[test]
    fn s3_get_object_example() {
        let time = DateTime::parse_from_rfc3339("2013-05-24T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let headers = [
            ("Host", "examplebucket.s3.amazonaws.com"),
            ("Range", "bytes=0-9"),
            ("x-amz-content-sha256", EMPTY),
            ("x-amz-date", "20130524T000000Z"),
        ];
        let request = Request {
            method: "GET",
            path: "/test.txt",
            query: &[],
            headers: &headers,
            payload_hash: EMPTY,
        };
        let key = Key {
            access_key_id: "AKIAIOSFODNN7EXAMPLE",
            secret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
            region: "us-east-1",
            service: "s3",
        };
        let (canonical, _) = canonical_request(&request);
        assert_eq!(
            canonical,
            format!("GET\n/test.txt\n\nhost:examplebucket.s3.amazonaws.com\nrange:bytes=0-9\nx-amz-content-sha256:{EMPTY}\nx-amz-date:20130524T000000Z\n\nhost;range;x-amz-content-sha256;x-amz-date\n{EMPTY}")
        );
        assert_eq!(
            string_to_sign(&canonical, &key, time),
            "AWS4-HMAC-SHA256\n20130524T000000Z\n20130524/us-east-1/s3/aws4_request\n7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972"
        );
        assert!(authorization(&request, &key, time).unwrap().ends_with(
            "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
        ));
    }

    #[test]
    fn values_are_encoded_as_signature_v4_asks() {
        assert_eq!(percent_encode("a b/c+d~e", true), "a%20b/c%2Bd~e");
        assert_eq!(percent_encode("a/b", false), "a%2Fb");
        assert_eq!(percent_encode("ü", false), "%C3%BC");
        assert_eq!(
            canonical_query(&[
                ("prefix".into(), "a/b".into()),
                ("delimiter".into(), "/".into()),
                ("list-type".into(), "2".into()),
            ]),
            "delimiter=%2F&list-type=2&prefix=a%2Fb"
        );
    }
}
