// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DemoUSD} from "../src/DemoUSD.sol";
import {HumanRegistry} from "../src/HumanRegistry.sol";
import {TwoHumansHook} from "../src/TwoHumansHook.sol";
import {ACPCore} from "../src/erc8183/ACPCore.sol";
import {IACP} from "../src/erc8183/IACP.sol";

contract TwoHumansTest is Test {
    bytes32 constant SUB_ONE_PHONE = keccak256("https://sandbox.auth.world.org|sub_one_phone");
    bytes32 constant SUB_SECOND_HUMAN = keccak256("https://sandbox.auth.world.org|sub_second_human");
    uint256 constant BUDGET = 40e6;
    bytes constant NO_PARAMS = "";

    DemoUSD token;
    HumanRegistry registry;
    TwoHumansHook hook;
    ACPCore acp;

    address client = address(0xC1);
    address provider = address(0xA1);
    address evaluator = address(0xE1);

    function setUp() public {
        token = new DemoUSD();
        registry = new HumanRegistry(address(this));
        hook = new TwoHumansHook(address(registry));
        acp = new ACPCore(address(token));
        token.mint(client, 1_000e6);
        vm.prank(client);
        token.approve(address(acp), type(uint256).max);
    }

    function _registerBoth() internal {
        registry.register(client, SUB_ONE_PHONE);
        registry.register(provider, SUB_SECOND_HUMAN);
    }

    function _fundedSubmittedJob() internal returns (uint256 jobId) {
        vm.prank(client);
        jobId = acp.createJob(provider, evaluator, block.timestamp + 1 days, "ipfs://job", address(hook));
        vm.prank(client);
        acp.setBudget(jobId, BUDGET, NO_PARAMS);
        vm.prank(client);
        acp.fund(jobId, BUDGET, NO_PARAMS);
        vm.prank(provider);
        acp.submit(jobId, bytes("ipfs://delivery"), NO_PARAMS);
    }

    function _status(uint256 jobId) internal view returns (IACP.JobStatus) {
        return acp.getJob(jobId).status;
    }

    function testSameHumanRefusedAndRefundable() public {
        registry.register(client, SUB_ONE_PHONE);
        registry.register(provider, SUB_ONE_PHONE);
        uint256 jobId = _fundedSubmittedJob();

        vm.prank(evaluator);
        vm.expectRevert(abi.encodeWithSelector(TwoHumansHook.SameHuman.selector, SUB_ONE_PHONE));
        acp.complete(jobId, bytes("ipfs://receipt"), NO_PARAMS);

        assertEq(token.balanceOf(provider), 0);
        assertEq(token.balanceOf(client), 1_000e6 - BUDGET);
        assertEq(token.balanceOf(address(acp)), BUDGET);
        assertEq(uint256(_status(jobId)), uint256(IACP.JobStatus.Submitted));

        vm.warp(block.timestamp + 2 days);
        acp.claimRefund(jobId);
        assertEq(token.balanceOf(client), 1_000e6);
        assertEq(token.balanceOf(address(acp)), 0);
    }

    function testDistinctHumansPaid() public {
        _registerBoth();
        uint256 jobId = _fundedSubmittedJob();

        vm.expectEmit(true, false, false, true);
        emit TwoHumansHook.DistinctHumans(jobId, SUB_ONE_PHONE, SUB_SECOND_HUMAN);
        vm.prank(evaluator);
        acp.complete(jobId, bytes("ipfs://receipt"), NO_PARAMS);

        assertEq(token.balanceOf(provider), BUDGET);
        assertEq(token.balanceOf(address(acp)), 0);
        assertEq(uint256(_status(jobId)), uint256(IACP.JobStatus.Completed));
    }

    function testUnprovenSideReverts() public {
        registry.register(provider, SUB_SECOND_HUMAN);
        uint256 jobId = _fundedSubmittedJob();

        vm.prank(evaluator);
        vm.expectRevert(abi.encodeWithSelector(TwoHumansHook.Unproven.selector, client));
        acp.complete(jobId, bytes("ipfs://receipt"), NO_PARAMS);
        assertEq(token.balanceOf(provider), 0);
    }

    function testSecondHumanReleasesSameDelivery() public {
        registry.register(client, SUB_ONE_PHONE);
        registry.register(provider, SUB_ONE_PHONE);
        uint256 jobId = _fundedSubmittedJob();

        vm.prank(evaluator);
        vm.expectRevert(abi.encodeWithSelector(TwoHumansHook.SameHuman.selector, SUB_ONE_PHONE));
        acp.complete(jobId, bytes("ipfs://receipt"), NO_PARAMS);

        registry.register(client, SUB_SECOND_HUMAN);

        vm.prank(evaluator);
        acp.complete(jobId, bytes("ipfs://receipt"), NO_PARAMS);
        assertEq(token.balanceOf(provider), BUDGET);
        assertEq(uint256(_status(jobId)), uint256(IACP.JobStatus.Completed));
    }

    function testFundingIsNotGated() public {
        vm.prank(client);
        uint256 jobId = acp.createJob(provider, evaluator, block.timestamp + 1 days, "ipfs://job", address(hook));
        vm.prank(client);
        acp.setBudget(jobId, BUDGET, NO_PARAMS);
        vm.prank(client);
        acp.fund(jobId, BUDGET, NO_PARAMS);
        assertEq(token.balanceOf(address(acp)), BUDGET);
    }

    function testOnlyRegistrarWrites() public {
        vm.prank(client);
        vm.expectRevert(HumanRegistry.OnlyRegistrar.selector);
        registry.register(client, SUB_ONE_PHONE);
    }

    function testUnregisterBlocksSettlement() public {
        _registerBoth();
        uint256 jobId = _fundedSubmittedJob();
        registry.unregister(provider);

        vm.prank(evaluator);
        vm.expectRevert(abi.encodeWithSelector(TwoHumansHook.Unproven.selector, provider));
        acp.complete(jobId, bytes("ipfs://receipt"), NO_PARAMS);
    }
}
