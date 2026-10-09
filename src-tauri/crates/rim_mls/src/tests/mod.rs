mod formats;
mod providers;
mod raw;
mod sequencer;
mod simulation;
mod sizes;
mod support;
mod tampering;
mod vectors;

// In a browser: `cargo test -p rim_mls --no-default-features --target wasm32-unknown-unknown`.
#[cfg(target_arch = "wasm32")]
wasm_bindgen_test::wasm_bindgen_test_configure!(run_in_browser);
