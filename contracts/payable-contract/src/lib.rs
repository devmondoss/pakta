#![no_std]

use soroban_sdk::{
    contract, contractimpl, symbol_short, token, Address, BytesN, Env, String, Symbol, Vec,
};

pub mod address_bytes;
pub mod digest;
pub mod events;
pub mod types;

use address_bytes::address_to_bytes;
use digest::{
    attestation_digest, reason_hash, registration_digest, revocation_digest, AttestationFields,
    RegistrationFields, RevocationFields,
};
use types::{Config, DataKey, Error, IssuerSignature, Payable, SpendWindow, Status};

/// How long a payable entry is kept alive, and when a touch renews it.
///
/// This is not housekeeping — it is the anti-replay guarantee. A `payable_id`
/// cannot be registered twice only for as long as its entry exists, so the
/// entry must outlive the proof's expiry by a wide margin
/// (`Pakta_Division_Trabajo.md` §4). At roughly 5 seconds per ledger this is about
/// thirty days of retention, renewed whenever the payable is touched with less
/// than a day left.
///
/// The margin is deliberate and the test `the_anti_replay_marker_outlives_the_
/// proof_it_guards` enforces it: an earlier value of seven days exactly matched
/// the longest proof window we intend to issue, which left no room at all for a
/// payable registered minutes before its proof expires.
pub const PAYABLE_TTL_LEDGERS: u32 = 518_400;
pub const PAYABLE_TTL_THRESHOLD: u32 = 17_280;
pub const INSTANCE_TTL_LEDGERS: u32 = 120_960;
pub const INSTANCE_TTL_THRESHOLD: u32 = 17_280;

/// Compile-time guard rather than a test, so that lowering the TTL below the
/// margin simply does not build. The anti-replay window has to outlast the
/// longest proof we intend to issue several times over; an earlier value
/// matched it exactly, which left no room for a payable registered minutes
/// before its proof expires.
const LONGEST_PROOF_WINDOW_SECONDS: u64 = 7 * 24 * 60 * 60;
const _: () = assert!(
    PAYABLE_TTL_LEDGERS as u64 * 5 >= LONGEST_PROOF_WINDOW_SECONDS * 4,
    "payable entries must outlive the proofs they guard by a wide margin"
);
const _: () = assert!(PAYABLE_TTL_THRESHOLD < PAYABLE_TTL_LEDGERS);

/// Phases accepted by `attest_lifecycle`.
const PHASE_BLOCKED: Symbol = symbol_short!("blocked");
const PHASE_RESOLVED: Symbol = symbol_short!("resolved");
const PHASE_RECONCIL: Symbol = symbol_short!("reconcil");

/// The settlement gate.
///
/// The invariant that gives the whole product its argument: **no function that
/// moves money takes a recipient or an amount**. `settle` takes a
/// `payable_id` and nothing else; the destination and the sum are read from
/// state that an authorized issuer signed at registration time. A compromised
/// adapter, a confused agent or a prompt injection can ask for the wrong
/// payable to be paid — none of them can ask for the wrong *wallet* to be paid.
#[contract]
pub struct PayableContract;

#[contractimpl]
impl PayableContract {
    pub fn contract_version() -> u32 {
        4
    }

    #[allow(clippy::too_many_arguments)]
    pub fn initialize(
        env: Env,
        admin: Address,
        issuers: Vec<BytesN<32>>,
        threshold: u32,
        network_id: BytesN<32>,
        asset: Address,
        payer: Address,
        treasury: Address,
        executor: Address,
        max_per_payable: i128,
        window_seconds: u64,
        max_per_window: i128,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        if threshold == 0 || threshold > issuers.len() {
            return Err(Error::InvalidThreshold);
        }
        if max_per_payable <= 0 || max_per_window <= 0 || window_seconds == 0 {
            return Err(Error::InvalidLimits);
        }

        admin.require_auth();

        env.storage().instance().set(
            &DataKey::Config,
            &Config {
                admin,
                issuers,
                threshold,
                network_id,
                asset,
                payer,
                treasury,
                executor,
                max_per_payable,
                window_seconds,
                max_per_window,
                paused: false,
            },
        );
        bump_instance(&env);
        Ok(())
    }

