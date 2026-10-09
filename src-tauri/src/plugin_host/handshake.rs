use crate::plugin_host::protocol::{
    method, HandshakeParams, HandshakeResult, Principal, PROTOCOL_VERSION, SUPPORTED_VERSIONS,
};
use crate::plugin_host::wire::WireError;

const HOST_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const HANDSHAKE_METHOD: &str = method::HANDSHAKE;

#[derive(Debug, thiserror::Error)]
pub enum HandshakeError {
    #[error("wire error: {0}")]
    Wire(#[from] WireError),
    #[error("handshake rejected by plugin: {0}")]
    Rejected(String),
    #[error(
        "protocol version not supported by the host: {0} (host speaks {SUPPORTED_VERSIONS:?})"
    )]
    VersionMismatch(u32),
    #[error("plugin_id mismatch: expected={expected}, got={got}")]
    PluginIdMismatch { expected: String, got: String },
    #[error("invalid handshake response: {0}")]
    InvalidResponse(String),
}

/// Params for the `rim.handshake` request the host sends first on a new connection.
pub fn handshake_params(
    plugin_id: &str,
    granted_capabilities: &[String],
    principal: Option<Principal>,
) -> Result<serde_json::Value, HandshakeError> {
    let params = HandshakeParams {
        protocol_version: PROTOCOL_VERSION,
        supported_versions: SUPPORTED_VERSIONS.to_vec(),
        plugin_id: plugin_id.to_string(),
        host_version: HOST_VERSION.to_string(),
        granted_capabilities: granted_capabilities.to_vec(),
        principal,
    };
    Ok(serde_json::to_value(&params).map_err(WireError::Json)?)
}

/// Validate the `result` of a `rim.handshake` response.
///
/// The plugin picks the version: any entry of [`SUPPORTED_VERSIONS`] is accepted,
/// so a host that later speaks v1 and v2 keeps serving v1 plugins.
pub fn validate_handshake_result(
    result: serde_json::Value,
    plugin_id: &str,
) -> Result<HandshakeResult, HandshakeError> {
    let result: HandshakeResult = serde_json::from_value(result)
        .map_err(|e| HandshakeError::InvalidResponse(e.to_string()))?;

    if !result.accepted {
        return Err(HandshakeError::Rejected(
            result
                .error
                .clone()
                .unwrap_or_else(|| "unknown reason".into()),
        ));
    }

    if !SUPPORTED_VERSIONS.contains(&result.protocol_version) {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn result(
        accepted: bool,
        version: u32,
        plugin_id: &str,
        error: Option<&str>,
    ) -> serde_json::Value {
        serde_json::json!({
            "accepted": accepted,
            "protocolVersion": version,
            "pluginId": plugin_id,
            "error": error,
        })
    }

    #[test]
    fn successful_handshake() {
        let result = validate_handshake_result(
            result(true, 1, "dev.example.test", None),
            "dev.example.test",
        )
        .unwrap();
        assert!(result.accepted);
        assert_eq!(result.protocol_version, 1);
    }

    #[test]
    fn rejected_handshake() {
        let err = validate_handshake_result(
            result(false, 1, "dev.example.test", Some("incompatible host")),
            "dev.example.test",
        )
        .unwrap_err();
        assert!(matches!(err, HandshakeError::Rejected(reason) if reason == "incompatible host"));
    }

    #[test]
    fn version_mismatch() {
        let err = validate_handshake_result(
            result(true, 99, "dev.example.test", None),
            "dev.example.test",
        )
        .unwrap_err();
        assert!(matches!(err, HandshakeError::VersionMismatch(99)));
    }

    #[test]
    fn plugin_id_mismatch() {
        let err = validate_handshake_result(
            result(true, 1, "dev.example.wrong", None),
            "dev.example.test",
        )
        .unwrap_err();
        assert!(matches!(err, HandshakeError::PluginIdMismatch { .. }));
    }
}
