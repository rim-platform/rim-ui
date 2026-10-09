//! How a failure reaches the page: a JS `Error` named by its code, with the epoch when the
//! group waits for a re-add.

use wasm_bindgen::JsValue;

/// A failed operation. `code` is what the page branches on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Failure {
    pub code: &'static str,
    pub message: String,
    /// The epoch a group stopped at, for `E2EE_AWAITING_READD`.
    pub epoch: Option<u64>,
}

pub(crate) type Result<T> = std::result::Result<T, Failure>;

impl Failure {
    pub(crate) fn invalid(message: impl Into<String>) -> Self {
        Self {
            code: "E2EE_INVALID",
            message: message.into(),
            epoch: None,
        }
    }
}

impl From<rim_mls::Error> for Failure {
    fn from(e: rim_mls::Error) -> Self {
        use rim_mls::Error as E;
        let code = match &e {
            E::Storage(_) => "E2EE_STORAGE",
            E::Malformed { .. } => "E2EE_MALFORMED",
            E::Invalid(_) => "E2EE_INVALID",
            E::NoIdentity => "E2EE_NO_IDENTITY",
            E::NoGroup => "E2EE_NO_GROUP",
            E::WrongGroup => "E2EE_WRONG_GROUP",
            E::EpochMismatch { .. } => "E2EE_EPOCH_MISMATCH",
            E::CommitPending => "E2EE_COMMIT_PENDING",
            E::NoPendingCommit => "E2EE_NO_PENDING_COMMIT",
            E::AwaitingReadd(_) => "E2EE_AWAITING_READD",
            E::Removed => "E2EE_REMOVED",
            E::NotInGroup(_) => "E2EE_NOT_IN_GROUP",
            E::Decrypt(_) => "E2EE_DECRYPT",
            E::Mls(_) => "E2EE_MLS",
            E::Crypto(_) => "E2EE_CRYPTO",
        };
        let epoch = match &e {
            E::AwaitingReadd(epoch) => Some(*epoch),
            _ => None,
        };
        Self {
            code,
            message: e.to_string(),
            epoch,
        }
    }
}

impl From<Failure> for JsValue {
    fn from(failure: Failure) -> Self {
        let error = js_sys::Error::new(&failure.message);
        error.set_name(failure.code);
        if let Some(epoch) = failure.epoch {
            let _ = js_sys::Reflect::set(&error, &"epoch".into(), &(epoch as f64).into());
        }
        error.into()
    }
}
