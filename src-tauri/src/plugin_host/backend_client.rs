#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

const DEFAULT_GRAPHQL_ENDPOINT: &str = "http://localhost:8080/graphql";

#[derive(Debug, Clone, Serialize)]
struct GraphqlRequest {
    query: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    variables: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GraphqlResponse {
    pub data: Option<serde_json::Value>,
    pub errors: Option<Vec<GraphqlError>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GraphqlError {
    pub message: String,
    pub extensions: Option<serde_json::Value>,
}

#[derive(Debug, thiserror::Error)]
pub enum BackendClientError {
    #[error("http error: {0}")]
    Http(String),
    #[error("graphql error: {0}")]
    Graphql(String),
    #[error("no session available")]
    NoSession,
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone)]
pub struct BackendClientConfig {
    pub graphql_endpoint: String,
}

impl Default for BackendClientConfig {
    fn default() -> Self {
        Self {
            graphql_endpoint: DEFAULT_GRAPHQL_ENDPOINT.to_string(),
        }
    }
}

/// Session token holder — the plugin never sees the raw token.
/// Tokens are held in memory only, never passed via command-line or environment.
pub struct SessionHolder {
    session_cookie: RwLock<Option<String>>,
    csrf_token: RwLock<Option<String>>,
}

impl SessionHolder {
    pub fn new() -> Self {
        Self {
            session_cookie: RwLock::new(None),
            csrf_token: RwLock::new(None),
        }
    }

    pub async fn set_session(&self, session_cookie: String, csrf_token: String) {
        *self.session_cookie.write().await = Some(session_cookie);
        *self.csrf_token.write().await = Some(csrf_token);
    }

    pub async fn clear_session(&self) {
        *self.session_cookie.write().await = None;
        *self.csrf_token.write().await = None;
    }

    pub async fn get_session(&self) -> Option<(String, String)> {
        let cookie = self.session_cookie.read().await.clone();
        let csrf = self.csrf_token.read().await.clone();
        match (cookie, csrf) {
            (Some(c), Some(t)) => Some((c, t)),
            _ => None,
        }
    }
}

pub struct BackendClient {
    config: BackendClientConfig,
    session: Arc<SessionHolder>,
    http: reqwest::Client,
}

impl BackendClient {
    pub fn new(config: BackendClientConfig, session: Arc<SessionHolder>) -> Self {
        let http = reqwest::Client::new();
        Self {
            config,
            session,
            http,
        }
    }

