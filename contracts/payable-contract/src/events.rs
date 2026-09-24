use soroban_sdk::{contractevent, Address, BytesN, Symbol};

/// The six events of `Pakta_Documento_Maestro.md` §8.5, plus the two terminal
/// transitions the gate reaches on its own.
///
/// `payable_id` is a topic on every one of them, so the Event Indexer can
/// subscribe per payable instead of filtering the whole stream.
///
/// An honest distinction that belongs in the pitch as much as in the code:
/// `PayableRegistered`, `PayableReady`, `SettlementExecuted`, `PayableExpired`
/// and `PayableRevoked` are facts the contract *enforced*. `PayableBlocked`,
/// `ExceptionResolved` and `PayableReconciled` are testimonies relayed by the
/// issuer through `attest_lifecycle` — the ledger records that the issuer said
/// so, not that a rule was checked on-chain (`Pakta_Dia0_Dev1.md` §1).

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayableRegistered {
    #[topic]
    pub payable_id: BytesN<32>,
    pub proof_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayableReady {
    #[topic]
    pub payable_id: BytesN<32>,
    pub recipient: Address,
    pub amount: i128,
    pub expiry: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SettlementExecuted {
    #[topic]
    pub payable_id: BytesN<32>,
    pub recipient: Address,
    pub amount: i128,
    /// Carried so reconciliation can walk tx -> settlement -> proof without a
    /// second lookup, which is the chain that `Pakta_Documento_Maestro.md` §25
    /// puts on screen.
    pub proof_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayableExpired {
    #[topic]
    pub payable_id: BytesN<32>,
    pub expiry: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayableRevoked {
    #[topic]
    pub payable_id: BytesN<32>,
    pub reason_code: Symbol,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayableBlocked {
    #[topic]
    pub payable_id: BytesN<32>,
    pub reason_code: Symbol,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExceptionResolved {
    #[topic]
    pub payable_id: BytesN<32>,
    pub reason_code: Symbol,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayableReconciled {
    #[topic]
    pub payable_id: BytesN<32>,
    pub reason_code: Symbol,
}
