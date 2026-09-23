#![no_std]

use soroban_sdk::{contract, contractimpl};

/// Day 0 scaffold. Money-moving entry points require the reviewed v1.1 proof spec.
#[contract]
pub struct PayableContract;

#[contractimpl]
impl PayableContract {
    pub fn contract_version() -> u32 {
        1
    }
}

#[cfg(test)]
mod test;
