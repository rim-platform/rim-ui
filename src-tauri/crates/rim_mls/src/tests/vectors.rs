//! Published known-answer vectors, run through the providers as linked: Ed25519 (RFC 8032),
//! X25519 (RFC 7748), HPKE base mode (RFC 9180 A.1), HKDF (RFC 5869), HMAC (RFC 4231), AES-GCM
//! (Wycheproof), X-Wing (draft-connolly-cfrg-xwing-kem) and ML-KEM-768 (NIST ACVP).

use hpke_rs_crypto::types::KemAlgorithm;
use hpke_rs_crypto::HpkeCrypto;
use hpke_rs_libcrux::HpkeLibcrux;
use hpke_rs_rust_crypto::HpkeRustCrypto;
use openmls_traits::crypto::OpenMlsCrypto;
use openmls_traits::types::{
    AeadType, HashType, HpkeAeadType, HpkeCiphertext, HpkeConfig, HpkeKdfType, HpkeKemType,
    SignatureScheme,
};
use serde::Deserialize;

fn h(text: &str) -> Vec<u8> {
    hex::decode(text.split_whitespace().collect::<String>()).unwrap()
}

/// The provider operations the vectors drive, object-safe so both providers fit one loop.
trait Crypto {
    fn sign(&self, data: &[u8], key: &[u8]) -> Vec<u8>;
    fn verify(&self, data: &[u8], key: &[u8], signature: &[u8]) -> bool;
    fn hkdf(&self, salt: &[u8], ikm: &[u8], info: &[u8], len: usize) -> (Vec<u8>, Vec<u8>);
    fn hmac(&self, key: &[u8], message: &[u8]) -> Vec<u8>;
    fn seal(&self, alg: AeadType, key: &[u8], msg: &[u8], nonce: &[u8], aad: &[u8]) -> Vec<u8>;
    fn open(
        &self,
        alg: AeadType,
        key: &[u8],
        ct: &[u8],
        nonce: &[u8],
        aad: &[u8],
    ) -> Option<Vec<u8>>;
    fn derive(&self, config: &HpkeConfig, ikm: &[u8]) -> (Vec<u8>, Vec<u8>);
    fn hpke_open(
        &self,
        config: &HpkeConfig,
        enc: &[u8],
        ct: &[u8],
        sk: &[u8],
        info: &[u8],
        aad: &[u8],
    ) -> Vec<u8>;
    fn hpke_export(
        &self,
        config: &HpkeConfig,
        enc: &[u8],
        sk: &[u8],
        info: &[u8],
        context: &[u8],
        len: usize,
    ) -> Vec<u8>;
    fn hpke_seal(
        &self,
        config: &HpkeConfig,
        pk: &[u8],
        info: &[u8],
        aad: &[u8],
        pt: &[u8],
    ) -> (Vec<u8>, Vec<u8>);
}

