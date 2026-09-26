use super::hex32;
use crate::digest::{registration_digest, registration_preimage, RegistrationFields, PREIMAGE_LEN};
use soroban_sdk::Env;

/// The same vector asserted by `@pakta/proof-hash`'s `registrationDigest.test.ts`.
/// Every identifier is real and comes from `deployments/testnet.json`.
///
/// If this test and the TypeScript one ever disagree, the issuer signs one
/// message and the contract checks another — which is exactly the failure that
/// would otherwise only show up as an unexplained rejected settlement.
fn demo_fields(env: &Env) -> RegistrationFields {
    RegistrationFields {
        network_id: hex32(
            env,
            "cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472",
        ),
        contract_id: hex32(
            env,
            "7a609a4401edb85ab95eba1853dfd30e5fd0310187c78373ed7bf8c1df5b1493",
        ),
        payable_id_hash: hex32(
            env,
            "9ad58d1bb77a22e8944cbd6f92965ee2e987772a1389e856d567b69346206ca5",
        ),
        proof_hash: hex32(
            env,
            "0218cfa6ab5a1bee3ae8827f94037542745abca1f1e69711c1961e37014043a4",
        ),
        recipient: hex32(
            env,
            "ac7a886b85a277de892ca4cd27cf2168758c39ffef1b419d603745e198c6d5f2",
        ),
        asset_contract_id: hex32(
            env,
            "19866c51f619ec6df447dac0a53b91ed450caf88b82feb4e75f26de6942db717",
        ),
        amount: 80_000_000_000,
        policy_hash: hex32(
            env,
            "368b8ba646b0e0cc299db9c59f94015b605d859e0a636d61221228d2ca59f893",
        ),
        expiry: 1_790_359_200,
    }
}

#[test]
fn preimage_is_261_bytes() {
    let env = Env::default();
    let preimage = registration_preimage(&env, &demo_fields(&env));
    assert_eq!(preimage.len(), PREIMAGE_LEN);
}

#[test]
fn preimage_matches_the_typescript_vector() {
    let env = Env::default();
    let preimage = registration_preimage(&env, &demo_fields(&env));

    // Spot-check the field boundaries the encoding table fixes, rather than
    // only the final hash — a wrong hash alone would not say where it drifted.
    assert_eq!(
        preimage.slice(0..12),
        soroban_sdk::Bytes::from_slice(&env, b"PAKTA_REG_V1")
    );
    assert_eq!(preimage.get(12).unwrap(), 0x00);

    let network_id = preimage.slice(13..45);
    assert_eq!(
        network_id,
        hex32(
            &env,
            "cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472"
        )
        .into()
    );

    let proof_hash = preimage.slice(109..141);
    assert_eq!(
        proof_hash,
        hex32(
            &env,
            "0218cfa6ab5a1bee3ae8827f94037542745abca1f1e69711c1961e37014043a4"
        )
        .into()
    );

    // 80_000_000_000 as i128 big endian.
    let amount = preimage.slice(205..221);
    assert_eq!(
        amount,
        soroban_sdk::Bytes::from_slice(&env, &80_000_000_000i128.to_be_bytes())
    );

    // 1_790_359_200 as u64 big endian.
    let expiry = preimage.slice(253..261);
    assert_eq!(
        expiry,
        soroban_sdk::Bytes::from_slice(&env, &1_790_359_200u64.to_be_bytes())
    );
}

#[test]
fn digest_matches_the_typescript_vector() {
    let env = Env::default();
    let digest = registration_digest(&env, &demo_fields(&env));
    assert_eq!(
        digest,
        hex32(
            &env,
            "9d6457ba4beb977d7a27a3106a0ef4dc55673b9718dbbb2e05e411c2764233db"
        )
    );
}

#[test]
fn every_field_is_bound_by_the_digest() {
    let env = Env::default();
    let baseline = registration_digest(&env, &demo_fields(&env));
    let other = hex32(
        &env,
        "1111111111111111111111111111111111111111111111111111111111111111",
    );

    let mutated = [
        RegistrationFields {
            network_id: other.clone(),
            ..demo_fields(&env)
        },
        RegistrationFields {
            contract_id: other.clone(),
            ..demo_fields(&env)
        },
        RegistrationFields {
            payable_id_hash: other.clone(),
            ..demo_fields(&env)
        },
        RegistrationFields {
            proof_hash: other.clone(),
            ..demo_fields(&env)
        },
        RegistrationFields {
            recipient: other.clone(),
            ..demo_fields(&env)
        },
        RegistrationFields {
            asset_contract_id: other.clone(),
            ..demo_fields(&env)
        },
        RegistrationFields {
            policy_hash: other.clone(),
            ..demo_fields(&env)
        },
        RegistrationFields {
            amount: 80_000_000_001,
            ..demo_fields(&env)
        },
        RegistrationFields {
            expiry: 1_790_359_201,
            ..demo_fields(&env)
        },
    ];

    for fields in mutated.iter() {
        assert_ne!(
            registration_digest(&env, fields),
            baseline,
            "a field changed without changing the digest — the signature would not bind it"
        );
    }
}

