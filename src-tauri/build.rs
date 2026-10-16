use std::path::Path;

/// First line of the stand-in a debug build bundles when the notices were not generated.
const NOTICES_PLACEHOLDER: &str = "RIM third-party notices were not generated for this build.";

/// The bundled third-party notices, which `npm run licenses` writes. A debug build without them
/// gets a stand-in so `cargo check`, `cargo test` and `tauri dev` work without cargo-about; a
/// release build refuses to go on without the real file.
fn third_party_notices() {
    let path = Path::new("resources/THIRD-PARTY-LICENSES.txt");
    println!("cargo:rerun-if-changed={}", path.display());
    let generated = std::fs::read_to_string(path)
        .map(|text| !text.starts_with(NOTICES_PLACEHOLDER))
        .unwrap_or(false);
    if generated {
        return;
    }
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        panic!(
            "{} is missing: run `npm run licenses` before a release build",
            path.display()
        );
    }
    if !path.exists() {
        let stand_in = format!("{NOTICES_PLACEHOLDER}\nRun `npm run licenses` to write them.\n");
        if let Err(err) =
            std::fs::create_dir_all("resources").and_then(|()| std::fs::write(path, stand_in))
        {
            panic!("cannot write {}: {err}", path.display());
        }
    }
}

fn main() {
    // OAuth client ids of the history archive's cloud providers are build-time configuration
    // (see the README); rebuild when they change.
    for var in [
        "RIM_GOOGLE_CLIENT_ID",
        "RIM_GOOGLE_CLIENT_SECRET",
        "RIM_DROPBOX_APP_KEY",
        "RIM_DROPBOX_REDIRECT_PORT",
        "RIM_MICROSOFT_CLIENT_ID",
    ] {
        println!("cargo:rerun-if-env-changed={var}");
    }
    third_party_notices();
    tauri_build::build()
}