impl<T: OpenMlsCrypto> Crypto for T {
    fn sign(&self, data: &[u8], key: &[u8]) -> Vec<u8> {
        OpenMlsCrypto::sign(self, SignatureScheme::ED25519, data, key).unwrap()
    }
    fn verify(&self, data: &[u8], key: &[u8], signature: &[u8]) -> bool {
        self.verify_signature(SignatureScheme::ED25519, data, key, signature)
            .is_ok()
    }
    fn hkdf(&self, salt: &[u8], ikm: &[u8], info: &[u8], len: usize) -> (Vec<u8>, Vec<u8>) {
        let prk = self.hkdf_extract(HashType::Sha2_256, salt, ikm).unwrap();
        let okm = self
            .hkdf_expand(HashType::Sha2_256, prk.as_slice(), info, len)
            .unwrap();
        (prk.as_slice().to_vec(), okm.as_slice().to_vec())
    }
    fn hmac(&self, key: &[u8], message: &[u8]) -> Vec<u8> {
        OpenMlsCrypto::hmac(self, HashType::Sha2_256, key, message)
            .unwrap()
            .as_slice()
            .to_vec()
    }
    fn seal(&self, alg: AeadType, key: &[u8], msg: &[u8], nonce: &[u8], aad: &[u8]) -> Vec<u8> {
        self.aead_encrypt(alg, key, msg, nonce, aad).unwrap()
    }
    fn open(
        &self,
        alg: AeadType,
        key: &[u8],
        ct: &[u8],
        nonce: &[u8],
        aad: &[u8],
    ) -> Option<Vec<u8>> {
        self.aead_decrypt(alg, key, ct, nonce, aad).ok()
    }
    fn derive(&self, config: &HpkeConfig, ikm: &[u8]) -> (Vec<u8>, Vec<u8>) {
        let pair = self.derive_hpke_keypair(copy(config), ikm).unwrap();
        (pair.private.to_vec(), pair.public)
    }
    fn hpke_open(
        &self,
        config: &HpkeConfig,
        enc: &[u8],
        ct: &[u8],
        sk: &[u8],
        info: &[u8],
        aad: &[u8],
    ) -> Vec<u8> {
        let input = HpkeCiphertext {
            kem_output: enc.to_vec().into(),
            ciphertext: ct.to_vec().into(),
        };
        OpenMlsCrypto::hpke_open(self, copy(config), &input, sk, info, aad).unwrap()
    }
    fn hpke_export(
        &self,
        config: &HpkeConfig,
        enc: &[u8],
        sk: &[u8],
        info: &[u8],
        context: &[u8],
        len: usize,
    ) -> Vec<u8> {
        self.hpke_setup_receiver_and_export(copy(config), enc, sk, info, context, len)
            .unwrap()
            .to_vec()
    }
    fn hpke_seal(
        &self,
        config: &HpkeConfig,
        pk: &[u8],
        info: &[u8],
        aad: &[u8],
        pt: &[u8],
    ) -> (Vec<u8>, Vec<u8>) {
        let sealed = OpenMlsCrypto::hpke_seal(self, copy(config), pk, info, aad, pt).unwrap();
        (
            sealed.kem_output.as_slice().to_vec(),
            sealed.ciphertext.as_slice().to_vec(),
        )
    }
}

/// `HpkeConfig` is neither `Copy` nor `Clone`; its parts are.
fn copy(config: &HpkeConfig) -> HpkeConfig {
    HpkeConfig(config.0, config.1, config.2)
}

fn each_provider(mut test: impl FnMut(&str, &dyn Crypto)) {
    test(
        "libcrux",
        &openmls_libcrux_crypto::CryptoProvider::new().unwrap(),
    );
    test("rust-crypto", &openmls_rust_crypto::RustCrypto::default());
}

#[test]
fn ed25519_rfc8032_tests_1_to_3() {
    let cases = [
        (
            "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
            "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
            "",
            "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155\
             5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
        ),
        (
            "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
            "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
            "72",
            "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da\
             085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00",
        ),
        (
            "c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7",
            "fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025",
            "af82",
            "6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac\
             18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a",
        ),
    ];
    each_provider(|name, crypto| {
        for (secret, public, message, signature) in cases {
            let (secret, public, message, signature) =
                (h(secret), h(public), h(message), h(signature));
            assert_eq!(crypto.sign(&message, &secret), signature, "{name}");
            assert!(crypto.verify(&message, &public, &signature), "{name}");
            let mut forged = signature.clone();
            forged[0] ^= 1;
            assert!(!crypto.verify(&message, &public, &forged), "{name}");
            assert!(!crypto.verify(b"other", &public, &signature), "{name}");
        }
    });
}

/// X25519 through the HPKE backend each provider links (its `DhKem25519` key agreement).
/// A backend's name, its X25519 function, and its public key from a secret.
type X25519Backend = (
    &'static str,
    fn(&[u8], &[u8]) -> Vec<u8>,
    fn(&[u8]) -> Vec<u8>,
);

fn x25519_backends() -> [X25519Backend; 2] {
    [
        (
            "libcrux",
            |pk, sk| HpkeLibcrux::dh(KemAlgorithm::DhKem25519, pk, sk).unwrap(),
            |sk| HpkeLibcrux::secret_to_public(KemAlgorithm::DhKem25519, sk).unwrap(),
        ),
        (
            "rust-crypto",
            |pk, sk| HpkeRustCrypto::dh(KemAlgorithm::DhKem25519, pk, sk).unwrap(),
            |sk| HpkeRustCrypto::secret_to_public(KemAlgorithm::DhKem25519, sk).unwrap(),
        ),
    ]
}

