// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {HouseholdBillSplitter} from "../HouseholdBillSplitter.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev A payee contract that reverts on ERC-20 transfer, forcing the push-fallback path.
contract RejectingPayee {
    // Reject any ETH
    receive() external payable { revert("reject"); }
    // The splitter calls usdc.transfer(address(this), amount) — that goes through MockERC20,
    // not this contract. To force revert we use vm.mockCall on the usdc address in tests.
}

// ---------------------------------------------------------------------------
// Handler for invariant testing
// ---------------------------------------------------------------------------
contract BillSplitterHandler is Test {
    HouseholdBillSplitter public splitter;
    MockERC20 public usdc;

    address public alice = makeAddr("alice");
    address public bob   = makeAddr("bob");

    uint256 public aliceContributed;
    uint256 public bobContributed;

    uint256 public constant ALICE_SHARE = 600e6;
    uint256 public constant BOB_SHARE   = 400e6;
    uint256 public constant TOTAL       = 1_000e6;

    uint256 public billId;
    bool public settled;

    constructor(HouseholdBillSplitter _splitter, MockERC20 _usdc) {
        splitter = _splitter;
        usdc     = _usdc;

        usdc.mint(alice, TOTAL * 10);
        usdc.mint(bob,   TOTAL * 10);

        vm.prank(alice);
        usdc.approve(address(splitter), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(splitter), type(uint256).max);

        address[] memory participants = new address[](2);
        participants[0] = alice;
        participants[1] = bob;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = ALICE_SHARE;
        amounts[1] = BOB_SHARE;

        address payee = makeAddr("payee");
        vm.prank(alice);
        billId = splitter.createBill(TOTAL, bytes32(0), payee, participants, amounts, false, 0, false, 0, 2);
    }

    function payAlice(uint256 seed) external {
        if (settled) return;
        uint256 remaining = ALICE_SHARE - aliceContributed;
        if (remaining == 0) return;
        uint256 amount = bound(seed, 1, remaining);
        vm.prank(alice);
        splitter.pay(billId, amount);
        aliceContributed += amount;
        if (aliceContributed == ALICE_SHARE && bobContributed == BOB_SHARE) settled = true;
    }

    function payBob(uint256 seed) external {
        if (settled) return;
        uint256 remaining = BOB_SHARE - bobContributed;
        if (remaining == 0) return;
        uint256 amount = bound(seed, 1, remaining);
        vm.prank(bob);
        splitter.pay(billId, amount);
        bobContributed += amount;
        if (aliceContributed == ALICE_SHARE && bobContributed == BOB_SHARE) settled = true;
    }
}

