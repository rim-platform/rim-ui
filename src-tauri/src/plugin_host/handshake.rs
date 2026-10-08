#![allow(dead_code)]

use crate::plugin_host::wire::{self, JsonRpcRequest, JsonRpcResponse, WireError};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncWrite};

const PROTOCOL_VERSION: i32 = 1;
const HOST_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const HANDSHAKE_METHOD: &str = "rim.handshake";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandshakeParams {
    pub protocol_version: i32,
    pub plugin_id: String,
    pub host_version: String,
    pub granted_capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandshakeResult {
    pub accepted: bool,
    pub protocol_version: i32,
    pub plugin_id: String,
    pub error: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum HandshakeError {
    #[error("wire error: {0}")]
    Wire(#[from] WireError),
    #[error("handshake rejected by plugin: {0}")]
    Rejected(String),
    #[error("protocol version mismatch: host={PROTOCOL_VERSION}, plugin={0}")]
    VersionMismatch(i32),
    #[error("plugin_id mismatch: expected={expected}, got={got}")]
    PluginIdMismatch { expected: String, got: String },
    #[error("invalid handshake response: {0}")]
    InvalidResponse(String),
}

/// Params for the `rim.handshake` request the host sends first on a new connection.
pub fn handshake_params(
    plugin_id: &str,
    granted_capabilities: &[String],
) -> Result<serde_json::Value, HandshakeError> {
    let params = HandshakeParams {
        protocol_version: PROTOCOL_VERSION,
        plugin_id: plugin_id.to_string(),
        host_version: HOST_VERSION.to_string(),
        granted_capabilities: granted_capabilities.to_vec(),
    };
    Ok(serde_json::to_value(&params).map_err(WireError::Json)?)
}

/// Validate the `result` of a `rim.handshake` response.
pub fn validate_handshake_result(
    result: serde_json::Value,
    plugin_id: &str,
) -> Result<HandshakeResult, HandshakeError> {
    let result: HandshakeResult = serde_json::from_value(result)
        .map_err(|e| HandshakeError::InvalidResponse(e.to_string()))?;

    if !result.accepted {
        return Err(HandshakeError::Rejected(
            result.error.unwrap_or_else(|| "unknown reason".into()),
        ));
    }

    if result.protocol_version != PROTOCOL_VERSION {
        return Err(HandshakeError::VersionMismatch(result.protocol_version));
    }

    if result.plugin_id != plugin_id {
        return Err(HandshakeError::PluginIdMismatch {
            expected: plugin_id.to_string(),
            got: result.plugin_id,
        });
    }

    Ok(result)
}

/// Perform the host-side handshake: send request, read response, validate.
///
/// Reads the very next frame as the response, so it only suits a connection
/// nothing else is reading yet. The runtime handshakes through
/// [`crate::plugin_host::broker::PluginClient`] instead, which tolerates a
/// plugin that logs before it answers.
pub async fn perform_handshake<R, W>(
    reader: &mut R,
    writer: &mut W,
    plugin_id: &str,
    granted_capabilities: &[String],
) -> Result<HandshakeResult, HandshakeError>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let request = JsonRpcRequest::new(
        HANDSHAKE_METHOD,
        Some(handshake_params(plugin_id, granted_capabilities)?),
        0,
    );

    wire::write_frame(writer, &request).await?;

    let response: JsonRpcResponse = wire::read_frame(reader).await?;

    if let Some(err) = &response.error {
        return Err(HandshakeError::Rejected(err.message.clone()));
    }

    let result = response
        .result
        .ok_or_else(|| HandshakeError::InvalidResponse("missing result field".into()))?;
    validate_handshake_result(result, plugin_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_host::wire;

    #[tokio::test]
    async fn successful_handshake() {
        // Simulate plugin response
        let mut response_buf = Vec::new();
        let response = JsonRpcResponse::success(
            serde_json::json!(0),
            serde_json::json!({
                "accepted": true,
                "protocol_version": 1,
                "plugin_id": "dev.example.test",
                "error": null
            }),
        );
        wire::write_frame(&mut response_buf, &response)
            .await
            .unwrap();

        let mut request_buf = Vec::new();
        let mut reader = std::io::Cursor::new(response_buf);

        let result = perform_handshake(
            &mut reader,
            &mut request_buf,
            "dev.example.test",
            &["chat.read".into()],
        )
        .await
        .unwrap();

        assert!(result.accepted);
        assert_eq!(result.protocol_version, 1);

        // Verify the request was written correctly
        let mut req_cursor = std::io::Cursor::new(request_buf);
        let sent: JsonRpcRequest = wire::read_frame(&mut req_cursor).await.unwrap();
        assert_eq!(sent.method, "rim.handshake");
    }

    #[tokio::test]
    async fn rejected_handshake() {
        let mut response_buf = Vec::new();
        let response = JsonRpcResponse::success(
            serde_json::json!(0),
            serde_json::json!({
                "accepted": false,
                "protocol_version": 1,
                "plugin_id": "dev.example.test",
                "error": "incompatible host"
            }),
        );
        wire::write_frame(&mut response_buf, &response)
            .await
            .unwrap();

        let mut request_buf = Vec::new();
        let mut reader = std::io::Cursor::new(response_buf);

        let err = perform_handshake(&mut reader, &mut request_buf, "dev.example.test", &[])
            .await
            .unwrap_err();

        assert!(matches!(err, HandshakeError::Rejected(_)));
    }

    #[tokio::test]
    async fn version_mismatch() {
        let mut response_buf = Vec::new();
        let response = JsonRpcResponse::success(
            serde_json::json!(0),
            serde_json::json!({
                "accepted": true,
                "protocol_version": 99,
                "plugin_id": "dev.example.test",
                "error": null
            }),
        );
        wire::write_frame(&mut response_buf, &response)
            .await
            .unwrap();

        let mut request_buf = Vec::new();
        let mut reader = std::io::Cursor::new(response_buf);

        let err = perform_handshake(&mut reader, &mut request_buf, "dev.example.test", &[])
            .await
            .unwrap_err();

        assert!(matches!(err, HandshakeError::VersionMismatch(99)));
    }

    #[tokio::test]
    async fn plugin_id_mismatch() {
        let mut response_buf = Vec::new();
        let response = JsonRpcResponse::success(
            serde_json::json!(0),
            serde_json::json!({
                "accepted": true,
                "protocol_version": 1,
                "plugin_id": "dev.example.wrong",
                "error": null
            }),
        );
        wire::write_frame(&mut response_buf, &response)
            .await
            .unwrap();

        let mut request_buf = Vec::new();
        let mut reader = std::io::Cursor::new(response_buf);

        let err = perform_handshake(&mut reader, &mut request_buf, "dev.example.test", &[])
            .await
            .unwrap_err();

        assert!(matches!(err, HandshakeError::PluginIdMismatch { .. }));
    }
}