#[test]
fn x25519_rfc7748_sections_5_2_and_6_1() {
    for (name, dh, public) in x25519_backends() {
        // Section 5.2: scalar multiplication.
        for (scalar, u, out) in [
            (
                "a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4",
                "e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c",
                "c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552",
            ),
            (
                "4b66e9d4d1b4673c5ad22691957d6af5c11b6421e0ea01d42ca4169e7918ba0d",
                "e5210f12786811d3f4b7959d0538ae2c31dbe7106fc03c3efc4cd549c715a493",
                "95cbde9476e8907d7aade45cb4b873f88b595a68799fa152e6f8f7647aac7957",
            ),
        ] {
            assert_eq!(dh(&h(u), &h(scalar)), h(out), "{name}");
        }
        // Section 5.2: one and a thousand iterations from k = u = 9.
        let mut k = vec![0u8; 32];
        k[0] = 9;
        let mut u = k.clone();
        for iteration in 1..=1000 {
            let next = dh(&u, &k);
            u = std::mem::replace(&mut k, next);
            if iteration == 1 {
                assert_eq!(
                    k,
                    h("422c8e7a6227d7bca1350b3e2bb7279f7897b87bb6854b783c60e80311ae3079"),
                    "{name}"
                );
            }
        }
        assert_eq!(
            k,
            h("684cf59ba83309552800ef566f2f4d3c1c3887c49360e3875f2eb94d99532c51"),
            "{name}"
        );
        // Section 6.1: Diffie-Hellman.
        let a = h("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a");
        let b = h("5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb");
        let a_public = h("8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a");
        let b_public = h("de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f");
        let shared = h("4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742");
        assert_eq!(public(&a), a_public, "{name}");
        assert_eq!(public(&b), b_public, "{name}");
        assert_eq!(dh(&b_public, &a), shared, "{name}");
        assert_eq!(dh(&a_public, &b), shared, "{name}");
    }
}

#[test]
fn hpke_rfc9180_a1_base_mode() {
    let config = HpkeConfig(
        HpkeKemType::DhKem25519,
        HpkeKdfType::HkdfSha256,
        HpkeAeadType::AesGcm128,
    );
    let info = h("4f6465206f6e2061204772656369616e2055726e");
    let enc = h("37fda3567bdbd628e88668c3c8d7e97d1d1253b6d4ea6d44c150f741f1bf4431");
    let sk_r = h("4612c550263fc8ad58375df3f557aac531d26850903e55a9f23f21d8534e8ac8");
    each_provider(|name, crypto| {
        // DeriveKeyPair for the ephemeral and the recipient key.
        let (sk_e, pk_e) = crypto.derive(
            &config,
            &h("7268600d403fce431561aef583ee1613527cff655c1343f29812e66706df3234"),
        );
        assert_eq!(
            sk_e,
            h("52c4a758a802cd8b936eceea314432798d5baf2d7e9235dc084ab1b9cfa2f736"),
            "{name}"
        );
        assert_eq!(pk_e, enc, "{name}");
        let (sk, pk_r) = crypto.derive(
            &config,
            &h("6db9df30aa07dd42ee5e8181afdb977e538f5e1fec8a06223f33f7013e525037"),
        );
        assert_eq!(sk, sk_r, "{name}");
        assert_eq!(
            pk_r,
            h("3948cfe0ad1ddb695d780e59077195da6c56506b027329794ab02bca80815c4d"),
            "{name}"
        );

        // The single-shot open is the context's first (sequence 0) decryption.
        let pt = crypto.hpke_open(&config,
            &enc,
            &h("f938558b5d72f1a23810b4be2ab4f84331acc02fc97babc53a52ae8218a355a96d8770ac83d07bea87e13c512a"),
            &sk_r,
            &info,
            &h("436f756e742d30"),
        );
        assert_eq!(
            pt,
            h("4265617574792069732074727574682c20747275746820626561757479"),
            "{name}"
        );

        for (context, exported) in [
            (
                "",
                "3853fe2b4035195a573ffc53856e77058e15d9ea064de3e59f4961d0095250ee",
            ),
            (
                "00",
                "2e8f0b54673c7029649d4eb9d5e33bf1872cf76d623ff164ac185da9e88c21a5",
            ),
            (
                "54657374436f6e74657874",
                "e9e43065102c3836401bed8c3c3c75ae46be1639869391d62c61f1ec7af54931",
            ),
        ] {
            assert_eq!(
                crypto.hpke_export(&config, &enc, &sk_r, &info, &h(context), 32),
                h(exported),
                "{name}"
            );
        }
    });
}

