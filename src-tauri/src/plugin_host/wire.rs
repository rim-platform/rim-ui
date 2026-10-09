use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

// JSON-RPC 2.0 error codes
pub const METHOD_NOT_FOUND: i32 = -32601;
pub const INVALID_PARAMS: i32 = -32602;
pub const INTERNAL_ERROR: i32 = -32603;
// Application error codes (plugin host specific)
pub const CAPABILITY_DENIED: i32 = -32000;
pub const RATE_LIMITED: i32 = -32001;
// Sent by plugins; the host passes it through without matching on it, except in tests.
#[allow(dead_code)]
pub const PLUGIN_ERROR: i32 = -32002;

/// Largest frame payload either side may send, in bytes (4 MiB).
pub const MAX_FRAME_SIZE: u32 = 4 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
    pub id: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
    pub id: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcNotification {
    pub jsonrpc: String,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

impl JsonRpcRequest {
    pub fn new(
        method: impl Into<String>,
        params: Option<serde_json::Value>,
        id: impl Into<serde_json::Value>,
    ) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            method: method.into(),
            params,
            id: id.into(),
        }
    }
}

impl JsonRpcResponse {
    pub fn success(id: serde_json::Value, result: serde_json::Value) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            result: Some(result),
            error: None,
            id,
        }
    }

    pub fn error(id: serde_json::Value, code: i32, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            result: None,
            error: Some(JsonRpcError {
                code,
                message: message.into(),
                data: None,
            }),
            id,
        }
    }
}

impl JsonRpcNotification {
    pub fn new(method: impl Into<String>, params: Option<serde_json::Value>) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            method: method.into(),
            params,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum WireError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("frame too large: {0} bytes (max {MAX_FRAME_SIZE})")]
    FrameTooLarge(u32),
    #[error("connection closed")]
    ConnectionClosed,
}

/// Write a length-prefixed JSON frame: 4-byte little-endian length + JSON payload.
pub async fn write_frame<W: AsyncWrite + Unpin>(
    writer: &mut W,
    value: &impl Serialize,
) -> Result<(), WireError> {
    let payload = serde_json::to_vec(value)?;
    let len = payload.len() as u32;
    if len > MAX_FRAME_SIZE {
        return Err(WireError::FrameTooLarge(len));
    }
    writer.write_all(&len.to_le_bytes()).await?;
    writer.write_all(&payload).await?;
    writer.flush().await?;
    Ok(())
}

/// Read a length-prefixed JSON frame: 4-byte little-endian length + JSON payload.
pub async fn read_frame<R: AsyncRead + Unpin, T: for<'de> Deserialize<'de>>(
    reader: &mut R,
) -> Result<T, WireError> {
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
            return Err(WireError::ConnectionClosed);
        }
        Err(e) => return Err(WireError::Io(e)),
    }
    let len = u32::from_le_bytes(len_buf);
    if len > MAX_FRAME_SIZE {
        return Err(WireError::FrameTooLarge(len));
    }
    let mut buf = vec![0u8; len as usize];
    reader.read_exact(&mut buf).await?;
    let value = serde_json::from_slice(&buf)?;
    Ok(value)
}

/// Read a raw JSON value frame (for messages that could be request, response, or notification).
pub async fn read_raw_frame<R: AsyncRead + Unpin>(
    reader: &mut R,
) -> Result<serde_json::Value, WireError> {
    read_frame(reader).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn roundtrip_request() {
        let req = JsonRpcRequest::new("rim.log", Some(serde_json::json!({"msg": "hello"})), 1);
        let mut buf = Vec::new();
        write_frame(&mut buf, &req).await.unwrap();

        let mut cursor = std::io::Cursor::new(buf);
        let decoded: JsonRpcRequest = read_frame(&mut cursor).await.unwrap();
        assert_eq!(decoded.method, "rim.log");
        assert_eq!(decoded.id, serde_json::json!(1));
    }

    #[tokio::test]
    async fn roundtrip_response() {
        let resp = JsonRpcResponse::success(serde_json::json!(42), serde_json::json!({"ok": true}));
        let mut buf = Vec::new();
        write_frame(&mut buf, &resp).await.unwrap();

        let mut cursor = std::io::Cursor::new(buf);
        let decoded: JsonRpcResponse = read_frame(&mut cursor).await.unwrap();
        assert!(decoded.result.is_some());
        assert!(decoded.error.is_none());
        assert_eq!(decoded.id, serde_json::json!(42));
    }

    #[tokio::test]
    async fn roundtrip_error_response() {
        let resp = JsonRpcResponse::error(serde_json::json!(1), METHOD_NOT_FOUND, "not found");
        let mut buf = Vec::new();
        write_frame(&mut buf, &resp).await.unwrap();

        let mut cursor = std::io::Cursor::new(buf);
        let decoded: JsonRpcResponse = read_frame(&mut cursor).await.unwrap();
        assert!(decoded.error.is_some());
        assert_eq!(decoded.error.unwrap().code, METHOD_NOT_FOUND);
    }

    #[tokio::test]
    async fn roundtrip_notification() {
        let notif = JsonRpcNotification::new("rim.heartbeat", None);
        let mut buf = Vec::new();
        write_frame(&mut buf, &notif).await.unwrap();

        let mut cursor = std::io::Cursor::new(buf);
        let decoded: JsonRpcNotification = read_frame(&mut cursor).await.unwrap();
        assert_eq!(decoded.method, "rim.heartbeat");
    }

    #[tokio::test]
    async fn eof_returns_connection_closed() {
        let mut cursor = std::io::Cursor::new(Vec::<u8>::new());
        let result: Result<JsonRpcRequest, _> = read_frame(&mut cursor).await;
        assert!(matches!(result, Err(WireError::ConnectionClosed)));
    }

    #[tokio::test]
    async fn frame_too_large_rejected() {
        let len = (MAX_FRAME_SIZE + 1).to_le_bytes();
        let mut cursor = std::io::Cursor::new(len.to_vec());
        let result: Result<JsonRpcRequest, _> = read_frame(&mut cursor).await;
        assert!(matches!(result, Err(WireError::FrameTooLarge(_))));
    }
}
