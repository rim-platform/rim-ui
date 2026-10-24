//! How a failure reaches the page: a JS `Error` named by its code.

use wasm_bindgen::JsValue;

/// A failed operation. `code` is what the page branches on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Failure {
    pub code: &'static str,
    pub message: String,
}

pub(crate) type Result<T> = std::result::Result<T, Failure>;

impl Failure {
    /// An argument of the wrong length or value.
    pub(crate) fn invalid(message: impl Into<String>) -> Self {
        Self {
            code: "OPAQUE_INVALID",
            message: message.into(),
        }
    }

    /// `finish` called on a flow that already finished.
    pub(crate) fn used() -> Self {
        Self {
            code: "OPAQUE_USED",
            message: "this flow already finished".into(),
        }
    }
}

impl From<rim_opaque::Error> for Failure {
    fn from(e: rim_opaque::Error) -> Self {
        use rim_opaque::Error as E;
        let code = match &e {
            E::WrongPassword => "OPAQUE_WRONG_PASSWORD",
            E::Malformed(_) => "OPAQUE_MALFORMED",
            E::Unauthentic => "OPAQUE_UNAUTHENTIC",
            E::Protocol(_) => "OPAQUE_FAILED",
        };
        Self {
            code,
            message: e.to_string(),
        }
    }
}

impl From<Failure> for JsValue {
    fn from(failure: Failure) -> Self {
        let error = js_sys::Error::new(&failure.message);
        error.set_name(failure.code);
        error.into()
    }
}