    /// Records an authorized obligation.
    ///
    /// Callable by anyone, on purpose: authority lives in the issuer
    /// signatures, not in the caller. The contract rebuilds the registration
    /// digest from these typed arguments plus its own configuration and
    /// verifies the signatures against *that*, so a caller cannot substitute
    /// a recipient or an amount and have a valid proof still apply
    /// (`Pakta_Division_Trabajo.md` §7).
    #[allow(clippy::too_many_arguments)]
    pub fn register_payable(
        env: Env,
        payable_id: BytesN<32>,
        proof_hash: BytesN<32>,
        recipient: Address,
        amount: i128,
        policy_hash: BytesN<32>,
        expiry: u64,
        signatures: Vec<IssuerSignature>,
    ) -> Result<(), Error> {
        let config = load_config(&env)?;
        if config.paused {
            return Err(Error::Paused);
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::Payable(payable_id.clone()))
        {
            // The anti-replay check. `payable_id` is the nonce: an id that has
            // been registered can never be registered again, settled or not.
            return Err(Error::PayableAlreadyExists);
        }
        if amount <= 0 {
            return Err(Error::AmountNotPositive);
        }
        if amount > config.max_per_payable {
            return Err(Error::AmountAboveCap);
        }
        if expiry <= env.ledger().timestamp() {
            return Err(Error::InvalidExpiry);
        }
        // The anti-replay retention is sized against this ceiling (see the
        // const assert above). Enforcing it here turns that sizing from an
        // assumption about what issuers will sign into a guarantee.
        if expiry - env.ledger().timestamp() > LONGEST_PROOF_WINDOW_SECONDS {
            return Err(Error::ProofWindowTooLong);
        }
        // Refuse to authorize an obligation the vault cannot actually honour.
        // Without this the gate would happily promise more than it holds and
        // the shortfall would only surface at settle time, on whichever
        // payable happened to run last.
        if is_vault(&env, &config) && amount > available(&env, &config) {
            return Err(Error::InsufficientAvailable);
        }

        let fields = RegistrationFields {
            network_id: config.network_id.clone(),
            contract_id: address_to_bytes(&env, &env.current_contract_address()),
            payable_id_hash: payable_id.clone(),
            proof_hash: proof_hash.clone(),
            recipient: address_to_bytes(&env, &recipient),
            asset_contract_id: address_to_bytes(&env, &config.asset),
            amount,
            policy_hash: policy_hash.clone(),
            expiry,
        };
        verify_issuer_signatures(
            &env,
            &config,
            &registration_digest(&env, &fields),
            &signatures,
        )?;

        env.storage().persistent().set(
            &DataKey::Payable(payable_id.clone()),
            &Payable {
                proof_hash: proof_hash.clone(),
                recipient: recipient.clone(),
                amount,
                policy_hash,
                expiry,
                status: Status::Ready,
            },
        );
        bump_payable(&env, &payable_id);
        commit(&env, amount);

        events::PayableRegistered {
            payable_id: payable_id.clone(),
            proof_hash: proof_hash.clone(),
        }
        .publish(&env);
        events::PayableReady {
            payable_id,
            recipient,
            amount,
            expiry,
        }
        .publish(&env);
        Ok(())
    }

    /// Pays a registered payable. One argument, by design.
    pub fn settle(env: Env, payable_id: BytesN<32>) -> Result<(), Error> {
        let config = load_config(&env)?;
        if config.paused {
            return Err(Error::Paused);
        }
        config.executor.require_auth();

        let mut payable = load_payable(&env, &payable_id)?;
        if payable.status != Status::Ready {
            // Covers the double-settle case: a settled payable is no longer Ready.
            return Err(Error::NotReady);
        }
        if env.ledger().timestamp() > payable.expiry {
            return Err(Error::ProofExpired);
        }

        charge_window(&env, &config, payable.amount)?;

        token::Client::new(&env, &config.asset).transfer(
            &config.payer,
            &payable.recipient,
            &payable.amount,
        );

        payable.status = Status::Settled;
        env.storage()
            .persistent()
            .set(&DataKey::Payable(payable_id.clone()), &payable);
        bump_payable(&env, &payable_id);
        // The obligation is discharged, so it stops being committed. Note that
        // this does not free anything up: the balance fell by the same amount,
        // so `available` is unchanged. Only revoke and expire actually release.
        release(&env, payable.amount);

        events::SettlementExecuted {
            payable_id,
            recipient: payable.recipient,
            amount: payable.amount,
            proof_hash: payable.proof_hash,
        }
        .publish(&env);
        Ok(())
    }