#[test]
fn address_to_bytes_matches_the_strkey_decoder() {
    use crate::address_bytes::address_to_bytes;
    use soroban_sdk::Address;

    let env = Env::default();

    // VEN-004 from fixtures/stellar-testnet-addresses.json. The expected bytes
    // are what @pakta/stellar-sdk-wrapper's decodeAccountId() produces, so this
    // is the other half of the parity: TS decodes the strkey, the contract
    // extracts from XDR, and both must land on the same 32 bytes.
    let account = Address::from_str(
        &env,
        "GCWHVCDLQWRHPXUJFSSM2J6PEFUHLDBZ77XRWQM5MA3ULYMYY3K7EPNO",
    );
    assert_eq!(
        address_to_bytes(&env, &account),
        hex32(
            &env,
            "ac7a886b85a277de892ca4cd27cf2168758c39ffef1b419d603745e198c6d5f2"
        )
    );

    // The USDC SAC from deployments/testnet.json — a contract address, whose
    // XDR is 4 bytes shorter than an account's.
    let contract = Address::from_str(
        &env,
        "CAMYM3CR6YM6Y3PUI7NMBJJ3SHWUKDFPRC4C722OOXZG3ZUUFW3ROF5P",
    );
    assert_eq!(
        address_to_bytes(&env, &contract),
        hex32(
            &env,
            "19866c51f619ec6df447dac0a53b91ed450caf88b82feb4e75f26de6942db717"
        )
    );
}

/// Same vector as `@pakta/proof-hash`'s revocation test. Separate domain from
/// the registration digest, which is what stops a signature that authorized a
/// payment from also authorizing its cancellation.
#[test]
fn revocation_digest_matches_the_typescript_vector() {
    use crate::digest::{
        reason_hash, revocation_digest, revocation_preimage, RevocationFields,
        REVOCATION_PREIMAGE_LEN,
    };

    let env = Env::default();
    let fields = RevocationFields {
        network_id: hex32(
            &env,
            "cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472",
        ),
        contract_id: hex32(
            &env,
            "7a609a4401edb85ab95eba1853dfd30e5fd0310187c78373ed7bf8c1df5b1493",
        ),
        payable_id_hash: hex32(
            &env,
            "9ad58d1bb77a22e8944cbd6f92965ee2e987772a1389e856d567b69346206ca5",
        ),
        proof_hash: hex32(
            &env,
            "0218cfa6ab5a1bee3ae8827f94037542745abca1f1e69711c1961e37014043a4",
        ),
        reason_hash: reason_hash(
            &env,
            &soroban_sdk::String::from_str(&env, "VENDOR_WALLET_CHANGED"),
        ),
    };

    // SHA-256("VENDOR_WALLET_CHANGED"), matching Node's crypto.
    assert_eq!(
        fields.reason_hash,
        hex32(
            &env,
            "47427270812d52a0310f8f2513800a3112878a0cce7c40a28ade645424af3624"
        )
    );
    assert_eq!(
        revocation_preimage(&env, &fields).len(),
        REVOCATION_PREIMAGE_LEN
    );
    assert_eq!(
        revocation_digest(&env, &fields),
        hex32(
            &env,
            "795f6762ec74115526849f4d61ff677148e8fc9fe8161990e71917613a15c387"
        )
    );
}

#[test]
fn the_two_digests_never_collide() {
    use crate::digest::{revocation_digest, RevocationFields};

    let env = Env::default();
    let registration = registration_digest(&env, &demo_fields(&env));
    let revocation = revocation_digest(
        &env,
        &RevocationFields {
            network_id: demo_fields(&env).network_id,
            contract_id: demo_fields(&env).contract_id,
            payable_id_hash: demo_fields(&env).payable_id_hash,
            proof_hash: demo_fields(&env).proof_hash,
            reason_hash: demo_fields(&env).proof_hash,
        },
    );
    assert_ne!(registration, revocation);
}

/// Same vector as `@pakta/proof-hash`'s attestation test.
#[test]
fn attestation_digest_matches_the_typescript_vector() {
    use crate::digest::{
        attestation_digest, attestation_preimage, reason_hash, AttestationFields,
        ATTESTATION_PREIMAGE_LEN,
    };

    let env = Env::default();
    let fields = AttestationFields {
        network_id: demo_fields(&env).network_id,
        contract_id: demo_fields(&env).contract_id,
        payable_id_hash: demo_fields(&env).payable_id_hash,
        phase: 0,
        reason_hash: reason_hash(
            &env,
            &soroban_sdk::String::from_str(&env, "VENDOR_WALLET_CHANGED"),
        ),
        sequence: 1,
    };

    let preimage = attestation_preimage(&env, &fields);
    assert_eq!(preimage.len(), ATTESTATION_PREIMAGE_LEN);
    assert_eq!(preimage.get(109).unwrap(), 0);
    assert_eq!(
        attestation_digest(&env, &fields),
        hex32(
            &env,
            "7dea7c29a2950c5cf6e2748f9ba149a5522a979ea5dfd788db8902440da71fe9"
        )
    );
}
