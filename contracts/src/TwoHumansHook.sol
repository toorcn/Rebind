// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IACPHook} from "./erc8183/IACPHook.sol";
import {IACP} from "./erc8183/IACP.sol";
import {HumanRegistry} from "./HumanRegistry.sol";

/// @title TwoHumansHook — ERC-8183 settlement gate: the sale needs two humans
/// @notice Reverts complete() when the job's client and provider resolve to the
///         same World subject, or when either side has no subject at all.
///
///         The enforcement point is complete(), not fund(). Escrow may lock, the
///         work may be delivered, and settlement still refuses. The funds are not
///         stuck: claimRefund() is deliberately not hookable in ERC-8183, so the
///         client recovers the budget after expiry. The sale simply never counts.
///
///         This is the on-chain answer to the Sieve finding on Virtuals aGDP:
///         ~201 buyer wallets funded by one Disperse contract all looked like
///         distinct demand. Wallet counts cannot see one operator. A pairwise
///         World subject can.
contract TwoHumansHook is IACPHook {
    HumanRegistry public immutable registry;

    /// @notice One side of the job never finished a server-checked World proof.
    error Unproven(address account);

    /// @notice Client and provider are the same human. Settlement refused.
    error SameHuman(bytes32 subject);

    /// @notice Settlement went through with two different subjects.
    event DistinctHumans(uint256 indexed jobId, bytes32 clientSubject, bytes32 providerSubject);

    constructor(address _registry) {
        registry = HumanRegistry(_registry);
    }

    /// @notice Gate settlement. Every other action passes through.
    /// @dev The calling ACP core contract is msg.sender; read the job back from it.
    function beforeAction(
        uint256 jobId,
        bytes4 selector,
        bytes calldata /* data */
    ) external view override {
        if (selector != IACP.complete.selector) return;

        IACP.Job memory job = IACP(msg.sender).getJob(jobId);
        bytes32 clientSubject = registry.subjectOf(job.client);
        bytes32 providerSubject = registry.subjectOf(job.provider);

        if (clientSubject == bytes32(0)) revert Unproven(job.client);
        if (providerSubject == bytes32(0)) revert Unproven(job.provider);
        if (clientSubject == providerSubject) revert SameHuman(clientSubject);
    }

    /// @notice After a successful complete(), record that two humans were involved.
    function afterAction(
        uint256 jobId,
        bytes4 selector,
        bytes calldata /* data */
    ) external override {
        if (selector != IACP.complete.selector) return;
        IACP.Job memory job = IACP(msg.sender).getJob(jobId);
        // Both entries exist and differ — beforeAction already ran in this tx.
        emit DistinctHumans(jobId, registry.subjectOf(job.client), registry.subjectOf(job.provider));
    }
}
