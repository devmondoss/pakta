use super::*;
use soroban_sdk::Env;

#[test]
fn scaffold_registers_and_invokes() {
    let env = Env::default();
    let contract_id = env.register(PayableContract, ());
    let client = PayableContractClient::new(&env, &contract_id);

    assert_eq!(client.contract_version(), 1);
}