#[test]
fn hkdf_sha256_rfc5869_a1_to_a3() {
    let cases = [
        (
            "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b",
            "000102030405060708090a0b0c",
            "f0f1f2f3f4f5f6f7f8f9",
            "077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5",
            "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865",
        ),
        (
            "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f\
             202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f\
             404142434445464748494a4b4c4d4e4f",
            "606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f\
             808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f\
             a0a1a2a3a4a5a6a7a8a9aaabacadaeaf",
            "b0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcecf\
             d0d1d2d3d4d5d6d7d8d9dadbdcdddedfe0e1e2e3e4e5e6e7e8e9eaebecedeeef\
             f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff",
            "06a6b88c5853361a06104c9ceb35b45cef760014904671014a193f40c15fc244",
            "b11e398dc80327a1c8e7f78c596a49344f012eda2d4efad8a050cc4c19afa97c\
             59045a99cac7827271cb41c65e590e09da3275600c2f09b8367793a9aca3db71\
             cc30c58179ec3e87c14c01d5c1f3434f1d87",
        ),
        (
            "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b",
            "",
            "",
            "19ef24a32c717b167f33a91d6f648bdf96596776afdb6377ac434c1c293ccb04",
            "8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8",
        ),
    ];
    each_provider(|name, crypto| {
        for (ikm, salt, info, prk, okm) in cases {
            let okm = h(okm);
            assert_eq!(
                crypto.hkdf(&h(salt), &h(ikm), &h(info), okm.len()),
                (h(prk), okm),
                "{name}"
            );
        }
    });
}

