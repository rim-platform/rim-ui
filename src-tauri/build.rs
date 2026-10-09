fn main() {
    // OAuth client ids of the history archive's cloud providers are build-time configuration
    // (see the README); rebuild when they change.
    for var in [
        "RIM_GOOGLE_CLIENT_ID",
        "RIM_GOOGLE_CLIENT_SECRET",
        "RIM_DROPBOX_APP_KEY",
        "RIM_DROPBOX_REDIRECT_PORT",
    ] {
        println!("cargo:rerun-if-env-changed={var}");
    }
    tauri_build::build()
}
