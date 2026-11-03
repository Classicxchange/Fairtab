// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {FairID} from "../FairID.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Bounded action surface for the invariant fuzzer.
contract FairIDHandler is Test {
    FairID public fair;
    uint256 public claims;
    address[] public actors;
    string[5] internal _names = ["alice", "bob", "carol", "dave_1", "eve"];

    constructor(FairID _fair) {
        fair = _fair;
        actors.push(address(0xA11CE));
        actors.push(address(0xB0B));
        actors.push(address(0xCA401));
        actors.push(address(0xDA7E));
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function nameCount() external view returns (uint256) {
        return _names.length;
    }

    function nameAt(uint256 i) external view returns (string memory) {
        return _names[i];
    }

    function claim(uint256 a, uint256 n) external {
        address actor = actors[bound(a, 0, actors.length - 1)];
        string memory name = _names[bound(n, 0, _names.length - 1)];
        vm.prank(actor);
        try fair.claim(name) {
            claims++;
        } catch {}
    }

    function release(uint256 a) external {
        address actor = actors[bound(a, 0, actors.length - 1)];
        vm.prank(actor);
        try fair.release() {} catch {}
    }

    function propose(uint256 a, uint256 b) external {
        address actor = actors[bound(a, 0, actors.length - 1)];
        address to = actors[bound(b, 0, actors.length - 1)];
        vm.prank(actor);
        try fair.proposeTransfer(to) {} catch {}
    }

    function cancel(uint256 a) external {
        address actor = actors[bound(a, 0, actors.length - 1)];
        vm.prank(actor);
        try fair.cancelTransfer() {} catch {}
    }

    function accept(uint256 a, uint256 b) external {
        address actor = actors[bound(a, 0, actors.length - 1)];
        address from = actors[bound(b, 0, actors.length - 1)];
        vm.prank(actor);
        try fair.acceptTransfer(from) {} catch {}
    }

    function warp(uint256 secs) external {
        skip(bound(secs, 0, 40 days));
    }
}

/// @dev Token whose transferFrom reports failure by returning false.
contract FalseReturningToken {
    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }
}

/// @dev Token whose transferFrom always reverts.
contract RevertingToken {
    function transferFrom(address, address, uint256) external pure returns (bool) {
        revert("token boom");
    }
}

/// @dev Token that re-enters FairID.claim from transferFrom.
contract ReentrantToken {
    FairID public target;
    bool public bubble; // true: propagate the reentrancy revert; false: swallow it and report success
    bool public attempted;
    bytes4 public caughtSelector;

    function configure(FairID t, bool bubble_) external {
        target = t;
        bubble = bubble_;
    }

    function transferFrom(address, address, uint256) external returns (bool) {
        attempted = true;
        try target.claim("reenter_name") {
            // reentry succeeded: should never happen
        } catch (bytes memory reason) {
            caughtSelector = bytes4(reason);
            if (bubble) {
                assembly {
                    revert(add(reason, 0x20), mload(reason))
                }
            }
        }
        return true;
    }
}