#[test]
fn hmac_sha256_rfc4231() {
    let big_key = "aa".repeat(131);
    let cases = [
        ("0b".repeat(20), "4869205468657265".to_string(), "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"),
        ("4a656665".to_string(), "7768617420646f2079612077616e7420666f72206e6f7468696e673f".to_string(), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"),
        ("aa".repeat(20), "dd".repeat(50), "773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe"),
        ("0102030405060708090a0b0c0d0e0f10111213141516171819".to_string(), "cd".repeat(50), "82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b"),
        (big_key.clone(), "54657374205573696e67204c6172676572205468616e20426c6f636b2d53697a65204b6579202d2048617368204b6579204669727374".to_string(), "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"),
        (big_key, hex::encode("This is a test using a larger than block-size key and a larger than block-size data. The key needs to be hashed before being used by the HMAC algorithm."), "9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2"),
    ];
    each_provider(|name, crypto| {
        for (key, data, mac) in &cases {
            assert_eq!(crypto.hmac(&h(key), &h(data)), h(mac), "{name}");
        }
        // Test case 5 checks the first 128 bits.
        let truncated = crypto.hmac(&h(&"0c".repeat(20)), b"Test With Truncation");
        assert_eq!(
            truncated[..16],
            h("a3b6167473100ee06e0c796c2955552b"),
            "{name}"
        );
    });
}

#[derive(Deserialize)]
struct WycheproofFile {
    tests: Vec<WycheproofTest>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WycheproofTest {
    tc_id: u32,
    key: String,
    iv: String,
    aad: String,
    msg: String,
    ct: String,
    tag: String,
    result: String,
}

#[test]
fn aes_gcm_wycheproof_96_bit_nonces() {
    use aes_gcm::aead::{Aead, KeyInit, Payload};

    let file: WycheproofFile =
        serde_json::from_str(include_str!("vectors/aes_gcm_wycheproof.json")).unwrap();
    assert_eq!(file.tests.len(), 133);
    each_provider(|name, crypto| {
        for test in &file.tests {
            let (key, iv, aad, msg) = (h(&test.key), h(&test.iv), h(&test.aad), h(&test.msg));
            let mut sealed = h(&test.ct);
            sealed.extend(h(&test.tag));
            let alg = if key.len() == 16 {
                AeadType::Aes128Gcm
            } else {
                AeadType::Aes256Gcm
            };
            let opened = crypto.open(alg, &key, &sealed, &iv, &aad);
            if test.result == "valid" {
                assert_eq!(
                    opened.as_deref(),
                    Some(msg.as_slice()),
                    "{name} {}",
                    test.tc_id
                );
                assert_eq!(
                    crypto.seal(alg, &key, &msg, &iv, &aad),
                    sealed,
                    "{name} {}",
                    test.tc_id
                );
            } else {
                assert_eq!(opened, None, "{name} {}", test.tc_id);
            }
        }
    });
    // The `aes-gcm` crate the attachments use.
    for test in file.tests.iter().filter(|t| t.key.len() == 64) {
        let mut sealed = h(&test.ct);
        sealed.extend(h(&test.tag));
        let cipher = aes_gcm::Aes256Gcm::new_from_slice(&h(&test.key)).unwrap();
        let aad = h(&test.aad);
        let opened = cipher.decrypt(
            aes_gcm::Nonce::from_slice(&h(&test.iv)),
            Payload {
                msg: &sealed,
                aad: &aad,
            },
        );
        assert_eq!(
            opened.ok(),
            (test.result == "valid").then(|| h(&test.msg)),
            "aes-gcm {}",
            test.tc_id
        );
    }
}

#[derive(Deserialize)]
struct XWingFile {
    tests: Vec<XWingTest>,
}

#[derive(Deserialize)]
struct XWingTest {
    seed: String,
    sk: String,
    pk: String,
    ct: String,
    ss: String,
}

type KemBackend = (
    &'static str,
    fn(KemAlgorithm, &[u8]) -> (Vec<u8>, Vec<u8>),
    fn(KemAlgorithm, &[u8], &[u8]) -> Vec<u8>,
);

fn kem_backends() -> [KemBackend; 2] {
    [
        (
            "libcrux",
            |alg, seed| HpkeLibcrux::kem_key_gen_derand(alg, seed).unwrap(),
            |alg, ct, sk| HpkeLibcrux::kem_decaps(alg, ct, sk).unwrap(),
        ),
        (
            "rust-crypto",
            |alg, seed| HpkeRustCrypto::kem_key_gen_derand(alg, seed).unwrap(),
            |alg, ct, sk| HpkeRustCrypto::kem_decaps(alg, ct, sk).unwrap(),
        ),
    ]
}

/// The vector's key pair from its seed, and its ciphertext decapsulated with its secret key. The
/// HPKE API cannot take the vector's encapsulation randomness, so encapsulation is checked as a
/// property instead: what one provider encapsulates, both decapsulate to the same secret.
#[test]
fn xwing_draft_vectors_through_both_hpke_backends() {
    let file: XWingFile = serde_json::from_str(include_str!("vectors/xwing.json")).unwrap();
    assert_eq!(file.tests.len(), 3);
    for (name, keygen, decaps) in kem_backends() {
        for test in &file.tests {
            let (pk, sk) = keygen(KemAlgorithm::XWingDraft06, &h(&test.seed));
            assert_eq!(pk, h(&test.pk), "{name}");
            assert_eq!(sk, h(&test.sk), "{name}");
            assert_eq!(
                decaps(KemAlgorithm::XWingDraft06, &h(&test.ct), &sk),
                h(&test.ss),
                "{name}"
            );
        }
    }

    let config = HpkeConfig(
        HpkeKemType::XWingKemDraft6,
        HpkeKdfType::HkdfSha256,
        HpkeAeadType::AesGcm128,
    );
    let mut sealed_by = vec![];
    each_provider(|name, crypto| {
        let (sk, pk) = crypto.derive(&config, &[7; 32]);
        assert_eq!(pk.len(), 1216, "{name}");
        sealed_by.push((
            sk,
            pk.clone(),
            crypto.hpke_seal(&config, &pk, b"info", b"aad", b"x-wing"),
        ));
    });
    let derived = &sealed_by[0];
    assert_eq!(
        derived.1, sealed_by[1].1,
        "both providers derive the same X-Wing key pair"
    );
    each_provider(|name, crypto| {
        for (sk, _, (enc, ct)) in &sealed_by {
            assert_eq!(enc.len(), 1120, "{name}");
            assert_eq!(
                crypto.hpke_open(&config, enc, ct, sk, b"info", b"aad"),
                b"x-wing",
                "{name}"
            );
        }
    });
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AcvpFile {
    key_gen: Vec<AcvpKeyGen>,
    encapsulation: Vec<AcvpEncaps>,
    decapsulation: Vec<AcvpDecaps>,
}

#[derive(Deserialize)]
struct AcvpKeyGen {
    d: String,
    z: String,
    ek: String,
    dk: String,
}

#[derive(Deserialize)]
struct AcvpEncaps {
    ek: String,
    m: String,
    c: String,
    k: String,
}

#[derive(Deserialize)]
struct AcvpDecaps {
    dk: String,
    c: String,
    k: String,
}

#[test]
fn ml_kem_768_acvp_through_libcrux() {
    use libcrux_ml_kem::mlkem768;

    let file: AcvpFile =
        serde_json::from_str(include_str!("vectors/ml_kem_768_acvp.json")).unwrap();
    for test in &file.key_gen {
        let mut seed = h(&test.d);
        seed.extend(h(&test.z));
        let pair = mlkem768::generate_key_pair(seed.try_into().unwrap());
        assert_eq!(pair.pk().as_slice(), h(&test.ek).as_slice());
        assert_eq!(pair.sk().as_slice(), h(&test.dk).as_slice());
    }
    for test in &file.encapsulation {
        let ek = mlkem768::MlKem768PublicKey::try_from(h(&test.ek).as_slice()).unwrap();
        let (c, k) = mlkem768::encapsulate(&ek, h(&test.m).try_into().unwrap());
        assert_eq!(c.as_slice(), h(&test.c).as_slice());
        assert_eq!(k.as_slice(), h(&test.k).as_slice());
    }
    for test in &file.decapsulation {
        let dk = mlkem768::MlKem768PrivateKey::try_from(h(&test.dk).as_slice()).unwrap();
        let c = mlkem768::MlKem768Ciphertext::try_from(h(&test.c).as_slice()).unwrap();
        assert_eq!(
            mlkem768::decapsulate(&dk, &c).as_slice(),
            h(&test.k).as_slice()
        );
    }
}

#[test]
#[allow(deprecated)]
fn ml_kem_768_acvp_through_rust_crypto() {
    use ml_kem::kem::{Decapsulate, KeyExport};
    use ml_kem::{DecapsulationKey768, EncapsulationKey768, ExpandedKeyEncoding};

    let file: AcvpFile =
        serde_json::from_str(include_str!("vectors/ml_kem_768_acvp.json")).unwrap();
    for test in &file.key_gen {
        let mut seed = h(&test.d);
        seed.extend(h(&test.z));
        let dk = DecapsulationKey768::from_seed(seed.as_slice().try_into().unwrap());
        assert_eq!(
            dk.encapsulation_key().to_bytes().as_slice(),
            h(&test.ek).as_slice()
        );
        assert_eq!(dk.to_expanded_bytes().as_slice(), h(&test.dk).as_slice());
    }
    for test in &file.encapsulation {
        let ek = EncapsulationKey768::new(h(&test.ek).as_slice().try_into().unwrap()).unwrap();
        let (c, k) = ek.encapsulate_deterministic(h(&test.m).as_slice().try_into().unwrap());
        assert_eq!(c.as_slice(), h(&test.c).as_slice());
        assert_eq!(k.as_slice(), h(&test.k).as_slice());
    }
    for test in &file.decapsulation {
        let dk =
            DecapsulationKey768::from_expanded(h(&test.dk).as_slice().try_into().unwrap()).unwrap();
        let c = h(&test.c);
        assert_eq!(
            dk.decapsulate(c.as_slice().try_into().unwrap()).as_slice(),
            h(&test.k).as_slice()
        );
    }
}