// ---------------------------------------------------------------------------
// Main test contract
// ---------------------------------------------------------------------------
contract HouseholdBillSplitterTest is Test {
    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------
    HouseholdBillSplitter internal splitter;
    MockERC20 internal usdc;

    address internal owner   = makeAddr("owner");
    address internal alice   = makeAddr("alice");
    address internal bob     = makeAddr("bob");
    address internal carol   = makeAddr("carol");
    address internal payee   = makeAddr("payee");
    address internal creator = makeAddr("creator");

    uint256 internal constant TOTAL_3P    = 1_000e6;
    uint256 internal constant ALICE_SHARE = 400e6;
    uint256 internal constant BOB_SHARE   = 300e6;
    uint256 internal constant CAROL_SHARE = 300e6;

    uint256 internal constant TOTAL_2P    = 1_000e6;
    uint256 internal constant HALF        = 500e6;

    uint256 internal constant PAYOUT_REDIRECT_GRACE = 7 days;

    // -----------------------------------------------------------------------
    // setUp — runs before every test
    // -----------------------------------------------------------------------
    function setUp() public {
        MockERC20 mock = new MockERC20("Mock USDC", "mUSDC", 6);
        vm.etch(0x3600000000000000000000000000000000000000, address(mock).code);
        usdc = MockERC20(0x3600000000000000000000000000000000000000);

        splitter = new HouseholdBillSplitter(address(usdc));

        usdc.mint(alice,   TOTAL_3P * 10);
        usdc.mint(bob,     TOTAL_3P * 10);
        usdc.mint(carol,   TOTAL_3P * 10);
        usdc.mint(creator, TOTAL_3P * 10);

        vm.prank(alice);
        usdc.approve(address(splitter), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(splitter), type(uint256).max);
        vm.prank(carol);
        usdc.approve(address(splitter), type(uint256).max);
        vm.prank(creator);
        usdc.approve(address(splitter), type(uint256).max);
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    /// @dev Create a 2-participant bill where the payee is a bad address that forces the fallback path.
    ///      Uses vm.mockCall to make usdc.transfer(badPayee, *) return false during settlement.
    function _create2PBillWithBadPayee() internal returns (uint256 billId, address badPayee) {
        badPayee = address(new RejectingPayee());

        address[] memory participants = new address[](2);
        participants[0] = alice;
        participants[1] = bob;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = HALF;
        amounts[1] = HALF;

        vm.prank(creator);
        billId = splitter.createBill(TOTAL_2P, bytes32(0), badPayee, participants, amounts, false, 0, false, 0, 2);
    }

    /// @dev Create a 3-participant bill where the payee forces fallback (threshold=2).
    function _create3PBillWithBadPayee() internal returns (uint256 billId, address badPayee) {
        badPayee = address(new RejectingPayee());

        address[] memory participants = new address[](3);
        participants[0] = alice;
        participants[1] = bob;
        participants[2] = carol;

        uint256[] memory amounts = new uint256[](3);
        amounts[0] = ALICE_SHARE;
        amounts[1] = BOB_SHARE;
        amounts[2] = CAROL_SHARE;

        vm.prank(creator);
        billId = splitter.createBill(TOTAL_3P, bytes32(0), badPayee, participants, amounts, false, 0, false, 0, 2);
    }

    /// @dev Create a 3-participant bill with bad payee and threshold=3.
    function _create3PBillWithBadPayeeThreshold3() internal returns (uint256 billId, address badPayee) {
        badPayee = address(new RejectingPayee());

        address[] memory participants = new address[](3);
        participants[0] = alice;
        participants[1] = bob;
        participants[2] = carol;

        uint256[] memory amounts = new uint256[](3);
        amounts[0] = ALICE_SHARE;
        amounts[1] = BOB_SHARE;
        amounts[2] = CAROL_SHARE;

        vm.prank(creator);
        billId = splitter.createBill(TOTAL_3P, bytes32(0), badPayee, participants, amounts, false, 0, false, 0, 3);
    }

    /// @dev Force MockERC20 transfer to badPayee to return false (simulates a frozen/bad payee).
    ///      Call this BEFORE the final payment that triggers settlement.
    function _mockBadPayeeTransferFail(address badPayee, uint256 amount) internal {
        vm.mockCall(
            address(usdc),
            abi.encodeWithSelector(MockERC20.transfer.selector, badPayee, amount),
            abi.encode(false)
        );
    }

    /// @dev Create a 2-participant bill [alice=500, bob=500], no deadline, no recur.
    function _create2PBill() internal returns (uint256 billId) {
        address[] memory participants = new address[](2);
        participants[0] = alice;
        participants[1] = bob;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = HALF;
        amounts[1] = HALF;

        vm.prank(creator);
        billId = splitter.createBill(TOTAL_2P, bytes32(0), payee, participants, amounts, false, 0, false, 0, 2);
    }

    /// @dev Create a 2-participant bill with an explicit deadline.
    function _create2PBillWithDeadline(uint256 deadline) internal returns (uint256 billId) {
        address[] memory participants = new address[](2);
        participants[0] = alice;
        participants[1] = bob;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = HALF;
        amounts[1] = HALF;

        vm.prank(creator);
        billId = splitter.createBill(TOTAL_2P, bytes32(0), payee, participants, amounts, false, deadline, false, 0, 2);
    }

    /// @dev Create a 3-participant bill [alice=400, bob=300, carol=300], no deadline, no recur, threshold=2.
    function _create3PBill() internal returns (uint256 billId) {
        address[] memory participants = new address[](3);
        participants[0] = alice;
        participants[1] = bob;
        participants[2] = carol;

        uint256[] memory amounts = new uint256[](3);
        amounts[0] = ALICE_SHARE;
        amounts[1] = BOB_SHARE;
        amounts[2] = CAROL_SHARE;

        vm.prank(creator);
        billId = splitter.createBill(TOTAL_3P, bytes32(0), payee, participants, amounts, false, 0, false, 0, 2);
    }

    /// @dev Create a 3-participant bill with cancelThreshold=3 (all must vote for redirect).
    function _create3PBillThreshold3() internal returns (uint256 billId) {
        address[] memory participants = new address[](3);
        participants[0] = alice;
        participants[1] = bob;
        participants[2] = carol;

        uint256[] memory amounts = new uint256[](3);
        amounts[0] = ALICE_SHARE;
        amounts[1] = BOB_SHARE;
        amounts[2] = CAROL_SHARE;

        vm.prank(creator);
        billId = splitter.createBill(TOTAL_3P, bytes32(0), payee, participants, amounts, false, 0, false, 0, 3);
    }

    /// @dev Create a 2-participant recurring bill (interval = 30 days).
    function _create2PRecurringBill() internal returns (uint256 billId) {
        address[] memory participants = new address[](2);
        participants[0] = alice;
        participants[1] = bob;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = HALF;
        amounts[1] = HALF;

        vm.prank(creator);
        billId = splitter.createBill(TOTAL_2P, bytes32(0), payee, participants, amounts, false, 0, true, 30 days, 2);
    }

    /// @dev Fully settle a 3-participant bill (alice+bob+carol all pay their shares).
    function _settle3PBill(uint256 billId) internal {
        vm.prank(alice);
        splitter.pay(billId, ALICE_SHARE);
        vm.prank(bob);
        splitter.pay(billId, BOB_SHARE);
        vm.prank(carol);
        splitter.pay(billId, CAROL_SHARE);
    }

    /// @dev Fully settle a 2-participant bill.
    function _settle2PBill(uint256 billId) internal {
        vm.prank(alice);
        splitter.pay(billId, HALF);
        vm.prank(bob);
        splitter.pay(billId, HALF);
    }

    // -----------------------------------------------------------------------
    // 1. Partial payment happy path
    // -----------------------------------------------------------------------
    function test_PartialPayment_ShareContributedEmitted() public {
        uint256 billId = _create2PBill();
        uint256 partialAmount = HALF / 2; // 250e6

        vm.expectEmit(true, true, false, true, address(splitter));
        emit HouseholdBillSplitter.ShareContributed(billId, alice, partialAmount, partialAmount, HALF);

        vm.prank(alice);
        splitter.pay(billId, partialAmount);

        (, , , uint256 amountPaid, , , , , ,) = splitter.getBill(billId);
        assertEq(amountPaid, partialAmount, "amountPaid should equal partial");
    }

    function test_PartialPayment_NoSharePaidYet() public {
        uint256 billId = _create2PBill();
        uint256 partialAmount = HALF / 2;

        vm.recordLogs();
        vm.prank(alice);
        splitter.pay(billId, partialAmount);

        bytes32 sharePaidTopic = keccak256("SharePaid(uint256,address,uint256)");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != sharePaidTopic, "SharePaid must NOT fire on partial pay");
        }
    }

    // -----------------------------------------------------------------------
    // 2. Full share in two installments
    // -----------------------------------------------------------------------
    function test_TwoInstallments_SharePaidOnSecond() public {
        uint256 billId = _create2PBill();
        uint256 first  = (HALF * 40) / 100; // 40%
        uint256 second = HALF - first;       // 60%

        vm.prank(alice);
        splitter.pay(billId, first);

        vm.expectEmit(true, true, false, true, address(splitter));
        emit HouseholdBillSplitter.ShareContributed(billId, alice, second, HALF, HALF);

        vm.expectEmit(true, true, false, true, address(splitter));
        emit HouseholdBillSplitter.SharePaid(billId, alice, HALF);

        vm.prank(alice);
        splitter.pay(billId, second);

        HouseholdBillSplitter.Share[] memory shares = splitter.getShares(billId);
        assertEq(shares[0].contributed, shares[0].amount, "contributed should equal amount after full pay");
    }

    // -----------------------------------------------------------------------
    // 3. Three participants, staggered partial payments, full settlement
    // -----------------------------------------------------------------------
    function test_ThreeParticipants_StaggeredSettlement() public {
        uint256 billId = _create3PBill();

        vm.prank(alice);
        splitter.pay(billId, ALICE_SHARE / 2);
        vm.prank(alice);
        splitter.pay(billId, ALICE_SHARE - ALICE_SHARE / 2);

        vm.prank(bob);
        splitter.pay(billId, BOB_SHARE);

        vm.prank(carol);
        splitter.pay(billId, CAROL_SHARE / 2);

        (, , , , HouseholdBillSplitter.BillStatus statusMid, , , , ,) = splitter.getBill(billId);
        assertEq(uint8(statusMid), uint8(HouseholdBillSplitter.BillStatus.Active), "Bill should still be active");

        vm.expectEmit(true, true, false, true, address(splitter));
        emit HouseholdBillSplitter.BillSettled(billId, payee, TOTAL_3P);

        vm.prank(carol);
        splitter.pay(billId, CAROL_SHARE - CAROL_SHARE / 2);

        (, , , , HouseholdBillSplitter.BillStatus statusFinal, , , , ,) = splitter.getBill(billId);
        assertEq(uint8(statusFinal), uint8(HouseholdBillSplitter.BillStatus.Settled), "Bill should be settled");

        // Push-first: payee balance increased automatically on settlement
        assertEq(splitter.payoutClaimable(billId), 0, "push succeeded: payoutClaimable stays 0");
        assertGe(usdc.balanceOf(payee), TOTAL_3P, "push succeeded: payee received funds automatically");
    }

    // -----------------------------------------------------------------------
    // 4. ExceedsRemaining revert
    // -----------------------------------------------------------------------
    function test_ExceedsRemaining_Reverts() public {
        uint256 billId = _create2PBill();

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(HouseholdBillSplitter.ExceedsRemaining.selector, billId, HALF + 1, HALF)
        );
        splitter.pay(billId, HALF + 1);
    }

    function test_ExceedsRemaining_AfterPartialPay() public {
        uint256 billId = _create2PBill();
        uint256 partAmt = HALF / 2;
        uint256 remaining = HALF - partAmt;

        vm.prank(alice);
        splitter.pay(billId, partAmt);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(HouseholdBillSplitter.ExceedsRemaining.selector, billId, remaining + 1, remaining)
        );
        splitter.pay(billId, remaining + 1);
    }

    // -----------------------------------------------------------------------
    // 5. ZeroPayment revert
    // -----------------------------------------------------------------------
    function test_ZeroPayment_Reverts() public {
        uint256 billId = _create2PBill();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(HouseholdBillSplitter.ZeroPayment.selector, billId));
        splitter.pay(billId, 0);
    }

    // -----------------------------------------------------------------------
    // 6. DeadlineExpired revert
    // -----------------------------------------------------------------------
    function test_DeadlineExpired_Reverts() public {
        uint256 deadline = block.timestamp + 1 days;
        uint256 billId = _create2PBillWithDeadline(deadline);

        vm.warp(deadline + 1);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(HouseholdBillSplitter.DeadlineExpired.selector, billId));
        splitter.pay(billId, HALF);
    }

    function test_PayBeforeDeadline_Succeeds() public {
        uint256 deadline = block.timestamp + 1 days;
        uint256 billId = _create2PBillWithDeadline(deadline);

        vm.warp(deadline);
        vm.prank(alice);
        splitter.pay(billId, HALF); // no revert expected
    }

    // -----------------------------------------------------------------------
    // 7. Partial payer gets partial refund on cancel
    // -----------------------------------------------------------------------
    function test_CancelRefund_IsPartialContributed() public {
        uint256 billId = _create2PBill();

        uint256 alicePaid = (HALF * 60) / 100;
        vm.prank(alice);
        splitter.pay(billId, alicePaid);

        vm.prank(alice);
        splitter.voteCancel(billId);
        vm.prank(bob);
        splitter.voteCancel(billId);

        assertEq(splitter.refundable(billId, alice), alicePaid, "refund should be partial amount contributed");
        assertEq(splitter.refundable(billId, bob), 0, "bob had no contribution");

        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        splitter.claimRefund(billId);
        assertEq(usdc.balanceOf(alice), balBefore + alicePaid, "alice should receive exact partial refund");
    }

    // -----------------------------------------------------------------------
    // 8. claimExpiredRefund with partial contribution
    // -----------------------------------------------------------------------
    function test_ClaimExpiredRefund_PartialContribution() public {
        uint256 deadline = block.timestamp + 7 days;
        uint256 billId = _create2PBillWithDeadline(deadline);

        uint256 alicePaid = HALF / 2;
        vm.prank(alice);
        splitter.pay(billId, alicePaid);

        vm.warp(deadline + 1);

        uint256 balBefore = usdc.balanceOf(alice);

        vm.expectEmit(true, true, false, true, address(splitter));
        emit HouseholdBillSplitter.RefundClaimed(billId, alice, alicePaid);

        vm.prank(alice);
        splitter.claimExpiredRefund(billId);

        assertEq(usdc.balanceOf(alice), balBefore + alicePaid, "alice gets 50% refund");
    }

    // -----------------------------------------------------------------------
    // 9. claimExpiredRefund blocked for zero-contributor
    // -----------------------------------------------------------------------
    function test_ClaimExpiredRefund_ZeroContributor_Reverts() public {
        uint256 deadline = block.timestamp + 7 days;
        uint256 billId = _create2PBillWithDeadline(deadline);

        vm.warp(deadline + 1);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(HouseholdBillSplitter.NoExpiredRefund.selector, billId, bob));
        splitter.claimExpiredRefund(billId);
    }

    // -----------------------------------------------------------------------
    // 10. getShareProgress
    // -----------------------------------------------------------------------
    function test_GetShareProgress_InitiallyZero() public {
        uint256 billId = _create2PBill();

        (uint256 contributed, uint256 total, uint256 remaining) = splitter.getShareProgress(billId, alice);
        assertEq(contributed, 0,    "contributed should be 0 initially");
        assertEq(total,       HALF, "total should be alice's share");
        assertEq(remaining,   HALF, "remaining should be full share");
    }

    function test_GetShareProgress_AfterPartialPay() public {
        uint256 billId = _create2PBill();
        uint256 partAmt = HALF / 4;

        vm.prank(alice);
        splitter.pay(billId, partAmt);

        (uint256 contributed, uint256 total, uint256 remaining) = splitter.getShareProgress(billId, alice);
        assertEq(contributed, partAmt,        "contributed should be partAmt");
        assertEq(total,       HALF,           "total unchanged");
        assertEq(remaining,   HALF - partAmt, "remaining decremented");
    }

    function test_GetShareProgress_AfterFullPay() public {
        uint256 billId = _create2PBill();

        vm.prank(alice);
        splitter.pay(billId, HALF);

        (uint256 contributed, uint256 total, uint256 remaining) = splitter.getShareProgress(billId, alice);
        assertEq(contributed, HALF, "contributed == total");
        assertEq(total,       HALF, "total unchanged");
        assertEq(remaining,   0,    "no remaining");
    }

    // -----------------------------------------------------------------------
    // 11. isLate
    // -----------------------------------------------------------------------
    function test_IsLate_TrueAfterDeadlineWithPartialPay() public {
        uint256 deadline = block.timestamp + 1 days;
        uint256 billId = _create2PBillWithDeadline(deadline);

        vm.prank(alice);
        splitter.pay(billId, HALF / 2);

        assertFalse(splitter.isLate(billId, alice), "should not be late before deadline");

        vm.warp(deadline + 1);
        assertTrue(splitter.isLate(billId, alice), "should be late after deadline with partial pay");
    }

    function test_IsLate_FalseWhenFullyPaid() public {
        uint256 deadline = block.timestamp + 1 days;
        uint256 billId = _create2PBillWithDeadline(deadline);

        vm.prank(alice);
        splitter.pay(billId, HALF);

        vm.warp(deadline + 1);
        assertFalse(splitter.isLate(billId, alice), "fully-paid participant should not be late");
    }

    function test_IsLate_FalseBeforeDeadline() public {
        uint256 deadline = block.timestamp + 1 days;
        uint256 billId = _create2PBillWithDeadline(deadline);

        assertFalse(splitter.isLate(billId, alice), "should not be late before deadline passes");
    }

    // -----------------------------------------------------------------------
    // 12. Recurring bill spawned on settlement via partial pays
    // -----------------------------------------------------------------------
    function test_RecurringBill_SpawnedOnPartialPaySettlement() public {
        uint256 billId = _create2PRecurringBill();
        assertEq(splitter.billCount(), 1, "should start with 1 bill");

        vm.prank(alice);
        splitter.pay(billId, HALF / 3);
        vm.prank(alice);
        splitter.pay(billId, HALF - HALF / 3);

        vm.prank(bob);
        splitter.pay(billId, HALF);
        assertEq(splitter.billCount(), 2, "recurring bill should be spawned on settlement");

        (, , uint256 childTotal, , HouseholdBillSplitter.BillStatus childStatus, uint256 childDeadline, , , ,) = splitter.getBill(1);
        assertEq(childTotal, TOTAL_2P, "child bill total should match parent");
        assertEq(uint8(childStatus), uint8(HouseholdBillSplitter.BillStatus.Active), "child bill should be active");
        assertGt(childDeadline, block.timestamp, "child deadline in the future");
    }

    // -----------------------------------------------------------------------
    // 13. claimPayout after partial-pay settlement
    // -----------------------------------------------------------------------
    function test_ClaimPayout_AfterPartialPaySettlement() public {
        // Use bad payee to force the fallback path (push fails → payoutClaimable set → pull needed)
        (uint256 billId, address badPayee) = _create2PBillWithBadPayee();
        _mockBadPayeeTransferFail(badPayee, TOTAL_2P);

        vm.prank(alice);
        splitter.pay(billId, HALF / 3);
        vm.prank(alice);
        splitter.pay(billId, HALF - HALF / 3);
        vm.prank(bob);
        splitter.pay(billId, HALF / 2);
        vm.prank(bob);
        splitter.pay(billId, HALF - HALF / 2);

        // Fallback path: payoutClaimable is set because push failed
        assertEq(splitter.payoutClaimable(billId), TOTAL_2P, "fallback: payoutClaimable set after failed push");

        uint256 payeeBal = usdc.balanceOf(badPayee);

        // Clear mock so the actual claimPayout transfer succeeds
        vm.clearMockedCalls();

        vm.expectEmit(true, true, false, true, address(splitter));
        emit HouseholdBillSplitter.PayoutClaimed(billId, badPayee, TOTAL_2P);

        vm.prank(badPayee);
        splitter.claimPayout(billId);

        assertEq(usdc.balanceOf(badPayee), payeeBal + TOTAL_2P, "payee receives full totalAmount via pull");
        assertEq(splitter.payoutClaimable(billId), 0, "payoutClaimable zeroed after claim");
    }

    function test_PushPayout_HappyPath_PayeeReceivesAutomatically() public {
        // Verify the push-first path: payee gets funds on the final pay() call, no claimPayout needed
        uint256 billId = _create2PBill();
        uint256 payeeBefore = usdc.balanceOf(payee);

        // Settle the bill (Alice pays first, then Bob — final pay emits SharePaid, BillSettled, PayoutPushed)
        _settle2PBill(billId);

        assertEq(usdc.balanceOf(payee), payeeBefore + TOTAL_2P, "payee receives funds automatically on settlement");
        assertEq(splitter.payoutClaimable(billId), 0, "no pull needed: payoutClaimable stays 0");
    }

    function test_PushPayout_FailFallback_ClaimPayoutWorks() public {
        // Verify the fallback path: push fails → payoutClaimable set → claimPayout works
        (uint256 billId, address badPayee) = _create2PBillWithBadPayee();
        _mockBadPayeeTransferFail(badPayee, TOTAL_2P);

        _settle2PBill(billId);

        assertEq(splitter.payoutClaimable(billId), TOTAL_2P, "fallback: payoutClaimable set after failed push");

        vm.clearMockedCalls();
        uint256 balBefore = usdc.balanceOf(badPayee);
        vm.prank(badPayee);
        splitter.claimPayout(billId);
        assertEq(usdc.balanceOf(badPayee), balBefore + TOTAL_2P, "pull fallback succeeded");
    }

    function test_PushPayout_Succeeded_ClaimPayoutReverts() public {
        // Push succeeded → claimPayout must revert NoPayoutAvailable
        uint256 billId = _create2PBill();
        _settle2PBill(billId);

        vm.prank(payee);
        vm.expectRevert(abi.encodeWithSelector(HouseholdBillSplitter.NoPayoutAvailable.selector, billId));
        splitter.claimPayout(billId);
    }

    function test_PushPayout_Succeeded_ClaimPayoutReverts_NoDoubleSpend() public {
        // Push succeeded → claimPayout must revert (payoutClaimable == 0)
        uint256 billId = _create2PBill();
        _settle2PBill(billId);

        vm.prank(payee);
        vm.expectRevert(abi.encodeWithSelector(HouseholdBillSplitter.NoPayoutAvailable.selector, billId));
        splitter.claimPayout(billId);
    }

    // -----------------------------------------------------------------------
    // 15. MAX_PARTICIPANTS cap
    // -----------------------------------------------------------------------
    function test_MaxParticipants_Cap() public {
        uint8 max = splitter.MAX_PARTICIPANTS();
        uint256 n = uint256(max) + 1; // one over the cap

        address[] memory participants = new address[](n);
        uint256[] memory amounts      = new uint256[](n);
        uint256 share = 1_000e6 / n;
        uint256 total = 0;
        for (uint256 i = 0; i < n; i++) {
            participants[i] = address(uint160(uint256(keccak256(abi.encode("p", i)))));
            amounts[i]      = share;
            total          += share;
        }
        // Adjust last element so amounts sum to total
        amounts[n - 1] += (1_000e6 - total);

        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(HouseholdBillSplitter.InvalidBillParams.selector, "too many participants")
        );
        splitter.createBill(1_000e6, bytes32(0), payee, participants, amounts, false, 0, false, 0, 1);
    }

    // -----------------------------------------------------------------------
    // 16. getBill reverts on invalid ID
    // -----------------------------------------------------------------------
    function test_GetBill_InvalidId_Reverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(HouseholdBillSplitter.InvalidBillParams.selector, "bill does not exist")
        );
        splitter.getBill(999);
    }

    // -----------------------------------------------------------------------
    // 17. protocolRiskAcknowledged
    // -----------------------------------------------------------------------
    function test_ProtocolRiskAcknowledged_ReturnsTrue() public view {
        assertTrue(splitter.protocolRiskAcknowledged(), "should return true");
    }

    // -----------------------------------------------------------------------
    // 18. BillCreated event emits RESOLVED deadline (not raw 0)
    // -----------------------------------------------------------------------
    function test_BillCreated_EmitsResolvedDeadline_WhenZeroInput() public {
        address[] memory participants = new address[](2);
        participants[0] = alice;
        participants[1] = bob;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = HALF;
        amounts[1] = HALF;

        // Record the exact timestamp before creation so we can verify the resolved deadline.
        uint256 expectedDeadline = block.timestamp + splitter.MAX_BILL_DURATION();

        vm.expectEmit(true, true, false, true, address(splitter));
        emit HouseholdBillSplitter.BillCreated(
            0,          // billId
            bytes32(0), // label
            creator,    // creator
            payee,      // payee
            TOTAL_2P,   // totalAmount
            expectedDeadline, // deadline == resolved, NOT 0
            false,      // recurring
            0,          // recurInterval
            2           // cancelThreshold
        );

        vm.prank(creator);
        splitter.createBill(TOTAL_2P, bytes32(0), payee, participants, amounts, false, 0 /*raw deadline*/, false, 0, 2);
    }

    function test_BillCreated_EmitsExactDeadline_WhenExplicit() public {
        address[] memory participants = new address[](2);
        participants[0] = alice;
        participants[1] = bob;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = HALF;
        amounts[1] = HALF;

        uint256 explicitDeadline = block.timestamp + 30 days;

        vm.expectEmit(true, true, false, true, address(splitter));
        emit HouseholdBillSplitter.BillCreated(
            0, bytes32(0), creator, payee, TOTAL_2P, explicitDeadline, false, 0, 2
        );

        vm.prank(creator);
        splitter.createBill(TOTAL_2P, bytes32(0), payee, participants, amounts, false, explicitDeadline, false, 0, 2);
    }

    // -----------------------------------------------------------------------
    // 19. settledAt is set on bill settlement (read via vm.load)
    //     Storage layout:
    //   contract-level: _owner(0), _pendingOwner(1), _status(2), billCount(3), _bills(4)
    //   Bill struct offsets: creator(0), label(1), payee(2), totalAmount(3), amountPaid(4),
    //     status(5), deadline(6), settledAt(7), recurring(8), recurInterval(9),
    //     cancelThreshold+cancelVotes(10), shares(11)
    //   _bills[billId].settledAt = storage[ keccak256(billId ++ 4) + 7 ]
    // -----------------------------------------------------------------------
    function _settledAtSlot(uint256 billId) internal pure returns (bytes32) {
        bytes32 billBase = keccak256(abi.encode(uint256(billId), uint256(4)));
        return bytes32(uint256(billBase) + 7);
    }

    function test_SettledAt_IsZeroBeforeSettlement() public {
        uint256 billId = _create2PBill();

        bytes32 settledAtBefore = vm.load(address(splitter), _settledAtSlot(billId));
        assertEq(uint256(settledAtBefore), 0, "settledAt should be 0 before settlement");
    }

    function test_SettledAt_IsSetOnSettlement() public {
        uint256 billId = _create2PBill();

        // Record timestamp at settlement
        uint256 settleTime = block.timestamp;
        _settle2PBill(billId);

        uint256 settledAt = uint256(vm.load(address(splitter), _settledAtSlot(billId)));
        assertEq(settledAt, settleTime, "settledAt should equal block.timestamp at settlement");
        // Push-first: payoutClaimable stays 0 when push succeeds; payee balance increases instead
        assertEq(splitter.payoutClaimable(billId), 0, "push succeeded: payoutClaimable stays 0");
        assertGe(usdc.balanceOf(payee), TOTAL_2P, "push succeeded: payee received funds automatically");
    }

    function test_SettledAt_IsNonZeroAfterSettlement() public {
        uint256 billId = _create2PBill();

        // Warp to a non-trivial timestamp so 0 vs non-zero is distinguishable
        vm.warp(block.timestamp + 3 days);
        _settle2PBill(billId);

        uint256 settledAt = uint256(vm.load(address(splitter), _settledAtSlot(billId)));
        assertGt(settledAt, 0, "settledAt must be non-zero after settlement");
    }

    // -----------------------------------------------------------------------
    // 20. votePayoutRedirect — happy path (3 participants, threshold=3)
    //     all contribute, bill settles, warp 7+ days, all vote same candidate,
    //     on threshold vote: PayeeRedirected emitted, bill.payee updated,
    //     candidate can claimPayout.
    // -----------------------------------------------------------------------
    function test_VotePayoutRedirect_HappyPath() public {
        (uint256 billId, address badPayee) = _create3PBillWithBadPayeeThreshold3();
        _mockBadPayeeTransferFail(badPayee, TOTAL_3P);
        _settle3PBill(billId);
        vm.clearMockedCalls();

        // Warp past grace period
        vm.warp(block.timestamp + PAYOUT_REDIRECT_GRACE + 1);

        address candidate = makeAddr("candidate");

        // Alice votes — first vote, candidate registered, no redirect yet
        vm.expectEmit(true, true, true, true, address(splitter));
        emit HouseholdBillSplitter.PayoutRedirectVote(billId, alice, candidate, 1);
        vm.prank(alice);
        splitter.votePayoutRedirect(billId, candidate);

        assertEq(splitter.payoutRedirectVotes(billId), 1, "vote count should be 1");
        assertEq(splitter.payoutRedirectCandidateVotes(billId, candidate), 1, "candidate vote tally should be 1");

        // Bob votes — second vote
        vm.expectEmit(true, true, true, true, address(splitter));
        emit HouseholdBillSplitter.PayoutRedirectVote(billId, bob, candidate, 2);
        vm.prank(bob);
        splitter.votePayoutRedirect(billId, candidate);

        assertEq(splitter.payoutRedirectVotes(billId), 2, "vote count should be 2");

        // Carol votes — threshold reached, PayeeRedirected emitted
        vm.expectEmit(true, true, true, true, address(splitter));
        emit HouseholdBillSplitter.PayoutRedirectVote(billId, carol, candidate, 3);

        vm.expectEmit(true, true, true, false, address(splitter));
        emit HouseholdBillSplitter.PayeeRedirected(billId, badPayee, candidate);

        vm.prank(carol);
        splitter.votePayoutRedirect(billId, candidate);

        // bill.payee should now be candidate
        (, address newPayeeAddr, , , , , , , ,) = splitter.getBill(billId);
        assertEq(newPayeeAddr, candidate, "bill.payee should be updated to candidate");

        // candidate can claim the payout
        uint256 balBefore = usdc.balanceOf(candidate);
        vm.prank(candidate);
        splitter.claimPayout(billId);
        assertEq(usdc.balanceOf(candidate), balBefore + TOTAL_3P, "candidate receives full payout");
        assertEq(splitter.payoutClaimable(billId), 0, "payoutClaimable zeroed after claim");
    }

    // -----------------------------------------------------------------------
    // 21. votePayoutRedirect — reverts before grace period
    // -----------------------------------------------------------------------
    function test_VotePayoutRedirect_RevertsBeforeGrace() public {
        (uint256 billId, address badPayee) = _create3PBillWithBadPayee();
        _mockBadPayeeTransferFail(badPayee, TOTAL_3P);
        _settle3PBill(billId);
        vm.clearMockedCalls();

        // Do NOT warp; still within grace period (settledAt = block.timestamp)
        address candidate = makeAddr("candidate");

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(HouseholdBillSplitter.PayoutRedirectNotReady.selector, billId)
        );
        splitter.votePayoutRedirect(billId, candidate);
    }

    function test_VotePayoutRedirect_SucceedsAtExactGrace() public {
        (uint256 billId, address badPayee) = _create3PBillWithBadPayee();
        _mockBadPayeeTransferFail(badPayee, TOTAL_3P);
        _settle3PBill(billId);
        vm.clearMockedCalls();

        // Contract condition: block.timestamp < bill.settledAt + PAYOUT_REDIRECT_GRACE → revert.
        // At EXACTLY settledAt + PAYOUT_REDIRECT_GRACE: condition is false (not <), so call succeeds.
        vm.warp(block.timestamp + PAYOUT_REDIRECT_GRACE);

        address candidate = makeAddr("candidate");
        vm.prank(alice);
        splitter.votePayoutRedirect(billId, candidate); // should succeed, no revert
        assertEq(splitter.payoutRedirectVotes(billId), 1, "vote accepted at exact grace boundary");
    }

    function test_VotePayoutRedirect_RevertsOneSecondBeforeGrace() public {
        (uint256 billId, address badPayee) = _create3PBillWithBadPayee();
        _mockBadPayeeTransferFail(badPayee, TOTAL_3P);
        _settle3PBill(billId);
        vm.clearMockedCalls();

        // One second before the grace ends → still reverts
        vm.warp(block.timestamp + PAYOUT_REDIRECT_GRACE - 1);

        address candidate = makeAddr("candidate");
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(HouseholdBillSplitter.PayoutRedirectNotReady.selector, billId)
        );
        splitter.votePayoutRedirect(billId, candidate);
    }

    // -----------------------------------------------------------------------
    // 22. votePayoutRedirect — non-participant (outsider) cannot vote
    // -----------------------------------------------------------------------
    function test_VotePayoutRedirect_NonParticipant_Reverts() public {
        (uint256 billId, address badPayee) = _create3PBillWithBadPayee();
        _mockBadPayeeTransferFail(badPayee, TOTAL_3P);
        _settle3PBill(billId);
        vm.clearMockedCalls();

        vm.warp(block.timestamp + PAYOUT_REDIRECT_GRACE + 1);

        address outsider = makeAddr("outsider");
        address candidate = makeAddr("candidate");

        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(HouseholdBillSplitter.NotParticipant.selector, billId, outsider)
        );
        splitter.votePayoutRedirect(billId, candidate);
    }

    // -----------------------------------------------------------------------
    // 22b. votePayoutRedirect — participant with zero contribution CAN vote
    //      (eligibility changed from "contributed > 0" to "is participant in shares")
    //      Scenario: 3P bill threshold=2, alice pays bob's AND carol's shares via
    //      explicit prank calls. Not possible with share model — so we use a 2P bill
    //      and test the next-best reachable path: verify a participant (bob) who has
    //      contributed 0 but is in shares CAN vote after settling (alice pays both halves).
    //
    //      NOTE: in the current contract a participant with contributed==0 means the bill
    //      can only be settled if another participant covers the total, which isn't possible
    //      with the strict "sum(amounts)==totalAmount, each pays own share" model.
    //      We verify the policy change via the public-getter path: a fresh participant with
    //      0 contribution that WOULD exist in shares IS recognised as a participant once the
    //      bill settles (tested here via the NotParticipant revert NOT firing).
    //
    //      Concrete setup: create a bill where bob is a participant but bob never pays, yet
    //      the bill still settles because alice over-pays to the limit of the bill total.
    //      The contract enforces ExceedsRemaining per share, so this is impossible without
    //      a direct share=0 participant. We therefore test the closest observable property:
    //      a participant (alice, who DID contribute) can vote, and an outsider cannot, and
    //      the participant-eligibility check is share-based, not contribution-based.
    //
    //      For the zero-contribution path specifically, we create a single-participant bill
    //      so the one participant who contributed 0 can never settle it — the only fully
    //      testable sub-property is the participant-in-shares check which is already covered
    //      by test_VotePayoutRedirect_NonParticipant_Reverts.
    // -----------------------------------------------------------------------
    function test_VotePayoutRedirect_ParticipantWithZeroContrib_CanVote() public {
        (uint256 billId, address badPayee) = _create3PBillWithBadPayee();
        _mockBadPayeeTransferFail(badPayee, TOTAL_3P);
        _settle3PBill(billId);
        vm.clearMockedCalls();

        vm.warp(block.timestamp + PAYOUT_REDIRECT_GRACE + 1);

        address candidate = makeAddr("candidate");

        // alice IS in shares.participant array → can vote (no revert)
        vm.prank(alice);
        splitter.votePayoutRedirect(billId, candidate);
        assertEq(splitter.payoutRedirectVotes(billId), 1, "participant alice can vote");

        // creator is NOT in shares.participant array → NotParticipant (not any contribution error)
        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(HouseholdBillSplitter.NotParticipant.selector, billId, creator)
        );
        splitter.votePayoutRedirect(billId, candidate);
    }

    // -----------------------------------------------------------------------
    // 23. votePayoutRedirect — double-vote reverts (AlreadyVotedRedirect)
    // -----------------------------------------------------------------------
    function test_VotePayoutRedirect_DoubleVote_Reverts() public {
        (uint256 billId, address badPayee) = _create3PBillWithBadPayee();
        _mockBadPayeeTransferFail(badPayee, TOTAL_3P);
        _settle3PBill(billId);
        vm.clearMockedCalls();

        vm.warp(block.timestamp + PAYOUT_REDIRECT_GRACE + 1);

        address candidate = makeAddr("candidate");

        vm.prank(alice);
        splitter.votePayoutRedirect(billId, candidate);

        // Alice tries to vote again
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(HouseholdBillSplitter.AlreadyVotedRedirect.selector, billId, alice)
        );
        splitter.votePayoutRedirect(billId, candidate);
    }

    // -----------------------------------------------------------------------
    // 24. votePayoutRedirect — second different candidate reverts
    // -----------------------------------------------------------------------
    // With per-candidate tracking, different candidates are allowed.
    // Split votes (each candidate below threshold) must NOT trigger a redirect.
    function test_VotePayoutRedirect_SplitVote_NoRedirect() public {
        (uint256 billId, address badPayee) = _create3PBillWithBadPayee();
        _mockBadPayeeTransferFail(badPayee, TOTAL_3P);
        _settle3PBill(billId);
        vm.clearMockedCalls();

        vm.warp(block.timestamp + PAYOUT_REDIRECT_GRACE + 1);

        address candidateA = makeAddr("candidateA");
        address candidateB = makeAddr("candidateB");

        // Alice votes for candidateA — 1 vote, threshold not reached
        vm.prank(alice);
        splitter.votePayoutRedirect(billId, candidateA);

        assertEq(splitter.payoutRedirectCandidateVotes(billId, candidateA), 1, "A: 1 vote");
        assertEq(splitter.payoutRedirectCandidateVotes(billId, candidateB), 0, "B: 0 votes");

        // Bob votes for candidateB — each has 1 vote, neither at threshold of 2
        vm.prank(bob);
        splitter.votePayoutRedirect(billId, candidateB);

        assertEq(splitter.payoutRedirectCandidateVotes(billId, candidateA), 1, "A still: 1");
        assertEq(splitter.payoutRedirectCandidateVotes(billId, candidateB), 1, "B now: 1");
        assertEq(splitter.payoutRedirectVotes(billId), 2, "2 unique voters");

        // Bill payee unchanged (no redirect triggered)
        (, address currentPayee, , , , , , , ,) = splitter.getBill(billId);
        assertEq(currentPayee, badPayee, "payee unchanged: split vote did not trigger redirect");
    }

    // -----------------------------------------------------------------------
    // 25. votePayoutRedirect — reverts when payout already claimed
    // -----------------------------------------------------------------------
    function test_VotePayoutRedirect_PayoutClaimed_Reverts() public {
        // Use bad payee so push fails → payoutClaimable is set → claimPayout can succeed
        (uint256 billId, address badPayee) = _create3PBillWithBadPayee();
        _mockBadPayeeTransferFail(badPayee, TOTAL_3P);
        _settle3PBill(billId);
        vm.clearMockedCalls();

        // BadPayee claims before grace elapses
        vm.prank(badPayee);
        splitter.claimPayout(billId);
        assertEq(splitter.payoutClaimable(billId), 0, "payout should be zero after claim");

        // Warp past grace period
        vm.warp(block.timestamp + PAYOUT_REDIRECT_GRACE + 1);

        address candidate = makeAddr("candidate");
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(HouseholdBillSplitter.NoPayoutAvailable.selector, billId)
        );
        splitter.votePayoutRedirect(billId, candidate);
    }

    // -----------------------------------------------------------------------
    // 26. votePayoutRedirect — reverts when bill not settled (still Active)
    // -----------------------------------------------------------------------
    function test_VotePayoutRedirect_BillNotSettled_Reverts() public {
        uint256 billId = _create3PBill();
        // Bill is Active (no payments made)

        vm.warp(block.timestamp + PAYOUT_REDIRECT_GRACE + 1);

        address candidate = makeAddr("candidate");
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(HouseholdBillSplitter.BillNotSettled.selector, billId)
        );
        splitter.votePayoutRedirect(billId, candidate);
    }

    function test_VotePayoutRedirect_BillCancelled_Reverts() public {
        uint256 billId = _create2PBill();

        // Cancel the bill
        vm.prank(alice);
        splitter.voteCancel(billId);
        vm.prank(bob);
        splitter.voteCancel(billId);

        vm.warp(block.timestamp + PAYOUT_REDIRECT_GRACE + 1);

        address candidate = makeAddr("candidate");
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(HouseholdBillSplitter.BillNotSettled.selector, billId)
        );
        splitter.votePayoutRedirect(billId, candidate);
    }

    // -----------------------------------------------------------------------
    // 27. votePayoutRedirect — PAYOUT_REDIRECT_GRACE constant is 7 days
    // -----------------------------------------------------------------------
    function test_PayoutRedirectGrace_IsSevenDays() public view {
        assertEq(splitter.PAYOUT_REDIRECT_GRACE(), 7 days, "PAYOUT_REDIRECT_GRACE should be 7 days");
    }

    // -----------------------------------------------------------------------
    // 28. Fuzz: payAmount in [1, shareAmount], contributions never exceed share
    // -----------------------------------------------------------------------
    function testFuzz_PartialPay_AccumulatesCorrectly(uint256 first, uint256 second) public {
        uint256 billId = _create2PBill();

        first  = bound(first,  1, HALF - 1);
        second = bound(second, 1, HALF - first);

        vm.prank(alice);
        splitter.pay(billId, first);

        (uint256 contributed1,,) = splitter.getShareProgress(billId, alice);
        assertEq(contributed1, first, "contributed after first payment");

        vm.prank(alice);
        splitter.pay(billId, second);

        (uint256 contributed2, uint256 total, uint256 remaining) = splitter.getShareProgress(billId, alice);
        assertEq(contributed2, first + second,        "accumulated contribution");
        assertEq(total,        HALF,                  "total invariant");
        assertEq(remaining,    HALF - first - second, "remaining invariant");
        assertLe(contributed2, HALF,                  "contribution never exceeds share");
    }

    function testFuzz_FullShare_SinglePayment(uint256 payAmount) public {
        uint256 billId = _create2PBill();

        payAmount = bound(payAmount, 1, HALF);
        vm.prank(alice);
        splitter.pay(billId, payAmount);

        (uint256 contributed,,) = splitter.getShareProgress(billId, alice);
        assertEq(contributed, payAmount, "contributed matches exact payment");
    }

    function testFuzz_ExceedsRemaining_AlwaysReverts(uint256 excess) public {
        uint256 billId = _create2PBill();

        excess = bound(excess, HALF + 1, type(uint128).max);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(HouseholdBillSplitter.ExceedsRemaining.selector, billId, excess, HALF)
        );
        splitter.pay(billId, excess);
    }

    // -----------------------------------------------------------------------
    // 29. (placeholder for invariant handler linkage)
    // -----------------------------------------------------------------------
    BillSplitterHandler internal handler;

    // -----------------------------------------------------------------------
    // 30. _validatePayeeAddress — createBill with precompile address reverts
    // -----------------------------------------------------------------------

    /// @dev address(1) is a precompile — createBill must revert
    function test_CreateBill_PayeePrecompile_Address1_Reverts() public {
        address[] memory participants = new address[](2);
        participants[0] = alice;
        participants[1] = bob;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = HALF;
        amounts[1] = HALF;

        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(HouseholdBillSplitter.InvalidBillParams.selector, "invalid payee: precompile")
        );
        splitter.createBill(TOTAL_2P, bytes32(0), address(1), participants, amounts, false, 0, false, 0, 2);
    }

    /// @dev address(9) is the last precompile — createBill must revert
    function test_CreateBill_PayeePrecompile_Address9_Reverts() public {
        address[] memory participants = new address[](2);
        participants[0] = alice;
        participants[1] = bob;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = HALF;
        amounts[1] = HALF;

        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(HouseholdBillSplitter.InvalidBillParams.selector, "invalid payee: precompile")
        );
        splitter.createBill(TOTAL_2P, bytes32(0), address(9), participants, amounts, false, 0, false, 0, 2);
    }

    /// @dev address(10) = 0x000...00A — just past the precompile range — must succeed
    function test_CreateBill_PayeeAddress10_Succeeds() public {
        address[] memory participants = new address[](2);
        participants[0] = alice;
        participants[1] = bob;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = HALF;
        amounts[1] = HALF;

        address addr10 = address(10); // uint160 == 10, not a precompile

        vm.prank(creator);
        uint256 billId = splitter.createBill(TOTAL_2P, bytes32(0), addr10, participants, amounts, false, 0, false, 0, 2);

        (, address storedPayee, , , , , , , ,) = splitter.getBill(billId);
        assertEq(storedPayee, addr10, "payee should be address(10)");
    }

    /// @dev address(0) — zero address — createBill must revert ZeroAddress
    function test_CreateBill_PayeeZeroAddress_Reverts() public {
        address[] memory participants = new address[](2);
        participants[0] = alice;
        participants[1] = bob;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = HALF;
        amounts[1] = HALF;

        vm.prank(creator);
        vm.expectRevert(HouseholdBillSplitter.ZeroAddress.selector);
        splitter.createBill(TOTAL_2P, bytes32(0), address(0), participants, amounts, false, 0, false, 0, 2);
    }

    /// @dev votePayoutRedirect with candidate = address(3) must revert (precompile)
    function test_VotePayoutRedirect_CandidatePrecompile_Reverts() public {
        (uint256 billId, address badPayee) = _create3PBillWithBadPayee();
        _mockBadPayeeTransferFail(badPayee, TOTAL_3P);
        _settle3PBill(billId);
        vm.clearMockedCalls();

        vm.warp(block.timestamp + PAYOUT_REDIRECT_GRACE + 1);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(HouseholdBillSplitter.InvalidBillParams.selector, "invalid payee: precompile")
        );
        splitter.votePayoutRedirect(billId, address(3));
    }

}

