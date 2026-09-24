use soroban_sdk::{xdr::ToXdr, Address, BytesN, Env};

/// Extracts the raw 32 bytes behind an `Address`.
///
/// The `registration_digest` is defined over binary keys (see `digest.rs`), but
/// an entry point receives an `Address`, which deliberately hides its
/// representation. The supported way across is XDR.
///
/// Note that `Address::to_xdr` emits an `ScVal`, not a bare `ScAddress`, so
/// there is an extra 4-byte discriminant in front. Measured, not assumed — see
/// `test::address_to_bytes_matches_the_strkey_decoder`:
///
/// ```text
/// account  (G...)  ScVal(4) + ScAddressType(4) + PublicKeyType(4) + 32 = 44
/// contract (C...)  ScVal(4) + ScAddressType(4) +                    32 = 40
/// ```
///
/// Taking the last 32 bytes covers both without parsing the discriminants, and
/// the length check is what rejects any other `ScAddress` variant (muxed
/// accounts, liquidity pools, claimable balances) rather than silently hashing
/// the wrong slice.
pub fn address_to_bytes(env: &Env, address: &Address) -> BytesN<32> {
    let xdr = address.clone().to_xdr(env);
    let len = xdr.len();

    if len != 44 && len != 40 {
        panic!("unsupported address type: expected an account or contract address");
    }

    let mut raw = [0u8; 32];
    xdr.slice((len - 32)..len).copy_into_slice(&mut raw);
    BytesN::from_array(env, &raw)
}