    /// Closes out a payable whose proof has expired, and releases the funds it
    /// was holding.
    ///
    /// Permissionless by design, and that is a deliberate answer to a real
    /// problem rather than a convenience: an expired payable keeps its amount
    /// committed until somebody says so. A contract cannot notice time passing
    /// on its own — it only runs when invoked — so if expiry required an
    /// operator's authorization, a forgotten payable would hold the vault's
    /// float hostage indefinitely. Letting anyone reclaim it means the
    /// Settlement Agent, the indexer, or a vendor with an interest in the
    /// vault staying solvent can all do the cleanup.
    ///
    /// The tradeoff, stated plainly: `available` is only accurate once expired
    /// payables have actually been expired. Sweeping them is an operational
    /// duty, not something the chain does by itself.
    pub fn expire(env: Env, payable_id: BytesN<32>) -> Result<(), Error> {
        let payable = load_payable(&env, &payable_id)?;
        if payable.status != Status::Ready {
            return Err(Error::NotReady);
        }
        if env.ledger().timestamp() <= payable.expiry {
            return Err(Error::ProofNotExpired);
        }
        expire_ready(&env, &payable_id, payable);
        Ok(())
    }

    /// Sweeps several payables in one transaction and returns how many it
    /// actually expired.
    ///
    /// Anything not expirable - still live, already settled, revoked, or
    /// unknown - is skipped rather than failing the batch. A sweep is cleanup:
    /// one payable that settled a moment ago must not stop the rest from
    /// releasing their commitments.
    pub fn expire_batch(env: Env, payable_ids: Vec<BytesN<32>>) -> u32 {
        let now = env.ledger().timestamp();
        let mut expired = 0;
        for payable_id in payable_ids.iter() {
            let Some(payable) = env
                .storage()
                .persistent()
                .get::<_, Payable>(&DataKey::Payable(payable_id.clone()))
            else {
                continue;
            };
            if payable.status == Status::Ready && now > payable.expiry {
                expire_ready(&env, &payable_id, payable);
                expired += 1;
            }
        }
        expired
    }

    /// Invalidates a payable before it settles, and releases what it held.
    ///
    /// Exists because the off-chain revalidation of §14.3 is not a barrier the
    /// chain knows about: without it, evidence could go stale between
    /// registration and settlement and the gate would still pay.
    ///
    /// Authorized by an issuer signature, not by the admin. Whether the
    /// evidence behind a proof still holds is the issuer's judgement, and an
    /// Ed25519 verification key cannot `require_auth`, so the authorization
    /// takes the same shape as registration: a signed digest the contract
    /// recomputes. Its own domain keeps it from being interchangeable with a
    /// registration signature, `proof_hash` binds it to the exact registration
    /// it cancels, and the reason is signed too - so the justification the
    /// indexer records is the one the issuer gave, not whatever the submitter
    /// typed.
    ///
    /// One-way, and it cannot touch a settled payable. The worst a
    /// compromised issuer key achieves here is refusing to pay — never
    /// redirecting a payment.
    pub fn revoke_payable(
        env: Env,
        payable_id: BytesN<32>,
        reason_code: String,
        signatures: Vec<IssuerSignature>,
    ) -> Result<(), Error> {
        let config = load_config(&env)?;

        let mut payable = load_payable(&env, &payable_id)?;
        if payable.status != Status::Ready {
            return Err(Error::NotReady);
        }

        let digest = revocation_digest(
            &env,
            &RevocationFields {
                network_id: config.network_id.clone(),
                contract_id: address_to_bytes(&env, &env.current_contract_address()),
                payable_id_hash: payable_id.clone(),
                proof_hash: payable.proof_hash.clone(),
                reason_hash: reason_hash(&env, &reason_code),
            },
        );
        verify_issuer_signatures(&env, &config, &digest, &signatures)?;

        payable.status = Status::Revoked;
        env.storage()
            .persistent()
            .set(&DataKey::Payable(payable_id.clone()), &payable);
        bump_payable(&env, &payable_id);
        release(&env, payable.amount);

        events::PayableRevoked {
            payable_id,
            reason_code,
        }
        .publish(&env);
        Ok(())
    }

