// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev A minimal contract whose transfer/transferFrom always revert.
///      Use as the payee address to force the push-payout fallback path.
contract RevertingPayee {
    /// @dev Rejects every ERC-20 transfer by reverting — simulates a blocked / reverted payee.
    fallback() external {
        revert("RevertingPayee: rejects all calls");
    }
}