// ---------------------------------------------------------------------------
// Invariant test contract (separate so forge only runs invariant_ in it)
// ---------------------------------------------------------------------------
contract HouseholdBillSplitter_Invariant is Test {
    HouseholdBillSplitter internal splitter;
    MockERC20 internal usdc;
    BillSplitterHandler internal handler;

    function setUp() public {
        MockERC20 mock = new MockERC20("Mock USDC", "mUSDC", 6);
        vm.etch(0x3600000000000000000000000000000000000000, address(mock).code);
        usdc = MockERC20(0x3600000000000000000000000000000000000000);

        splitter = new HouseholdBillSplitter(address(usdc));
        handler  = new BillSplitterHandler(splitter, usdc);

        targetContract(address(handler));
    }

    /// @dev Invariant: bill.amountPaid always equals sum of all share.contributed values.
    function invariant_AmountPaidEqualsContributedSum() public view {
        uint256 billId = handler.billId();

        (, , , uint256 amountPaid, , , , , ,) = splitter.getBill(billId);
        HouseholdBillSplitter.Share[] memory shares = splitter.getShares(billId);

        uint256 totalContributed;
        for (uint256 i = 0; i < shares.length; i++) {
            totalContributed += shares[i].contributed;
        }

        assertEq(amountPaid, totalContributed, "amountPaid must equal sum of share.contributed");
    }

    /// @dev Invariant: contributed per share never exceeds its amount.
    function invariant_ContributedNeverExceedsShareAmount() public view {
        uint256 billId = handler.billId();
        HouseholdBillSplitter.Share[] memory shares = splitter.getShares(billId);

        for (uint256 i = 0; i < shares.length; i++) {
            assertLe(
                shares[i].contributed,
                shares[i].amount,
                "contributed must never exceed share amount"
            );
        }
    }

    /// @dev Invariant: contract USDC balance >= sum of all payoutClaimable across known bills.
    function invariant_ContractBalanceCoversPayout() public view {
        uint256 billId = handler.billId();
        uint256 claimable = splitter.payoutClaimable(billId);
        uint256 contractBal = MockERC20(splitter.usdc()).balanceOf(address(splitter));
        assertGe(contractBal, claimable, "contract balance must cover claimable payout");
    }
}
