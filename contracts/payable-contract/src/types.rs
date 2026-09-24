use soroban_sdk::{contracterror, contracttype, Address, BytesN, Vec};

/// Lifecycle states the *gate* cares about. Deliberately not the full off-chain
/// machine of `Pakta_Arquitectura_Flujo.md` §8: `BLOCKED`, `RESOLUTION_PENDING`
/// and `REVALIDATING` are kernel decisions, and mirroring them on-chain would
/// cost a transaction each while adding nothing the contract enforces
/// (`Pakta_Plan_Implementacion.md` §2.5). They travel as events instead.
#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Ready = 0,
    Settled = 1,
    Expired = 2,
    Revoked = 3,
}

/// Minimal on-chain state, per `Pakta_Documento_Maestro.md` §19.1.
///
/// `payer` is absent on purpose: it lives in `Config`, because who funds a
/// settlement is a property of the deployment, not of an individual payable.
#[contracttype]
#[derive(Clone)]
pub struct Payable {
    pub proof_hash: BytesN<32>,
    pub recipient: Address,
    pub amount: i128,
    pub policy_hash: BytesN<32>,
    pub expiry: u64,
    pub status: Status,
}

/// One issuer's attestation. The public key travels with the signature so that
/// the contract counts *distinct authorized issuers*, not just signature
/// count — otherwise the same issuer could satisfy a threshold on its own
/// (`Pakta_Division_Trabajo.md` §4).
#[contracttype]
#[derive(Clone)]
pub struct IssuerSignature {
    pub issuer: BytesN<32>,
    pub signature: BytesN<64>,
}

/// Rolling spend cap. Kept in its own storage entry rather than inside
/// `Config` so that changing the limits cannot reset the spend already
/// recorded in the active window.
#[contracttype]
#[derive(Clone)]
pub struct SpendWindow {
    pub started_at: u64,
    pub spent: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub admin: Address,
    /// Ed25519 public keys allowed to attest a proof. MVP runs with one, but
    /// the shape is already k-of-n so `Pakta_Documento_Maestro.md` §19.3's
    /// multi-attestor roadmap is a configuration change, not a redeploy.
    pub issuers: Vec<BytesN<32>>,
    pub threshold: u32,
    /// SHA-256 of the network passphrase. Stored because Soroban gives a
    /// contract no way to read the network it is running on, and the
    /// registration digest has to bind it.
    pub network_id: BytesN<32>,
    /// The asset's Stellar Asset Contract.
    pub asset: Address,
    /// Where the money actually leaves from — the single knob that decides the
    /// custody model (`Pakta_Plan_Implementacion.md` §2.5):
    ///
    /// - set to this contract's own address: the vault model. The contract
    ///   transfers from its own funded balance, no human signature per payment.
    /// - set to an external treasury account: that account's signature is
    ///   required on every `settle`, because `transfer` calls `require_auth` on
    ///   its `from`.
    ///
    /// Both are the same code path. The decision is a deployment parameter,
    /// which is why it does not block building the gate.
    pub payer: Address,
    /// Who may call `settle`. Without this, anyone could trigger a payment and
    /// bypass the off-chain revalidation of §14.3.
    pub executor: Address,
    pub max_per_payable: i128,
    pub window_seconds: u64,
    pub max_per_window: i128,
    pub paused: bool,
}

#[contracttype]
pub enum DataKey {
    Config,
    Window,
    Payable(BytesN<32>),
}

#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Paused = 3,
    PayableAlreadyExists = 4,
    PayableNotFound = 5,
    NotReady = 6,
    ProofExpired = 7,
    ProofNotExpired = 8,
    AmountNotPositive = 9,
    AmountAboveCap = 10,
    WindowCapExceeded = 11,
    ThresholdNotMet = 12,
    UnknownIssuer = 13,
    DuplicateIssuer = 14,
    InvalidThreshold = 15,
    InvalidExpiry = 16,
    InvalidLimits = 17,
    UnknownPhase = 18,
}