    /// Returns uncommitted float from the vault to the treasury.
    ///
    /// Without this the float is trapped: money put into the vault could only
    /// ever leave by paying a payable. The safety property is that it can
    /// never touch money already promised — `available = balance - committed`
    /// — and it can only ever send to the treasury address fixed at
    /// `initialize`, so holding the admin key does not mean being able to
    /// route funds anywhere.
    pub fn withdraw(env: Env, amount: i128) -> Result<(), Error> {
        let config = load_config(&env)?;
        config.admin.require_auth();

        if !is_vault(&env, &config) {
            return Err(Error::NotAVault);
        }
        if amount <= 0 {
            return Err(Error::AmountNotPositive);
        }
        if amount > available(&env, &config) {
            return Err(Error::WithdrawExceedsAvailable);
        }

        token::Client::new(&env, &config.asset).transfer(&config.payer, &config.treasury, &amount);

        events::VaultWithdrawn {
            treasury: config.treasury,
            amount,
        }
        .publish(&env);
        Ok(())
    }

    /// Total amount promised to payables that are still `READY`.
    pub fn get_committed(env: Env) -> i128 {
        committed(&env)
    }

    /// What `withdraw` may actually move right now: balance minus commitments.
    pub fn get_available(env: Env) -> Result<i128, Error> {
        let config = load_config(&env)?;
        Ok(available(&env, &config))
    }

    /// Relays an off-chain lifecycle fact — an exception raised, resolved or
    /// reconciled — to the ledger as an event, authorized by the issuer.
    ///
    /// Issuer-signed rather than admin-gated for the same reason revocation
    /// is: these are the issuer's testimonies, and the event is only worth
    /// anything if the issuer is the one who gave it. It emits and nothing
    /// else — it cannot change a payable's status — so even a compromised
    /// issuer key cannot use it to unblock money.
    ///
    /// Callable by anyone who holds a valid signature, like registration.
    pub fn attest_lifecycle(
        env: Env,
        payable_id: BytesN<32>,
        reason_code: String,
        phase: Symbol,
        sequence: u64,
        signatures: Vec<IssuerSignature>,
    ) -> Result<(), Error> {
        let config = load_config(&env)?;

        let phase_code: u8 = if phase == PHASE_BLOCKED {
            0
        } else if phase == PHASE_RESOLVED {
            1
        } else if phase == PHASE_RECONCIL {
            2
        } else {
            return Err(Error::UnknownPhase);
        };

        let digest = attestation_digest(
            &env,
            &AttestationFields {
                network_id: config.network_id.clone(),
                contract_id: address_to_bytes(&env, &env.current_contract_address()),
                payable_id_hash: payable_id.clone(),
                phase: phase_code,
                reason_hash: reason_hash(&env, &reason_code),
                sequence,
            },
        );
        verify_issuer_signatures(&env, &config, &digest, &signatures)?;

        match phase_code {
            0 => events::PayableBlocked {
                payable_id,
                reason_code,
                sequence,
            }
            .publish(&env),
            1 => events::ExceptionResolved {
                payable_id,
                reason_code,
                sequence,
            }
            .publish(&env),
            _ => events::PayableReconciled {
                payable_id,
                reason_code,
                sequence,
            }
            .publish(&env),
        }
        Ok(())
    }