    /// Execute a GraphQL query/mutation against rim-server.
    /// Session cookie is injected via HTTP headers — never exposed in process args.
    pub async fn execute(
        &self,
        query: &str,
        variables: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, BackendClientError> {
        let (session_cookie, csrf_token) = self
            .session
            .get_session()
            .await
            .ok_or(BackendClientError::NoSession)?;

        let body = GraphqlRequest {
            query: query.to_string(),
            variables,
        };

        let resp = self
            .http
            .post(&self.config.graphql_endpoint)
            .header("Content-Type", "application/json")
            .header("Cookie", format!("session={session_cookie}"))
            .header("X-CSRF-Token", &csrf_token)
            .json(&body)
            .send()
            .await
            .map_err(|e| BackendClientError::Http(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(BackendClientError::Http(format!(
                "HTTP request failed with status: {}",
                resp.status()
            )));
        }

        let response: GraphqlResponse = resp
            .json()
            .await
            .map_err(|e| BackendClientError::Http(format!("invalid response JSON: {e}")))?;

        if let Some(errors) = &response.errors {
            if !errors.is_empty() {
                let messages: Vec<&str> = errors.iter().map(|e| e.message.as_str()).collect();
                return Err(BackendClientError::Graphql(messages.join("; ")));
            }
        }

        response
            .data
            .ok_or_else(|| BackendClientError::Graphql("no data in response".into()))
    }

    /// Send a chat message via GraphQL mutation.
    pub async fn send_message(
        &self,
        server_id: &str,
        conversation_id: &str,
        text: &str,
        parent_message_id: Option<&str>,
    ) -> Result<serde_json::Value, BackendClientError> {
        let query = r#"
            mutation SendMessage($input: SendMessageInput!) {
                sendMessage(input: $input) {
                    id
                    text
                    authorId
                    createdAt
                }
            }
        "#;

        let mut input = serde_json::json!({
            "serverId": server_id,
            "conversationId": conversation_id,
            "text": text,
        });

        if let Some(parent_id) = parent_message_id {
            input["parentMessageId"] = serde_json::json!(parent_id);
        }

        self.execute(query, Some(serde_json::json!({ "input": input })))
            .await
    }

    /// Get messages from a conversation via GraphQL query.
    pub async fn get_messages(
        &self,
        server_id: &str,
        conversation_id: &str,
        limit: i32,
        cursor: Option<&str>,
    ) -> Result<serde_json::Value, BackendClientError> {
        let query = r#"
            query Messages($serverId: ID!, $conversationId: ID!, $dir: PageDir!, $limit: Int!, $includeDeleted: Boolean!) {
                messages(serverId: $serverId, conversationId: $conversationId, dir: $dir, limit: $limit, includeDeleted: $includeDeleted) {
                    items {
                        id
                        text
                        authorId
                        createdAt
                        editedAt
                    }
                    hasMore
                }
            }
        "#;

        let mut variables = serde_json::json!({
            "serverId": server_id,
            "conversationId": conversation_id,
            "dir": "BACKWARD",
            "limit": limit.min(100).max(1),
            "includeDeleted": false,
        });

        if let Some(c) = cursor {
            variables["cursor"] = serde_json::json!({"messageId": c});
        }

        self.execute(query, Some(variables)).await
    }

    /// Search messages in a conversation.
    pub async fn search_messages(
        &self,
        server_id: &str,
        conversation_id: &str,
        search_query: &str,
        limit: i32,
    ) -> Result<serde_json::Value, BackendClientError> {
        let query = r#"
            query SearchMessages($serverId: ID!, $conversationId: ID!, $query: String!, $limit: Int!, $includeDeleted: Boolean!) {
                searchMessages(serverId: $serverId, conversationId: $conversationId, query: $query, limit: $limit, includeDeleted: $includeDeleted) {
                    id
                    text
                    authorId
                    createdAt
                }
            }
        "#;

        let variables = serde_json::json!({
            "serverId": server_id,
            "conversationId": conversation_id,
            "query": search_query,
            "limit": limit.min(100).max(1),
            "includeDeleted": false,
        });

        self.execute(query, Some(variables)).await
    }
}

/// Audit log entry for plugin->backend calls.
#[derive(Debug, Clone, Serialize)]
pub struct AuditEntry {
    pub timestamp: String,
    pub plugin_id: String,
    pub method: String,
    pub capability: String,
    pub success: bool,
    pub error: Option<String>,
}

pub fn log_audit(entry: &AuditEntry) {
    log::info!(
        "[AUDIT] plugin={} method={} capability={} success={} error={:?}",
        entry.plugin_id,
        entry.method,
        entry.capability,
        entry.success,
        entry.error
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn session_holder_roundtrip() {
        let holder = SessionHolder::new();
        assert!(holder.get_session().await.is_none());

        holder
            .set_session("abc123".into(), "csrf456".into())
            .await;
        let (cookie, csrf) = holder.get_session().await.unwrap();
        assert_eq!(cookie, "abc123");
        assert_eq!(csrf, "csrf456");

        holder.clear_session().await;
        assert!(holder.get_session().await.is_none());
    }

    #[test]
    fn audit_entry_serializes() {
        let entry = AuditEntry {
            timestamp: "2026-03-26T22:00:00Z".into(),
            plugin_id: "dev.example.test".into(),
            method: "rim.chat.send_message".into(),
            capability: "chat.write".into(),
            success: true,
            error: None,
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("rim.chat.send_message"));
    }

    #[test]
    fn default_config() {
        let config = BackendClientConfig::default();
        assert_eq!(config.graphql_endpoint, "http://localhost:8080/graphql");
    }

    #[test]
    fn backend_client_uses_reqwest() {
        // Verify BackendClient holds a reqwest::Client (compile-time proof)
        let session = Arc::new(SessionHolder::new());
        let client = BackendClient::new(BackendClientConfig::default(), session);
        // If this compiles, the http field is reqwest::Client
        let _ = &client.http;
    }
}