contract FairIDTest is Test {
    FairID internal fair;
    FairIDHandler internal handler;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal attacker = makeAddr("attacker");

    uint256 internal constant PERIOD = 30 days;
    bytes internal constant CHARSET = "abcdefghijklmnopqrstuvwxyz0123456789_";

    event NameClaimed(address indexed owner, bytes32 indexed nameHash, string name);
    event NameReleased(address indexed owner, bytes32 indexed nameHash, string name);
    event NameTransferred(address indexed from, address indexed to, bytes32 indexed nameHash, string name);
    event TransferProposed(address indexed from, address indexed to, bytes32 indexed nameHash, string name);
    event TransferCancelled(address indexed from, address indexed to, bytes32 indexed nameHash);

    MockERC20 internal usdc;
    address internal treasury = makeAddr("treasury");
    uint256 internal constant FEE = 5e6;

    event FeePaid(address indexed payer, uint256 amount);

    function setUp() public {
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        fair = new FairID(IERC20(address(usdc)), treasury, FEE);
        handler = new FairIDHandler(fair);
        targetContract(address(handler));

        address[4] memory users = [alice, bob, carol, attacker];
        for (uint256 i; i < users.length; i++) {
            _fund(users[i], 1_000e6);
        }
        for (uint256 i; i < handler.actorCount(); i++) {
            _fund(handler.actors(i), 1_000_000e6);
        }
    }

    // ---------------------------------------------------------------- funding

    /// @dev Mint USDC to `who` and approve `fair` for max.
    function _fund(address who, uint256 amount) internal {
        _fundFor(fair, who, amount);
    }

    function _fundFor(FairID target, address who, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.prank(who);
        usdc.approve(address(target), type(uint256).max);
    }

    function _bal(address who) internal view returns (uint256) {
        return usdc.balanceOf(who);
    }

    // ---------------------------------------------------------------- helpers

    function h(string memory s) internal pure returns (bytes32) {
        return keccak256(bytes(s));
    }

    function _claim(address who, string memory name) internal {
        vm.prank(who);
        fair.claim(name);
    }

    function _release(address who) internal {
        vm.prank(who);
        fair.release();
    }

    function _propose(address from, address to) internal {
        vm.prank(from);
        fair.proposeTransfer(to);
    }

    function _accept(address who, address from) internal {
        vm.prank(who);
        fair.acceptTransfer(from);
    }

    function _refValid(bytes memory b) internal pure returns (bool) {
        if (b.length < 3 || b.length > 20) return false;
        for (uint256 i; i < b.length; i++) {
            uint8 c = uint8(b[i]);
            bool ok = (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x5f;
            if (!ok) return false;
        }
        return true;
    }

    function _repeat(bytes1 ch, uint256 len) internal pure returns (string memory) {
        bytes memory b = new bytes(len);
        for (uint256 i; i < len; i++) b[i] = ch;
        return string(b);
    }

    // ------------------------------------------------------------- claim

    function test_ClaimHappyPath() public {
        _claim(alice, "alice");
        assertEq(fair.ownerOf(h("alice")), alice);
        assertEq(fair.nameOf(alice), "alice");
        assertEq(fair.resolve("alice"), alice);
        assertFalse(fair.isAvailable("alice"));
    }

    function test_ClaimEmitsNameClaimed() public {
        vm.expectEmit(true, true, false, true, address(fair));
        emit NameClaimed(alice, h("alice"), "alice");
        _claim(alice, "alice");
    }

    function test_ClaimRevertsNameTaken() public {
        _claim(alice, "alice");
        vm.expectRevert(abi.encodeWithSelector(FairID.NameTaken.selector, h("alice")));
        _claim(bob, "alice");
    }

    function test_ClaimRevertsNameTakenForOwnerToo() public {
        _claim(alice, "alice");
        vm.expectRevert(abi.encodeWithSelector(FairID.NameTaken.selector, h("alice")));
        _claim(alice, "alice");
    }

    function test_ClaimRevertsAlreadyHasName() public {
        _claim(alice, "alice");
        vm.expectRevert(FairID.AlreadyHasName.selector);
        _claim(alice, "alice2");
        assertEq(fair.nameOf(alice), "alice");
        assertEq(fair.resolve("alice2"), address(0));
    }

    function test_ClaimInvalidNameRevertsBeforeOtherChecks() public {
        _claim(alice, "alice");
        vm.expectRevert(FairID.InvalidName.selector);
        _claim(alice, "Bad");
    }

    // ------------------------------------------------------ name validation

    function test_LengthBoundaries() public view {
        assertFalse(fair.isValidName(""));
        assertFalse(fair.isValidName("ab"));
        assertTrue(fair.isValidName("abc"));
        assertTrue(fair.isValidName("abcdefghijklmnopqrst")); // 20
        assertFalse(fair.isValidName("abcdefghijklmnopqrstu")); // 21
    }

    function test_ClaimLengthBoundaries() public {
        _claim(alice, "abc");
        _claim(bob, "abcdefghijklmnopqrst");
        vm.expectRevert(FairID.InvalidName.selector);
        _claim(carol, "ab");
        vm.expectRevert(FairID.InvalidName.selector);
        _claim(carol, "abcdefghijklmnopqrstu");
        vm.expectRevert(FairID.InvalidName.selector);
        _claim(carol, "");
    }

    function test_UppercaseInvalid() public view {
        assertFalse(fair.isValidName("Alice"));
        assertFalse(fair.isValidName("aliCe"));
        assertFalse(fair.isValidName("ALICE"));
        assertFalse(fair.isValidName("abcZ"));
    }

    function test_SymbolsInvalid() public view {
        assertFalse(fair.isValidName("a-b"));
        assertFalse(fair.isValidName("a.b"));
        assertFalse(fair.isValidName("a b"));
        assertFalse(fair.isValidName("a@b"));
        assertFalse(fair.isValidName("abc!"));
        assertFalse(fair.isValidName("abc/"));
        assertFalse(fair.isValidName("abc:")); // just above '9'
        assertFalse(fair.isValidName("abc{")); // just above 'z'
        assertFalse(fair.isValidName("abc`")); // just below 'a'
        assertFalse(fair.isValidName("abc/")); // just below '0'
    }

    function test_NonAsciiInvalid() public view {
        assertFalse(fair.isValidName(unicode"café"));
        assertFalse(fair.isValidName(string(bytes(hex"c3a9c3a9c3a9"))));
        assertFalse(fair.isValidName(string(bytes(hex"616263ff"))));
        assertFalse(fair.isValidName(string(bytes(hex"61626300")))); // NUL byte
        assertFalse(fair.isValidName(string(bytes(hex"6162637f")))); // DEL
        assertFalse(fair.isValidName(unicode"日本語"));
    }

    function test_UnderscoresAndDigitsAreValid() public view {
        assertTrue(fair.isValidName("___"));
        assertTrue(fair.isValidName("_abc"));
        assertTrue(fair.isValidName("abc_"));
        assertTrue(fair.isValidName("a__b"));
        assertTrue(fair.isValidName("1abc"));
        assertTrue(fair.isValidName("123"));
        assertTrue(fair.isValidName("a_1_"));
    }

    function test_ClaimUnderscoreAndDigitNames() public {
        _claim(alice, "_x_");
        _claim(bob, "9lives");
        _claim(carol, "a__b");
        assertEq(fair.resolve("_x_"), alice);
        assertEq(fair.resolve("9lives"), bob);
        assertEq(fair.resolve("a__b"), carol);
    }

    // ----------------------------------------------------- release / reserve

    function test_ReleaseClearsResolution() public {
        _claim(alice, "alice");
        _release(alice);
        assertEq(fair.resolve("alice"), address(0));
        assertEq(fair.ownerOf(h("alice")), address(0));
        assertEq(bytes(fair.nameOf(alice)).length, 0);
        assertEq(fair.previousOwner(h("alice")), alice);
        assertEq(fair.releasedAt(h("alice")), block.timestamp);
    }

    function test_ReleaseEmitsNameReleased() public {
        _claim(alice, "alice");
        vm.expectEmit(true, true, false, true, address(fair));
        emit NameReleased(alice, h("alice"), "alice");
        _release(alice);
    }

    function test_ReleaseRevertsNoName() public {
        vm.expectRevert(FairID.NoName.selector);
        _release(alice);
    }

    function test_ReservedForPreviousOwnerBeforeExpiry() public {
        _claim(alice, "alice");
        _release(alice);
        uint256 t0 = block.timestamp;

        vm.expectRevert(abi.encodeWithSelector(FairID.NameReserved.selector, h("alice"), alice));
        _claim(bob, "alice");

        vm.warp(t0 + PERIOD - 1);
        vm.expectRevert(abi.encodeWithSelector(FairID.NameReserved.selector, h("alice"), alice));
        _claim(bob, "alice");
        assertFalse(fair.isAvailable("alice"));
    }

    function test_AnyoneCanClaimAtExactlyExpiry() public {
        _claim(alice, "alice");
        _release(alice);
        vm.warp(block.timestamp + PERIOD);
        assertTrue(fair.isAvailable("alice"));
        _claim(bob, "alice");
        assertEq(fair.resolve("alice"), bob);
        assertEq(fair.previousOwner(h("alice")), address(0));
        assertEq(fair.releasedAt(h("alice")), 0);
    }

    function test_PreviousOwnerCanReclaimEarly() public {
        _claim(alice, "alice");
        _release(alice);
        vm.warp(block.timestamp + 1 days);
        _claim(alice, "alice");
        assertEq(fair.resolve("alice"), alice);
        assertEq(fair.nameOf(alice), "alice");
        assertEq(fair.previousOwner(h("alice")), address(0));
        assertEq(fair.releasedAt(h("alice")), 0);
    }

    function test_PreviousOwnerCanReclaimAfterExpiry() public {
        _claim(alice, "alice");
        _release(alice);
        vm.warp(block.timestamp + PERIOD + 10 days);
        _claim(alice, "alice");
        assertEq(fair.resolve("alice"), alice);
    }

    function test_PreviousOwnerWithAnotherNameCannotReclaim() public {
        _claim(alice, "alice");
        _release(alice);
        _claim(alice, "alice2");
        vm.expectRevert(FairID.AlreadyHasName.selector);
        _claim(alice, "alice");
    }

    function test_ReservationSurvivesOwnerTakingOtherName() public {
        _claim(alice, "alice");
        _release(alice);
        _claim(alice, "alice2");
        vm.expectRevert(abi.encodeWithSelector(FairID.NameReserved.selector, h("alice"), alice));
        _claim(bob, "alice");
    }

    function test_ReleasedAtRestartedByNewRelease() public {
        _claim(alice, "alice");
        _release(alice);
        vm.warp(block.timestamp + 10 days);
        _claim(alice, "alice");
        _release(alice);
        uint256 t1 = block.timestamp;
        vm.warp(t1 + PERIOD - 1);
        vm.expectRevert(abi.encodeWithSelector(FairID.NameReserved.selector, h("alice"), alice));
        _claim(bob, "alice");
        vm.warp(t1 + PERIOD);
        _claim(bob, "alice");
    }

    // ----------------------------------------------------------- transfers

    function test_ProposeStoresAndEmits() public {
        _claim(alice, "alice");
        vm.expectEmit(true, true, true, true, address(fair));
        emit TransferProposed(alice, bob, h("alice"), "alice");
        _propose(alice, bob);
        (address to, bytes32 nh) = fair.pendingTransferOf(alice);
        assertEq(to, bob);
        assertEq(nh, h("alice"));
        // ownership and resolution unchanged
        assertEq(fair.resolve("alice"), alice);
        assertEq(fair.nameOf(alice), "alice");
    }

    function test_ProposeRevertsNoName() public {
        vm.expectRevert(FairID.NoName.selector);
        _propose(alice, bob);
    }

    function test_ProposeRevertsZeroAddress() public {
        _claim(alice, "alice");
        vm.expectRevert(FairID.ZeroAddress.selector);
        _propose(alice, address(0));
    }

    function test_ProposeRevertsSelf() public {
        _claim(alice, "alice");
        vm.expectRevert(FairID.SameAddress.selector);
        _propose(alice, alice);
    }

    function test_ProposeToRecipientWithNameAllowed() public {
        _claim(alice, "alice");
        _claim(bob, "bob");
        _propose(alice, bob);
        (address to,) = fair.pendingTransferOf(alice);
        assertEq(to, bob);
    }

    function test_CancelTransfer() public {
        _claim(alice, "alice");
        _propose(alice, bob);
        vm.expectEmit(true, true, true, true, address(fair));
        emit TransferCancelled(alice, bob, h("alice"));
        vm.prank(alice);
        fair.cancelTransfer();
        (address to, bytes32 nh) = fair.pendingTransferOf(alice);
        assertEq(to, address(0));
        assertEq(nh, bytes32(0));
        vm.expectRevert(FairID.NoPendingTransfer.selector);
        _accept(bob, alice);
        assertEq(fair.resolve("alice"), alice);
    }

    function test_CancelRevertsWithoutProposal() public {
        vm.expectRevert(FairID.NoPendingTransfer.selector);
        vm.prank(alice);
        fair.cancelTransfer();
        _claim(alice, "alice");
        vm.expectRevert(FairID.NoPendingTransfer.selector);
        vm.prank(alice);
        fair.cancelTransfer();
    }

    function test_AcceptMovesNameAndEmits() public {
        _claim(alice, "alice");
        _propose(alice, bob);
        vm.expectEmit(true, true, true, true, address(fair));
        emit NameTransferred(alice, bob, h("alice"), "alice");
        _accept(bob, alice);

        assertEq(fair.ownerOf(h("alice")), bob);
        assertEq(fair.resolve("alice"), bob);
        assertEq(fair.nameOf(bob), "alice");
        assertEq(bytes(fair.nameOf(alice)).length, 0);
        assertEq(fair.previousOwner(h("alice")), address(0));
        assertEq(fair.releasedAt(h("alice")), 0);
        (address to, bytes32 nh) = fair.pendingTransferOf(alice);
        assertEq(to, address(0));
        assertEq(nh, bytes32(0));
    }

    function test_AcceptCreatesNoReservationForSender() public {
        _claim(alice, "alice");
        _propose(alice, bob);
        _accept(bob, alice);
        // alice can take a fresh name and has no claim on "alice"
        _claim(alice, "alice2");
        assertEq(fair.resolve("alice"), bob);
        vm.expectRevert(abi.encodeWithSelector(FairID.NameTaken.selector, h("alice")));
        _claim(carol, "alice");
        // after bob releases, reservation is for bob
        _release(bob);
        vm.expectRevert(abi.encodeWithSelector(FairID.NameReserved.selector, h("alice"), bob));
        _claim(carol, "alice");
    }

    function test_AcceptSecondTimeReverts() public {
        _claim(alice, "alice");
        _propose(alice, bob);
        _accept(bob, alice);
        vm.expectRevert(FairID.NoPendingTransfer.selector);
        _accept(bob, alice);
    }

    function test_OnlyIntendedRecipientCanAccept() public {
        _claim(alice, "alice");
        _propose(alice, bob);
        vm.expectRevert(FairID.NoPendingTransfer.selector);
        _accept(carol, alice);
        vm.expectRevert(FairID.NoPendingTransfer.selector);
        _accept(alice, alice);
        assertEq(fair.resolve("alice"), alice);
    }

    function test_AcceptWithoutProposalReverts() public {
        _claim(alice, "alice");
        vm.expectRevert(FairID.NoPendingTransfer.selector);
        _accept(bob, alice);
        vm.expectRevert(FairID.NoPendingTransfer.selector);
        _accept(bob, carol);
    }

    function test_AcceptRevertsWhenRecipientHasName() public {
        _claim(alice, "alice");
        _claim(bob, "bob");
        _propose(alice, bob);
        vm.expectRevert(abi.encodeWithSelector(FairID.RecipientHasName.selector, bob));
        _accept(bob, alice);
        assertEq(fair.resolve("alice"), alice);
        assertEq(fair.resolve("bob"), bob);
    }

    function test_RecipientCanAcceptAfterReleasingOwnName() public {
        _claim(alice, "alice");
        _claim(bob, "bob");
        _propose(alice, bob);
        _release(bob);
        _accept(bob, alice);
        assertEq(fair.nameOf(bob), "alice");
    }

    function test_StaleProposalAfterHolderReleased() public {
        _claim(alice, "alice");
        _propose(alice, bob);
        _release(alice);
        vm.expectRevert(FairID.NoPendingTransfer.selector);
        _accept(bob, alice);
        // reclaiming the same name must not resurrect the proposal
        _claim(alice, "alice");
        vm.expectRevert(FairID.NoPendingTransfer.selector);
        _accept(bob, alice);
        assertEq(fair.resolve("alice"), alice);
    }

    function test_StaleProposalAfterHolderChangedName() public {
        _claim(alice, "alice");
        _propose(alice, bob);
        _release(alice);
        _claim(alice, "alice2");
        vm.expectRevert(FairID.NoPendingTransfer.selector);
        _accept(bob, alice);
        assertEq(bytes(fair.nameOf(bob)).length, 0);
        assertEq(fair.resolve("alice2"), alice);
    }

    function test_StaleProposalAfterNameClaimedByOther() public {
        _claim(alice, "alice");
        _propose(alice, bob);
        _release(alice);
        vm.warp(block.timestamp + PERIOD);
        _claim(carol, "alice");
        vm.expectRevert(FairID.NoPendingTransfer.selector);
        _accept(bob, alice);
        vm.expectRevert(FairID.NoPendingTransfer.selector);
        _accept(bob, carol);
        assertEq(fair.resolve("alice"), carol);
    }

    function test_ReleaseClearsPendingProposal() public {
        _claim(alice, "alice");
        _propose(alice, bob);
        _release(alice);
        (address to, bytes32 nh) = fair.pendingTransferOf(alice);
        assertEq(to, address(0));
        assertEq(nh, bytes32(0));
        vm.expectRevert(FairID.NoPendingTransfer.selector);
        vm.prank(alice);
        fair.cancelTransfer();
    }

    function test_ProposalOverwritten() public {
        _claim(alice, "alice");
        _propose(alice, bob);
        _propose(alice, carol);
        (address to,) = fair.pendingTransferOf(alice);
        assertEq(to, carol);
        vm.expectRevert(FairID.NoPendingTransfer.selector);
        _accept(bob, alice);
        _accept(carol, alice);
        assertEq(fair.resolve("alice"), carol);
    }

    // ----------------------------------------------------------- grief case

    function test_AttackerCannotForceNameOntoVictim() public {
        _claim(attacker, "spam");
        _propose(attacker, bob);
        // victim untouched
        assertEq(bytes(fair.nameOf(bob)).length, 0);
        assertEq(fair.resolve("spam"), attacker);
        assertEq(fair.ownerOf(h("spam")), attacker);
        // attacker cannot accept on the victim's behalf, nor self-accept
        vm.expectRevert(FairID.NoPendingTransfer.selector);
        _accept(attacker, attacker);
        // victim is still free to claim own name and ignore the proposal
        _claim(bob, "bob");
        assertEq(fair.nameOf(bob), "bob");
        vm.expectRevert(abi.encodeWithSelector(FairID.RecipientHasName.selector, bob));
        _accept(bob, attacker);
        assertEq(fair.nameOf(bob), "bob");
    }

    function test_AttackerCannotBlockVictimClaim() public {
        _claim(attacker, "spam");
        _propose(attacker, bob);
        _claim(bob, "bobby");
        assertEq(fair.resolve("bobby"), bob);
    }

    // ---------------------------------------------------------------- views

    function test_IsAvailableViews() public {
        assertTrue(fair.isAvailable("alice"));
        assertFalse(fair.isAvailable("Alice"));
        assertFalse(fair.isAvailable("ab"));
        assertTrue(fair.isAvailableFor("alice", bob));
        assertFalse(fair.isAvailableFor("ab", bob));

        _claim(alice, "alice");
        assertFalse(fair.isAvailable("alice"));
        assertFalse(fair.isAvailableFor("alice", alice));
        assertFalse(fair.isAvailableFor("alice", bob));
    }

    function test_IsAvailableForDuringReservation() public {
        _claim(alice, "alice");
        _release(alice);
        assertFalse(fair.isAvailable("alice"));
        assertTrue(fair.isAvailableFor("alice", alice));
        assertFalse(fair.isAvailableFor("alice", bob));
        vm.warp(block.timestamp + PERIOD - 1);
        assertFalse(fair.isAvailableFor("alice", bob));
        vm.warp(block.timestamp + 1);
        assertTrue(fair.isAvailable("alice"));
        assertTrue(fair.isAvailableFor("alice", bob));
    }

    function test_IsAvailableForIgnoresCallerHavingName() public {
        _claim(alice, "alice");
        assertTrue(fair.isAvailableFor("other", alice));
        assertTrue(fair.isAvailable("other"));
    }

    function test_ResolveViews() public {
        assertEq(fair.resolve("alice"), address(0));
        assertEq(fair.resolve("A"), address(0));
        assertEq(fair.resolve(""), address(0));
        _claim(alice, "alice");
        assertEq(fair.resolve("alice"), alice);
        assertEq(fair.resolve("Alice"), address(0));
        assertEq(bytes(fair.nameOf(bob)).length, 0);
    }

    function test_Constants() public view {
        assertEq(fair.MIN_NAME_LENGTH(), 3);
        assertEq(fair.MAX_NAME_LENGTH(), 20);
        assertEq(fair.RESERVATION_PERIOD(), 30 days);
    }

    // ----------------------------------------------------------------- fuzz

    function testFuzz_ValidCharsetLength3To20IsValid(bytes32 seed, uint256 len) public {
        len = bound(len, 3, 20);
        bytes memory b = new bytes(len);
        for (uint256 i; i < len; i++) {
            b[i] = CHARSET[uint256(keccak256(abi.encode(seed, i))) % CHARSET.length];
        }
        string memory name = string(b);
        assertTrue(fair.isValidName(name));
        assertTrue(fair.isAvailable(name));
        _claim(alice, name);
        assertEq(fair.resolve(name), alice);
    }

    function testFuzz_LengthDeterminesValidity(uint256 len) public view {
        len = bound(len, 0, 60);
        assertEq(fair.isValidName(_repeat("a", len)), len >= 3 && len <= 20);
    }

    function testFuzz_AnyStringMatchesReference(string memory s) public {
        bool expected = _refValid(bytes(s));
        assertEq(fair.isValidName(s), expected);
        assertEq(fair.isAvailable(s), expected);
        assertEq(fair.resolve(s) == address(0), true);
        if (!expected) {
            vm.expectRevert(FairID.InvalidName.selector);
            _claim(alice, s);
        }
    }

    function testFuzz_SingleBadByteInvalidates(uint256 pos, uint8 bad, uint256 len) public view {
        len = bound(len, 3, 20);
        pos = bound(pos, 0, len - 1);
        bytes memory b = bytes(_repeat("a", len));
        b[pos] = bytes1(bad);
        assertEq(fair.isValidName(string(b)), _refValid(b));
    }

    function testFuzz_ClaimByAnyWallet(address who) public {
        vm.assume(who != address(0));
        _fund(who, FEE);
        _claim(who, "fuzzname");
        assertEq(fair.ownerOf(h("fuzzname")), who);
        assertEq(fair.nameOf(who), "fuzzname");
        assertEq(fair.resolve("fuzzname"), who);
    }

    function testFuzz_ReservationWindow(uint256 dt, address other) public {
        vm.assume(other != address(0) && other != alice);
        _fund(other, FEE);
        dt = bound(dt, 0, 90 days);
        _claim(alice, "alice");
        _release(alice);
        uint256 t0 = block.timestamp;
        vm.warp(t0 + dt);
        if (dt < PERIOD) {
            vm.expectRevert(abi.encodeWithSelector(FairID.NameReserved.selector, h("alice"), alice));
        }
        _claim(other, "alice");
    }

    function testFuzz_OnlyRecipientAccepts(address caller) public {
        vm.assume(caller != bob);
        _claim(alice, "alice");
        _propose(alice, bob);
        vm.expectRevert(FairID.NoPendingTransfer.selector);
        _accept(caller, alice);
    }

    // ------------------------------------------------------------ invariants

    /// @dev PROPERTY: a wallet has at most one name and ownerOf(hash(nameOf(w))) == w;
    ///      every owned name is the registered name of its owner; resolve agrees.
    function invariant_OwnerAndNameConsistent() public view {
        uint256 holders;
        uint256 owned;
        uint256 na = handler.actorCount();
        for (uint256 i; i < na; i++) {
            address w = handler.actors(i);
            string memory n = fair.nameOf(w);
            if (bytes(n).length != 0) {
                holders++;
                assertEq(fair.ownerOf(keccak256(bytes(n))), w);
                assertEq(fair.resolve(n), w);
            }
        }
        uint256 nn = handler.nameCount();
        for (uint256 j; j < nn; j++) {
            string memory name = handler.nameAt(j);
            address o = fair.ownerOf(keccak256(bytes(name)));
            if (o != address(0)) {
                owned++;
                assertEq(keccak256(bytes(fair.nameOf(o))), keccak256(bytes(name)));
            }
        }
        // one-to-one: wallets with a name == names with an owner
        assertEq(holders, owned);
    }

    // ------------------------------------------- non-claim paths move no funds

    function test_ReleaseAndTransfersMoveNoTokens() public {
        _claim(alice, "alice");
        address[5] memory who = [alice, bob, carol, treasury, address(fair)];
        uint256[5] memory before_;
        for (uint256 i; i < who.length; i++) before_[i] = _bal(who[i]);
        uint256 allowanceBefore = usdc.allowance(alice, address(fair));
        uint256 supplyBefore = usdc.totalSupply();

        vm.recordLogs();
        _propose(alice, bob);
        vm.prank(alice);
        fair.cancelTransfer();
        _propose(alice, bob);
        _accept(bob, alice);
        _propose(bob, carol);
        _release(bob);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            assertTrue(logs[i].emitter != address(usdc), "token touched");
            assertTrue(logs[i].topics[0] != FeePaid.selector, "FeePaid emitted");
        }
        for (uint256 i; i < who.length; i++) assertEq(_bal(who[i]), before_[i]);
        assertEq(usdc.allowance(alice, address(fair)), allowanceBefore);
        assertEq(usdc.totalSupply(), supplyBefore);
    }

    function test_ReleaseWorksWithoutAnyUsdc() public {
        _claim(alice, "alice");
        // drain alice and revoke approval; release and transfers must stay free
        vm.startPrank(alice);
        usdc.transfer(bob, _bal(alice));
        usdc.approve(address(fair), 0);
        fair.proposeTransfer(carol);
        fair.cancelTransfer();
        fair.proposeTransfer(carol);
        vm.stopPrank();
        _accept(carol, alice);
        assertEq(fair.resolve("alice"), carol);
        _release(carol);
        assertEq(fair.resolve("alice"), address(0));
    }

    // ----------------------------------------------------------- zero fee

    function test_ZeroFeeDeploymentRevertsFeeRequired() public {
        vm.expectRevert(FairID.FeeRequired.selector);
        _newFair(address(usdc), treasury, 0);
    }

    function test_ZeroFeeWithNonTokenUsdcStillRevertsFeeRequired() public {
        vm.expectRevert(FairID.FeeRequired.selector);
        _newFair(makeAddr("notAToken"), treasury, 0);
    }

    function test_ClaimWithoutFundsRevertsAtMinimumFee() public {
        FairID f = _newFair(address(usdc), treasury, 1);
        address dave = makeAddr("dave"); // no balance, no approval
        vm.expectRevert();
        vm.prank(dave);
        f.claim("dave_1");
        assertEq(f.resolve("dave_1"), address(0));
    }

    function test_FeePaidEmittedAtMinimumFee() public {
        FairID f1 = _newFair(address(usdc), treasury, 1);
        _fundFor(f1, alice, 10);
        vm.recordLogs();
        vm.prank(alice);
        f1.claim("alice");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 n;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == FeePaid.selector) n++;
        }
        assertEq(n, 1);
        assertEq(_bal(treasury), 1);
    }

    // ------------------------------------------------- misbehaving tokens

    function test_TokenReturningFalseRevertsClaimAtomically() public {
        FalseReturningToken tok = new FalseReturningToken();
        FairID f = _newFair(address(tok), treasury, FEE);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(tok)));
        vm.prank(alice);
        f.claim("alice");
        assertEq(f.resolve("alice"), address(0));
        assertEq(f.ownerOf(h("alice")), address(0));
        assertEq(bytes(f.nameOf(alice)).length, 0);
        assertTrue(f.isAvailable("alice"));
    }

    function test_TokenRevertingRevertsClaimAtomically() public {
        RevertingToken tok = new RevertingToken();
        FairID f = _newFair(address(tok), treasury, FEE);
        vm.expectRevert();
        vm.prank(alice);
        f.claim("alice");
        assertEq(f.resolve("alice"), address(0));
        assertEq(f.ownerOf(h("alice")), address(0));
        assertEq(bytes(f.nameOf(alice)).length, 0);
        assertTrue(f.isAvailable("alice"));
    }

    function test_ReentrantTokenRevertBubblesAndClaimReverts() public {
        ReentrantToken tok = new ReentrantToken();
        FairID f = _newFair(address(tok), treasury, FEE);
        tok.configure(f, true);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        vm.prank(alice);
        f.claim("alice");
        assertEq(f.resolve("alice"), address(0));
        assertEq(f.resolve("reenter_name"), address(0));
    }

    function test_ReentrantTokenIsBlockedByNonReentrant() public {
        ReentrantToken tok = new ReentrantToken();
        FairID f = _newFair(address(tok), treasury, FEE);
        tok.configure(f, false); // token swallows the reentry failure and reports success
        vm.prank(alice);
        f.claim("alice");
        assertTrue(tok.attempted());
        assertEq(tok.caughtSelector(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(f.resolve("alice"), alice);
        assertEq(f.resolve("reenter_name"), address(0)); // reentrant claim did not register
        assertEq(bytes(f.nameOf(address(tok))).length, 0);
    }

    // ----------------------------------------------------------------- fuzz

    function testFuzz_FeeAmountsChargedExactly(uint256 fee) public {
        fee = bound(fee, 1, 100e6);
        FairID f = _newFair(address(usdc), treasury, fee);
        address dave = makeAddr("dave");
        _fundFor(f, dave, fee); // exactly the fee, nothing extra
        vm.prank(dave);
        f.claim("dave_1");
        assertEq(f.resolve("dave_1"), dave);
        assertEq(_bal(dave), 0);
        assertEq(_bal(treasury), fee);
        assertEq(_bal(address(f)), 0);
    }

    function testFuzz_BalanceOneShortReverts(uint256 fee) public {
        fee = bound(fee, 1, 100e6);
        FairID f = _newFair(address(usdc), treasury, fee);
        address dave = makeAddr("dave");
        _fundFor(f, dave, fee - 1);
        vm.expectRevert();
        vm.prank(dave);
        f.claim("dave_1");
        assertEq(f.resolve("dave_1"), address(0));
        assertEq(_bal(treasury), 0);
    }

    function testFuzz_ApprovalOneShortReverts(uint256 fee) public {
        fee = bound(fee, 1, 100e6);
        FairID f = _newFair(address(usdc), treasury, fee);
        address dave = makeAddr("dave");
        usdc.mint(dave, fee);
        vm.prank(dave);
        usdc.approve(address(f), fee - 1);
        vm.expectRevert();
        vm.prank(dave);
        f.claim("dave_1");
        assertEq(f.resolve("dave_1"), address(0));
    }

    function testFuzz_FeeAboveMaxRejected(uint256 fee) public {
        fee = bound(fee, 100e6 + 1, type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(FairID.FeeTooHigh.selector, fee, 100e6));
        _newFair(address(usdc), treasury, fee);
    }

    // ----------------------------------------------------------- invariants

    /// @dev PROPERTY: the registry never custodies USDC.
    function invariant_FairHoldsNoUsdc() public view {
        assertEq(_bal(address(fair)), 0);
    }

    /// @dev PROPERTY: recipient balance equals fee times successful claims (every claim pays once; nothing else pays).
    function invariant_TreasuryEqualsFeeTimesClaims() public view {
        assertEq(_bal(treasury), FEE * handler.claims());
    }

    // ================================================================ FEES
    // ------------------------------------------------------------ constructor

    function _newFair(address token, address recipient, uint256 fee) internal returns (FairID) {
        return new FairID(IERC20(token), recipient, fee);
    }

    function test_ConstructorStoresConfig() public view {
        assertEq(address(fair.usdc()), address(usdc));
        assertEq(fair.feeRecipient(), treasury);
        assertEq(fair.claimFee(), FEE);
        assertEq(fair.MAX_CLAIM_FEE(), 100e6);
    }

    function test_ConstructorRevertsZeroUsdc() public {
        vm.expectRevert(FairID.ZeroAddress.selector);
        _newFair(address(0), treasury, FEE);
    }

    function test_ConstructorRevertsZeroRecipient() public {
        vm.expectRevert(FairID.ZeroAddress.selector);
        _newFair(address(usdc), address(0), FEE);
    }

    function test_ConstructorRevertsRecipientIsUsdc() public {
        vm.expectRevert(FairID.InvalidFeeRecipient.selector);
        _newFair(address(usdc), address(usdc), FEE);
    }

    function test_ConstructorRevertsRecipientIsSelf() public {
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        vm.expectRevert(FairID.InvalidFeeRecipient.selector);
        _newFair(address(usdc), predicted, FEE);
    }

    function test_ConstructorRevertsFeeTooHigh() public {
        vm.expectRevert(abi.encodeWithSelector(FairID.FeeTooHigh.selector, 100e6 + 1, 100e6));
        _newFair(address(usdc), treasury, 100e6 + 1);
        vm.expectRevert(abi.encodeWithSelector(FairID.FeeTooHigh.selector, type(uint256).max, 100e6));
        _newFair(address(usdc), treasury, type(uint256).max);
    }

    function test_ConstructorAcceptsMaxFee() public {
        FairID f = _newFair(address(usdc), treasury, 100e6);
        assertEq(f.claimFee(), 100e6);
    }

    function test_ConstructorRevertsZeroFee() public {
        vm.expectRevert(FairID.FeeRequired.selector);
        _newFair(address(usdc), treasury, 0);
    }

    function test_ConstructorAcceptsMinimumFee() public {
        FairID f = _newFair(address(usdc), treasury, 1);
        assertEq(f.claimFee(), 1);
    }

    // ----------------------------------------------------------- fee charging

    function test_ClaimChargesFeeDirectlyToRecipient() public {
        uint256 a0 = _bal(alice);
        uint256 t0 = _bal(treasury);
        _claim(alice, "alice");
        assertEq(_bal(alice), a0 - FEE);
        assertEq(_bal(treasury), t0 + FEE);
        assertEq(_bal(address(fair)), 0);
        assertEq(usdc.allowance(alice, address(fair)), type(uint256).max - FEE);
    }

    function test_ClaimChargesFeeExactlyOnce() public {
        vm.recordLogs();
        _claim(alice, "alice");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 feePaid;
        uint256 transfers;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(fair) && logs[i].topics[0] == FeePaid.selector) feePaid++;
            if (logs[i].emitter == address(usdc) && logs[i].topics[0] == MockERC20.Transfer.selector) {
                transfers++;
                assertEq(address(uint160(uint256(logs[i].topics[1]))), alice);
                assertEq(address(uint160(uint256(logs[i].topics[2]))), treasury);
                assertEq(abi.decode(logs[i].data, (uint256)), FEE);
            }
        }
        assertEq(feePaid, 1);
        assertEq(transfers, 1);
    }

    function test_ClaimEmitsFeePaid() public {
        vm.expectEmit(true, false, false, true, address(fair));
        emit FeePaid(alice, FEE);
        _claim(alice, "alice");
    }

    function test_EachClaimPaysSeparately() public {
        uint256 t0 = _bal(treasury);
        _claim(alice, "alice");
        _claim(bob, "bob");
        _claim(carol, "carol");
        assertEq(_bal(treasury), t0 + 3 * FEE);
        assertEq(_bal(address(fair)), 0);
    }

    function test_FeeNotChargedOnFailedClaims() public {
        _claim(alice, "alice");
        uint256 b0 = _bal(bob);
        uint256 a0 = _bal(alice);
        uint256 t0 = _bal(treasury);
        vm.expectRevert(abi.encodeWithSelector(FairID.NameTaken.selector, h("alice")));
        _claim(bob, "alice");
        vm.expectRevert(FairID.InvalidName.selector);
        _claim(bob, "BAD");
        vm.expectRevert(FairID.AlreadyHasName.selector);
        _claim(alice, "alice2");
        assertEq(_bal(bob), b0);
        assertEq(_bal(alice), a0);
        assertEq(_bal(treasury), t0);
    }

    function test_ReservedClaimByOtherDoesNotCharge() public {
        _claim(alice, "alice");
        _release(alice);
        uint256 b0 = _bal(bob);
        vm.expectRevert(abi.encodeWithSelector(FairID.NameReserved.selector, h("alice"), alice));
        _claim(bob, "alice");
        assertEq(_bal(bob), b0);
    }

    function test_ClaimRevertsWithoutApproval() public {
        address dave = makeAddr("dave");
        usdc.mint(dave, 100e6); // balance but no approval
        vm.expectRevert();
        _claim(dave, "dave_1");
        assertEq(fair.resolve("dave_1"), address(0));
        assertEq(fair.ownerOf(h("dave_1")), address(0));
        assertEq(bytes(fair.nameOf(dave)).length, 0);
        assertTrue(fair.isAvailable("dave_1"));
        assertEq(_bal(dave), 100e6);
        assertEq(_bal(treasury), 0);
    }

    function test_ClaimRevertsWithInsufficientApproval() public {
        address dave = makeAddr("dave");
        usdc.mint(dave, 100e6);
        vm.prank(dave);
        usdc.approve(address(fair), FEE - 1);
        vm.expectRevert();
        _claim(dave, "dave_1");
        assertEq(fair.resolve("dave_1"), address(0));
        assertEq(_bal(treasury), 0);
    }

    function test_ClaimRevertsWithoutBalance() public {
        address dave = makeAddr("dave");
        vm.prank(dave);
        usdc.approve(address(fair), type(uint256).max); // approval but no balance
        vm.expectRevert();
        _claim(dave, "dave_1");
        assertEq(fair.resolve("dave_1"), address(0));
        assertEq(bytes(fair.nameOf(dave)).length, 0);
        assertTrue(fair.isAvailable("dave_1"));
        assertEq(_bal(treasury), 0);
    }

    function test_ClaimRevertsWithBalanceOneShort() public {
        address dave = makeAddr("dave");
        _fund(dave, FEE - 1);
        vm.expectRevert();
        _claim(dave, "dave_1");
        assertEq(fair.resolve("dave_1"), address(0));
        // topping up by 1 unit makes the same claim succeed
        usdc.mint(dave, 1);
        _claim(dave, "dave_1");
        assertEq(fair.resolve("dave_1"), dave);
        assertEq(_bal(dave), 0);
    }

    function test_FailedClaimDoesNotBlockLaterClaimByOther() public {
        address dave = makeAddr("dave");
        vm.expectRevert();
        _claim(dave, "dave_1");
        _claim(alice, "dave_1");
        assertEq(fair.resolve("dave_1"), alice);
    }

    function test_PreviousOwnerReclaimInsideReservationPaysAgain() public {
        uint256 a0 = _bal(alice);
        uint256 t0 = _bal(treasury);
        _claim(alice, "alice");
        _release(alice);
        vm.warp(block.timestamp + 10 days);
        vm.expectEmit(true, false, false, true, address(fair));
        emit FeePaid(alice, FEE);
        _claim(alice, "alice");
        assertEq(fair.resolve("alice"), alice);
        assertEq(_bal(alice), a0 - 2 * FEE);
        assertEq(_bal(treasury), t0 + 2 * FEE);
        assertEq(_bal(address(fair)), 0);
    }

    function test_PreviousOwnerReclaimWithoutFundsReverts() public {
        _claim(alice, "alice");
        _release(alice);
        vm.prank(alice);
        usdc.approve(address(fair), 0);
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert();
        _claim(alice, "alice");
        assertEq(fair.resolve("alice"), address(0));
        assertEq(fair.previousOwner(h("alice")), alice); // reservation record intact
        assertEq(fair.releasedAt(h("alice")), block.timestamp - 1 days);
    }
}