    /// Replaces this contract's code while keeping its address and all of its
    /// state — payables, commitments, the spend window, configuration.
    ///
    /// Before v4 every change meant a new deployment: a new contract id to
    /// re-point every service at, a fresh `initialize`, and the float moved
    /// by hand. With this, the contract id is stable from here on.
    ///
    /// Admin-only. Worth being explicit that this is the most powerful key in
    /// the system: new code can do anything. It belongs in the same custody as
    /// the treasury, not on an application server.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), Error> {
        let config = load_config(&env)?;
        config.admin.require_auth();
        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());
        events::ContractUpgraded { new_wasm_hash }.publish(&env);
        Ok(())
    }

    /// Hands administration to a new address. Both the current and the new
    /// admin must authorize, so a typo cannot hand the gate to an address
    /// nobody controls — which, with no admin, would freeze it for good.
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        let mut config = load_config(&env)?;
        config.admin.require_auth();
        new_admin.require_auth();
        config.admin = new_admin.clone();
        env.storage().instance().set(&DataKey::Config, &config);
        bump_instance(&env);
        events::AdminChanged { new_admin }.publish(&env);
        Ok(())
    }

    /// Moves the withdrawal destination. Requires the *current treasury's*
    /// consent as well as the admin's: otherwise an admin key alone could
    /// point the treasury at itself and then withdraw, undoing the whole point
    /// of pinning the destination.
    pub fn set_treasury(env: Env, new_treasury: Address) -> Result<(), Error> {
        let mut config = load_config(&env)?;
        config.admin.require_auth();
        config.treasury.require_auth();
        config.treasury = new_treasury.clone();
        env.storage().instance().set(&DataKey::Config, &config);
        bump_instance(&env);
        events::TreasuryChanged { new_treasury }.publish(&env);
        Ok(())
    }

    pub fn get_payable(env: Env, payable_id: BytesN<32>) -> Option<Payable> {
        env.storage()
            .persistent()
            .get(&DataKey::Payable(payable_id))
    }

    pub fn get_config(env: Env) -> Result<Config, Error> {
        load_config(&env)
    }

    pub fn get_window(env: Env) -> Option<SpendWindow> {
        env.storage().instance().get(&DataKey::Window)
    }

    pub fn set_paused(env: Env, paused: bool) -> Result<(), Error> {
        let mut config = load_config(&env)?;
        config.admin.require_auth();
        config.paused = paused;
        env.storage().instance().set(&DataKey::Config, &config);
        bump_instance(&env);
        Ok(())
    }

    pub fn set_proof_issuers(
        env: Env,
        issuers: Vec<BytesN<32>>,
        threshold: u32,
    ) -> Result<(), Error> {
        let mut config = load_config(&env)?;
        config.admin.require_auth();
        if threshold == 0 || threshold > issuers.len() {
            return Err(Error::InvalidThreshold);
        }
        config.issuers = issuers;
        config.threshold = threshold;
        env.storage().instance().set(&DataKey::Config, &config);
        bump_instance(&env);
        Ok(())
    }

    /// Changing limits deliberately does not touch the active spend window —
    /// otherwise raising the cap would silently forgive everything already
    /// spent in it.
    pub fn set_limits(
        env: Env,
        max_per_payable: i128,
        window_seconds: u64,
        max_per_window: i128,
    ) -> Result<(), Error> {
        let mut config = load_config(&env)?;
        config.admin.require_auth();
        if max_per_payable <= 0 || max_per_window <= 0 || window_seconds == 0 {
            return Err(Error::InvalidLimits);
        }
        config.max_per_payable = max_per_payable;
        config.window_seconds = window_seconds;
        config.max_per_window = max_per_window;
        env.storage().instance().set(&DataKey::Config, &config);
        bump_instance(&env);
        Ok(())
    }

    pub fn set_executor(env: Env, executor: Address) -> Result<(), Error> {
        let mut config = load_config(&env)?;
        config.admin.require_auth();
        config.executor = executor;
        env.storage().instance().set(&DataKey::Config, &config);
        bump_instance(&env);
        Ok(())
    }
}

/// Moves a READY payable whose proof has lapsed to EXPIRED and releases its
/// commitment. Callers check the preconditions.
fn expire_ready(env: &Env, payable_id: &BytesN<32>, mut payable: Payable) {
    payable.status = Status::Expired;
    env.storage()
        .persistent()
        .set(&DataKey::Payable(payable_id.clone()), &payable);
    bump_payable(env, payable_id);
    release(env, payable.amount);

    events::PayableExpired {
        payable_id: payable_id.clone(),
        expiry: payable.expiry,
    }
    .publish(env);
}

