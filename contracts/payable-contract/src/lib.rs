#![no_std]

use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, BytesN, Env, Symbol, Vec};

pub mod address_bytes;
pub mod digest;
pub mod events;
pub mod types;

use address_bytes::address_to_bytes;
use digest::{registration_digest, RegistrationFields};
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
        2
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

        events::SettlementExecuted {
            payable_id,
            recipient: payable.recipient,
            amount: payable.amount,
            proof_hash: payable.proof_hash,
        }
        .publish(&env);
        Ok(())
    }

    /// Closes out a payable whose proof has expired. Permissionless: letting
    /// anyone clean up costs nothing and avoids stale entries waiting on an
    /// operator who may never come.
    pub fn expire(env: Env, payable_id: BytesN<32>) -> Result<(), Error> {
        let mut payable = load_payable(&env, &payable_id)?;
        if payable.status != Status::Ready {
            return Err(Error::NotReady);
        }
        if env.ledger().timestamp() <= payable.expiry {
            return Err(Error::ProofNotExpired);
        }

        payable.status = Status::Expired;
        env.storage()
            .persistent()
            .set(&DataKey::Payable(payable_id.clone()), &payable);
        bump_payable(&env, &payable_id);

        events::PayableExpired {
            payable_id,
            expiry: payable.expiry,
        }
        .publish(&env);
        Ok(())
    }

    /// Invalidates a payable before it settles.
    ///
    /// Exists because the off-chain revalidation of §14.3 is not a barrier the
    /// chain knows about: without this, evidence could go stale between
    /// registration and settlement and the gate would still pay. Admin-gated
    /// rather than issuer-signed, and worth being precise about what that
    /// concedes: a compromised admin can *stop* a payment, never redirect one.
    /// Revocation is one-way and cannot touch a settled payable.
    pub fn revoke_payable(
        env: Env,
        payable_id: BytesN<32>,
        reason_code: Symbol,
    ) -> Result<(), Error> {
        let config = load_config(&env)?;
        config.admin.require_auth();

        let mut payable = load_payable(&env, &payable_id)?;
        if payable.status != Status::Ready {
            return Err(Error::NotReady);
        }

        payable.status = Status::Revoked;
        env.storage()
            .persistent()
            .set(&DataKey::Payable(payable_id.clone()), &payable);
        bump_payable(&env, &payable_id);

        events::PayableRevoked {
            payable_id,
            reason_code,
        }
        .publish(&env);
        Ok(())
    }

    /// Relays an off-chain lifecycle fact to the ledger as an event. Emits
    /// only — it cannot change a payable's status, so a compromised issuer
    /// cannot use it to unblock money.
    pub fn attest_lifecycle(
        env: Env,
        payable_id: BytesN<32>,
        reason_code: Symbol,
        phase: Symbol,
    ) -> Result<(), Error> {
        let config = load_config(&env)?;
        config.admin.require_auth();

        if phase == PHASE_BLOCKED {
            events::PayableBlocked {
                payable_id,
                reason_code,
            }
            .publish(&env);
        } else if phase == PHASE_RESOLVED {
            events::ExceptionResolved {
                payable_id,
                reason_code,
            }
            .publish(&env);
        } else if phase == PHASE_RECONCIL {
            events::PayableReconciled {
                payable_id,
                reason_code,
            }
            .publish(&env);
        } else {
            return Err(Error::UnknownPhase);
        }

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