/// True when the contract itself holds the float, which is the only case where
/// commitments and withdrawals mean anything.
fn is_vault(env: &Env, config: &Config) -> bool {
    config.payer == env.current_contract_address()
}

fn committed(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::Committed)
        .unwrap_or(0)
}

fn set_committed(env: &Env, value: i128) {
    env.storage().instance().set(&DataKey::Committed, &value);
    bump_instance(env);
}

fn commit(env: &Env, amount: i128) {
    set_committed(env, committed(env) + amount);
}

/// Saturating on purpose. The bookkeeping should never go negative, but if a
/// future change ever let it, silently owing a negative commitment would make
/// `available` larger than the vault actually holds — the one direction in
/// which an arithmetic slip turns into real money leaving.
fn release(env: &Env, amount: i128) {
    let remaining = committed(env) - amount;
    set_committed(env, if remaining > 0 { remaining } else { 0 });
}

fn available(env: &Env, config: &Config) -> i128 {
    let balance = token::Client::new(env, &config.asset).balance(&config.payer);
    let free = balance - committed(env);
    if free > 0 {
        free
    } else {
        0
    }
}

fn load_config(env: &Env) -> Result<Config, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .ok_or(Error::NotInitialized)
}

fn load_payable(env: &Env, payable_id: &BytesN<32>) -> Result<Payable, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Payable(payable_id.clone()))
        .ok_or(Error::PayableNotFound)
}

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_LEDGERS);
}

fn bump_payable(env: &Env, payable_id: &BytesN<32>) {
    env.storage().persistent().extend_ttl(
        &DataKey::Payable(payable_id.clone()),
        PAYABLE_TTL_THRESHOLD,
        PAYABLE_TTL_LEDGERS,
    );
}

/// Every supplied signature must be valid and from a distinct authorized
/// issuer, and there must be at least `threshold` of them.
///
/// "Every one must be valid" rather than "count the valid ones" because
/// `ed25519_verify` traps on a bad signature instead of returning false. That
/// turns out to be the stricter and better semantic anyway: a registration
/// carrying a forged signature fails outright rather than quietly succeeding
/// on the strength of the others.
fn verify_issuer_signatures(
    env: &Env,
    config: &Config,
    digest: &BytesN<32>,
    signatures: &Vec<IssuerSignature>,
) -> Result<(), Error> {
    if signatures.len() < config.threshold {
        return Err(Error::ThresholdNotMet);
    }

    let mut seen: Vec<BytesN<32>> = Vec::new(env);
    let message = soroban_sdk::Bytes::from_array(env, &digest.to_array());

    for entry in signatures.iter() {
        if !config.issuers.contains(&entry.issuer) {
            return Err(Error::UnknownIssuer);
        }
        if seen.contains(&entry.issuer) {
            return Err(Error::DuplicateIssuer);
        }
        seen.push_back(entry.issuer.clone());

        env.crypto()
            .ed25519_verify(&entry.issuer, &message, &entry.signature);
    }

    Ok(())
}

/// Applies the rolling cap and records the spend in the same call that pays,
/// so there is no window in which two settlements each see the old total.
fn charge_window(env: &Env, config: &Config, amount: i128) -> Result<(), Error> {
    let now = env.ledger().timestamp();
    let current: SpendWindow =
        env.storage()
            .instance()
            .get(&DataKey::Window)
            .unwrap_or(SpendWindow {
                started_at: now,
                spent: 0,
            });

    let mut window = if now.saturating_sub(current.started_at) >= config.window_seconds {
        SpendWindow {
            started_at: now,
            spent: 0,
        }
    } else {
        current
    };

    let spent = window.spent + amount;
    if spent > config.max_per_window {
        return Err(Error::WindowCapExceeded);
    }

    window.spent = spent;
    env.storage().instance().set(&DataKey::Window, &window);
    bump_instance(env);
    Ok(())
}

#[cfg(test)]
mod test;
