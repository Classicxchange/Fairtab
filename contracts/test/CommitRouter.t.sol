// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {CommitRouter} from "../CommitRouter.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Honest ERC-4626 vault, 18-decimal shares over 6-decimal USDC (offset 12).
contract MockVault is ERC4626 {
    constructor(IERC20 asset_) ERC4626(asset_) ERC20("Vault Share", "vUSDC") {}

    function _decimalsOffset() internal pure override returns (uint8) {
        return 12;
    }
}

/// @dev Hostile vault with selectable misbehaviour on deposit.
contract HostileVault {
    enum Mode {
        PullHalf, // pulls only half of `assets`
        FewShares, // pulls all, mints/returns assets/2 shares
        Reenter, // re-enters router.commit
        NoMint, // pulls all, returns a huge share count, mints nothing
        WrongReceiver, // pulls all, mints `assets` shares to 0xdead, returns assets
        UnderReport, // pulls all, mints `assets` shares to receiver, returns assets/2
        OverReport, // pulls all, mints assets/2 to receiver, returns assets
        ZeroZero // pulls all, mints nothing, returns 0
    }

    address public asset;
    Mode public mode;
    CommitRouter public router;
    mapping(address => uint256) public balanceOf;

    constructor(address asset_, Mode mode_) {
        asset = asset_;
        mode = mode_;
    }

    function setRouter(CommitRouter router_) external {
        router = router_;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        if (mode == Mode.Reenter) {
            router.commit(address(this), 1000, 0);
            return 0;
        }
        uint256 pull = mode == Mode.PullHalf ? assets / 2 : assets;
        require(IERC20(asset).transferFrom(msg.sender, address(this), pull), "pull");
        if (mode == Mode.NoMint) return type(uint128).max;
        if (mode == Mode.ZeroZero) return 0;
        if (mode == Mode.WrongReceiver) {
            balanceOf[address(0xdead)] += assets;
            return assets;
        }
        if (mode == Mode.UnderReport) {
            balanceOf[receiver] += assets;
            return assets / 2;
        }
        if (mode == Mode.OverReport) {
            balanceOf[receiver] += assets / 2;
            return assets;
        }
        shares = mode == Mode.PullHalf ? pull : assets / 2;
        balanceOf[receiver] += shares;
    }
}

abstract contract CommitRouterTestBase is Test {
    uint16 internal constant FEE_BPS = 23;

    MockERC20 internal usdc;
    MockVault internal vaultA;
    MockVault internal vaultB;
    CommitRouter internal router;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal recipient = makeAddr("recipient");

    function setUp() public virtual {
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        vaultA = new MockVault(IERC20(address(usdc)));
        vaultB = new MockVault(IERC20(address(usdc)));
        address[] memory vs = new address[](2);
        vs[0] = address(vaultA);
        vs[1] = address(vaultB);
        router = new CommitRouter(IERC20(address(usdc)), recipient, FEE_BPS, vs);
    }

    function _one(address v) internal pure returns (address[] memory vs) {
        vs = new address[](1);
        vs[0] = v;
    }

    function _newRouter(address v) internal returns (CommitRouter) {
        return new CommitRouter(IERC20(address(usdc)), recipient, FEE_BPS, _one(v));
    }

    function _fund(address user, uint256 amount, address spender) internal {
        usdc.mint(user, amount);
        vm.prank(user);
        usdc.approve(spender, amount);
    }
}

contract CommitRouterTest is CommitRouterTestBase {
    // ---------------------------------------------------------------- constructor

    function test_Constructor_StoresState() public view {
        assertEq(address(router.usdc()), address(usdc));
        assertEq(router.feeRecipient(), recipient);
        assertEq(router.feeBps(), FEE_BPS);
        assertEq(router.MAX_FEE_BPS(), 100);
        assertEq(router.MAX_VAULTS(), 10);
        assertEq(router.BPS_DENOMINATOR(), 10_000);
    }

    function test_Vaults_ReturnsConstructorOrder() public view {
        address[] memory vs = router.vaults();
        assertEq(vs.length, 2);
        assertEq(vs[0], address(vaultA));
        assertEq(vs[1], address(vaultB));
    }

    function test_IsAllowedVault() public view {
        assertTrue(router.isAllowedVault(address(vaultA)));
        assertTrue(router.isAllowedVault(address(vaultB)));
        assertFalse(router.isAllowedVault(address(usdc)));
        assertFalse(router.isAllowedVault(alice));
    }

    function test_Constructor_RevertsZeroUsdc() public {
        vm.expectRevert(CommitRouter.ZeroAddress.selector);
        new CommitRouter(IERC20(address(0)), recipient, FEE_BPS, _one(address(vaultA)));
    }

    function test_Constructor_RevertsZeroRecipient() public {
        vm.expectRevert(CommitRouter.ZeroAddress.selector);
        new CommitRouter(IERC20(address(usdc)), address(0), FEE_BPS, _one(address(vaultA)));
    }

    function test_Constructor_RevertsZeroVaultEntry() public {
        vm.expectRevert(CommitRouter.ZeroAddress.selector);
        new CommitRouter(IERC20(address(usdc)), recipient, FEE_BPS, _one(address(0)));
    }

    function test_Constructor_RevertsRecipientIsUsdc() public {
        vm.expectRevert(CommitRouter.InvalidFeeRecipient.selector);
        new CommitRouter(IERC20(address(usdc)), address(usdc), FEE_BPS, _one(address(vaultA)));
    }

    function test_Constructor_RevertsRecipientIsRouter() public {
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        vm.expectRevert(CommitRouter.InvalidFeeRecipient.selector);
        new CommitRouter(IERC20(address(usdc)), predicted, FEE_BPS, _one(address(vaultA)));
    }

    function test_Constructor_RevertsRecipientIsVault() public {
        address[] memory vs = new address[](2);
        vs[0] = address(vaultA);
        vs[1] = address(vaultB);
        vm.expectRevert(CommitRouter.InvalidFeeRecipient.selector);
        new CommitRouter(IERC20(address(usdc)), address(vaultB), FEE_BPS, vs);
    }

    function test_Constructor_RevertsFeeZero() public {
        vm.expectRevert(abi.encodeWithSelector(CommitRouter.FeeOutOfRange.selector, uint16(0), uint16(100)));
        new CommitRouter(IERC20(address(usdc)), recipient, 0, _one(address(vaultA)));
    }

    function test_Constructor_RevertsFeeAboveMax() public {
        vm.expectRevert(abi.encodeWithSelector(CommitRouter.FeeOutOfRange.selector, uint16(101), uint16(100)));
        new CommitRouter(IERC20(address(usdc)), recipient, 101, _one(address(vaultA)));
    }

    function test_Constructor_AcceptsMaxFee() public {
        CommitRouter r = new CommitRouter(IERC20(address(usdc)), recipient, 100, _one(address(vaultA)));
        assertEq(r.feeBps(), 100);
    }

    function test_Constructor_RevertsEmptyVaultList() public {
        vm.expectRevert(CommitRouter.NoVaults.selector);
        new CommitRouter(IERC20(address(usdc)), recipient, FEE_BPS, new address[](0));
    }

    function _vaultList(uint256 n) internal returns (address[] memory vs) {
        vs = new address[](n);
        for (uint256 i; i < n; ++i) {
            vs[i] = address(new MockVault(IERC20(address(usdc))));
        }
    }

    function test_Constructor_RevertsMoreThanTenVaults() public {
        address[] memory vs = _vaultList(11);
        vm.expectRevert(CommitRouter.NoVaults.selector);
        new CommitRouter(IERC20(address(usdc)), recipient, FEE_BPS, vs);
    }

    function test_Constructor_AcceptsTenVaults() public {
        address[] memory vs = _vaultList(10);
        CommitRouter r = new CommitRouter(IERC20(address(usdc)), recipient, FEE_BPS, vs);
        assertEq(r.vaults().length, 10);
        assertTrue(r.isAllowedVault(vs[9]));
    }

    function test_Constructor_RevertsDuplicateVault() public {
        address[] memory vs = new address[](2);
        vs[0] = address(vaultA);
        vs[1] = address(vaultA);
        vm.expectRevert(abi.encodeWithSelector(CommitRouter.DuplicateVault.selector, address(vaultA)));
        new CommitRouter(IERC20(address(usdc)), recipient, FEE_BPS, vs);
    }

    function test_Constructor_RevertsAssetMismatch() public {
        MockERC20 other = new MockERC20("Other", "OTH", 6);
        MockVault bad = new MockVault(IERC20(address(other)));
        address[] memory vs = new address[](2);
        vs[0] = address(vaultA);
        vs[1] = address(bad);
        vm.expectRevert(abi.encodeWithSelector(CommitRouter.VaultAssetMismatch.selector, address(bad)));
        new CommitRouter(IERC20(address(usdc)), recipient, FEE_BPS, vs);
    }

    function test_Constructor_RevertsAssetMismatchHostile() public {
        HostileVault bad = new HostileVault(address(0xBEEF), HostileVault.Mode.PullHalf);
        vm.expectRevert(abi.encodeWithSelector(CommitRouter.VaultAssetMismatch.selector, address(bad)));
        new CommitRouter(IERC20(address(usdc)), recipient, FEE_BPS, _one(address(bad)));
    }

    // ---------------------------------------------------------------- commit: happy path

    /// @dev Router USDC balance snapshot taken just before a commit (defaults to the
    ///      pre-existing balance of 0 where a test does not donate).
    uint256 internal routerUsdcBefore;

    function _snap() internal {
        routerUsdcBefore = usdc.balanceOf(address(router));
    }

    /// @dev Relative check: router USDC balance unchanged by the commit, no shares, no allowance.
    function _assertRouterEmpty(MockVault v) internal view {
        assertEq(usdc.balanceOf(address(router)), routerUsdcBefore, "router usdc changed");
        assertEq(v.balanceOf(address(router)), 0, "router shares");
        assertEq(usdc.allowance(address(router), address(v)), 0, "router allowance");
    }

    function test_Commit_HappyPath_Fee23Bps() public {
        uint256 assets = 1_000e6;
        usdc.mint(address(router), 777); // pre-existing donated balance must be untouched
        _snap();
        _fund(alice, assets, address(router));
        uint256 fee = assets * 23 / 10_000;
        uint256 net = assets - fee;
        assertEq(fee, 2_300_000);
        uint256 expShares = vaultA.previewDeposit(net);

        (uint256 pFee, uint256 pNet) = router.previewCommit(assets);
        assertEq(pFee, fee);
        assertEq(pNet, net);

        vm.expectEmit(true, true, false, true, address(router));
        emit CommitRouter.Committed(alice, address(vaultA), assets, fee, net, expShares);
        vm.prank(alice);
        uint256 shares = router.commit(address(vaultA), assets, 0);

        assertEq(shares, expShares);
        assertEq(vaultA.balanceOf(alice), shares, "shares to user");
        assertEq(usdc.balanceOf(recipient), fee, "recipient fee");
        assertEq(usdc.balanceOf(address(vaultA)), net, "vault net");
        assertEq(usdc.balanceOf(alice), 0);
        _assertRouterEmpty(vaultA);
    }

    function test_Commit_SecondVaultAndSecondUser() public {
        uint256 assets = 50e6;
        _fund(bob, assets, address(router));
        vm.prank(bob);
        uint256 shares = router.commit(address(vaultB), assets, 0);
        assertEq(vaultB.balanceOf(bob), shares);
        assertEq(vaultA.balanceOf(bob), 0);
        assertEq(usdc.balanceOf(recipient), assets * 23 / 10_000);
        _assertRouterEmpty(vaultB);
    }

    function test_Commit_MinimumPointOneUsdc() public {
        uint256 assets = 100_000;
        (uint256 fee, uint256 net) = router.previewCommit(assets);
        assertEq(fee, 230);
        assertEq(net, 99_770);
        _fund(alice, assets, address(router));
        vm.expectEmit(true, true, false, true, address(router));
        emit CommitRouter.Committed(alice, address(vaultA), assets, 230, 99_770, vaultA.previewDeposit(99_770));
        vm.prank(alice);
        router.commit(address(vaultA), assets, 0);
        assertEq(usdc.balanceOf(recipient), 230);
        assertEq(usdc.balanceOf(address(vaultA)), 99_770);
        _assertRouterEmpty(vaultA);
    }

    function test_Commit_TinyAmountFeeRoundsToZero() public {
        uint256 assets = 434; // 434 * 23 = 9982 < 10000
        (uint256 fee, uint256 net) = router.previewCommit(assets);
        assertEq(fee, 0);
        assertEq(net, 434);
        _fund(alice, assets, address(router));
        vm.recordLogs();
        vm.prank(alice);
        uint256 shares = router.commit(address(vaultA), assets, 0);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 transferSig = keccak256("Transfer(address,address,uint256)");
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == transferSig && logs[i].topics.length == 3) {
                assertTrue(logs[i].topics[2] != bytes32(uint256(uint160(recipient))), "transfer to recipient");
            }
        }
        assertEq(usdc.balanceOf(recipient), 0);
        assertEq(usdc.balanceOf(address(vaultA)), 434);
        assertEq(vaultA.balanceOf(alice), shares);
        assertGt(shares, 0);
        _assertRouterEmpty(vaultA);
    }

    function test_Commit_FeeBecomesOneAtThreshold() public {
        (uint256 fee,) = router.previewCommit(435); // 435 * 23 = 10005
        assertEq(fee, 1);
        _fund(alice, 435, address(router));
        vm.prank(alice);
        router.commit(address(vaultA), 435, 0);
        assertEq(usdc.balanceOf(recipient), 1);
        assertEq(usdc.balanceOf(address(vaultA)), 434);
    }

    function test_Commit_OneBaseUnit() public {
        _fund(alice, 1, address(router));
        vm.prank(alice);
        router.commit(address(vaultA), 1, 0);
        assertEq(usdc.balanceOf(recipient), 0);
        assertEq(usdc.balanceOf(address(vaultA)), 1);
        _assertRouterEmpty(vaultA);
    }

    function test_PreviewCommit_ZeroAssets() public view {
        (uint256 fee, uint256 net) = router.previewCommit(0);
        assertEq(fee, 0);
        assertEq(net, 0);
    }

    function test_Commit_NetNeverZeroForSmallAssets() public view {
        // net is never zero for nonzero assets since feeBps <= 100 (AmountTooSmall was removed as unreachable).
        for (uint256 a = 1; a <= 2_000; ++a) {
            (, uint256 net) = router.previewCommit(a);
            assertGt(net, 0);
        }
    }

    function test_Commit_ApprovalToVaultResetToZero() public {
        _fund(alice, 10e6, address(router));
        vm.prank(alice);
        router.commit(address(vaultA), 10e6, 0);
        assertEq(usdc.allowance(address(router), address(vaultA)), 0);
        assertEq(usdc.allowance(alice, address(router)), 0);
    }

    // ---------------------------------------------------------------- commit: reverts

    function test_Commit_RevertsVaultNotAllowed() public {
        _fund(alice, 10e6, address(router));
        address other = address(new MockVault(IERC20(address(usdc))));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CommitRouter.VaultNotAllowed.selector, other));
        router.commit(other, 10e6, 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CommitRouter.VaultNotAllowed.selector, address(0)));
        router.commit(address(0), 10e6, 0);
    }

    function test_Commit_VaultCheckPrecedesZeroAmount() public {
        vm.expectRevert(abi.encodeWithSelector(CommitRouter.VaultNotAllowed.selector, alice));
        router.commit(alice, 0, 0);
    }

    function test_Commit_RevertsZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(CommitRouter.ZeroAmount.selector);
        router.commit(address(vaultA), 0, 0);
    }

    function test_Commit_SlippageBoundary() public {
        uint256 assets = 100e6;
        (, uint256 net) = router.previewCommit(assets);
        uint256 expShares = vaultA.previewDeposit(net);

        _fund(alice, assets, address(router));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CommitRouter.SlippageExceeded.selector, expShares, expShares + 1));
        router.commit(address(vaultA), assets, expShares + 1);
        // whole tx reverted: fee not paid, funds untouched
        assertEq(usdc.balanceOf(recipient), 0);
        assertEq(usdc.balanceOf(alice), assets);
        assertEq(vaultA.balanceOf(alice), 0);

        vm.prank(alice);
        uint256 shares = router.commit(address(vaultA), assets, expShares);
        assertEq(shares, expShares);
    }

    function test_Commit_RevertsWithoutApproval() public {
        usdc.mint(alice, 10e6);
        vm.prank(alice);
        vm.expectRevert();
        router.commit(address(vaultA), 10e6, 0);
        assertEq(usdc.balanceOf(alice), 10e6);
        assertEq(usdc.balanceOf(recipient), 0);
        assertEq(vaultA.totalSupply(), 0);
    }

    function test_Commit_RevertsPartialApproval() public {
        usdc.mint(alice, 10e6);
        vm.prank(alice);
        usdc.approve(address(router), 10e6 - 1);
        vm.prank(alice);
        vm.expectRevert();
        router.commit(address(vaultA), 10e6, 0);
        assertEq(usdc.balanceOf(alice), 10e6);
        assertEq(usdc.balanceOf(recipient), 0);
    }

    function test_Commit_RevertsWithoutBalance() public {
        vm.prank(alice);
        usdc.approve(address(router), 10e6);
        usdc.mint(alice, 10e6 - 1);
        vm.prank(alice);
        vm.expectRevert();
        router.commit(address(vaultA), 10e6, 0);
        assertEq(usdc.balanceOf(alice), 10e6 - 1);
        assertEq(usdc.balanceOf(recipient), 0);
        assertEq(usdc.balanceOf(address(router)), 0);
        assertEq(vaultA.totalSupply(), 0);
    }

    function test_Commit_DonationOfOneBaseUnitDoesNotBlock() public {
        usdc.mint(address(router), 1); // donation
        _snap();
        uint256 assets = 10e6;
        (uint256 fee, uint256 net) = router.previewCommit(assets);
        _fund(alice, assets, address(router));
        vm.expectEmit(true, true, false, true, address(router));
        emit CommitRouter.Committed(alice, address(vaultA), assets, fee, net, vaultA.previewDeposit(net));
        vm.prank(alice);
        uint256 shares = router.commit(address(vaultA), assets, 0);

        assertEq(usdc.balanceOf(address(router)), 1, "donation untouched");
        assertEq(usdc.allowance(address(router), address(vaultA)), 0, "vault allowance");
        assertEq(usdc.balanceOf(address(vaultA)), net, "vault got only net");
        assertEq(usdc.balanceOf(recipient), fee);
        assertEq(vaultA.balanceOf(alice), shares);
        assertGt(shares, 0);
        _assertRouterEmpty(vaultA);
    }

    function test_Commit_LargeDonationIsNeverSpent() public {
        usdc.mint(address(router), 500e6);
        _fund(alice, 1e6, address(router));
        vm.prank(alice);
        router.commit(address(vaultA), 1e6, 0);
        assertEq(usdc.balanceOf(address(router)), 500e6);
        assertEq(usdc.balanceOf(address(vaultA)), 1e6 - (1e6 * 23 / 10_000));
        assertEq(usdc.allowance(address(router), address(vaultA)), 0);
    }

    function test_Commit_DonationBetweenCommitsStillWorks() public {
        _fund(alice, 10e6, address(router));
        vm.prank(alice);
        router.commit(address(vaultA), 5e6, 0);
        usdc.mint(address(router), 123);
        vm.prank(alice);
        router.commit(address(vaultA), 5e6, 0);
        assertEq(usdc.balanceOf(address(router)), 123);
    }

    // ---------------------------------------------------------------- hostile vaults

    function test_Commit_RevertsLeftoverFundsWhenVaultPullsLess() public {
        HostileVault hv = new HostileVault(address(usdc), HostileVault.Mode.PullHalf);
        CommitRouter r = _newRouter(address(hv));
        usdc.mint(address(r), 9); // donation present: balance must still be compared relatively
        _fund(alice, 10e6, address(r));
        vm.prank(alice);
        vm.expectRevert(CommitRouter.LeftoverFunds.selector);
        r.commit(address(hv), 10e6, 0);
        // everything rolled back
        assertEq(usdc.balanceOf(alice), 10e6);
        assertEq(usdc.balanceOf(recipient), 0);
        assertEq(usdc.balanceOf(address(r)), 9);
    }

    function _hostile(HostileVault.Mode m, uint256 assets) internal returns (HostileVault hv, CommitRouter r) {
        hv = new HostileVault(address(usdc), m);
        r = _newRouter(address(hv));
        _fund(alice, assets, address(r));
    }

    function test_Commit_RevertsShareDeliveryMismatchWhenNoSharesMinted() public {
        (HostileVault hv, CommitRouter r) = _hostile(HostileVault.Mode.NoMint, 10e6);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(CommitRouter.ShareDeliveryMismatch.selector, uint256(type(uint128).max), uint256(0))
        );
        r.commit(address(hv), 10e6, 0);
        assertEq(usdc.balanceOf(alice), 10e6, "rolled back");
        assertEq(usdc.balanceOf(recipient), 0, "fee rolled back");
        assertEq(hv.balanceOf(alice), 0);
    }

    function test_Commit_NoMintRevertsEvenWithLargeMinShares() public {
        // mismatch check fires before slippage check
        (HostileVault hv, CommitRouter r) = _hostile(HostileVault.Mode.NoMint, 10e6);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(CommitRouter.ShareDeliveryMismatch.selector, uint256(type(uint128).max), uint256(0))
        );
        r.commit(address(hv), 10e6, type(uint256).max);
    }

    function test_Commit_RevertsShareDeliveryMismatchWhenWrongReceiver() public {
        uint256 assets = 10e6;
        (, uint256 net) = router.previewCommit(assets);
        (HostileVault hv, CommitRouter r) = _hostile(HostileVault.Mode.WrongReceiver, assets);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CommitRouter.ShareDeliveryMismatch.selector, net, uint256(0)));
        r.commit(address(hv), assets, 0);
        assertEq(usdc.balanceOf(alice), assets, "rolled back");
        assertEq(hv.balanceOf(address(0xdead)), 0, "wrong-receiver mint rolled back");
    }

    function test_Commit_RevertsShareDeliveryMismatchWhenZeroReportedZeroDelivered() public {
        (HostileVault hv, CommitRouter r) = _hostile(HostileVault.Mode.ZeroZero, 10e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CommitRouter.ShareDeliveryMismatch.selector, uint256(0), uint256(0)));
        r.commit(address(hv), 10e6, 0);
    }

    function test_Commit_RevertsShareDeliveryMismatchWhenDeliveredLessThanReported() public {
        uint256 assets = 10e6;
        (, uint256 net) = router.previewCommit(assets);
        (HostileVault hv, CommitRouter r) = _hostile(HostileVault.Mode.OverReport, assets);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CommitRouter.ShareDeliveryMismatch.selector, net, net / 2));
        r.commit(address(hv), assets, 0);
    }

    function test_Commit_PassesWhenDeliveredExceedsReported() public {
        uint256 assets = 10e6;
        (uint256 fee, uint256 net) = router.previewCommit(assets);
        (HostileVault hv, CommitRouter r) = _hostile(HostileVault.Mode.UnderReport, assets);
        // vault reports net/2 but actually mints net -> returns/emits delivered (net)
        vm.expectEmit(true, true, false, true, address(r));
        emit CommitRouter.Committed(alice, address(hv), assets, fee, net, net);
        vm.prank(alice);
        uint256 shares = r.commit(address(hv), assets, 0);
        assertEq(shares, net, "returns delivered, not reported");
        assertEq(hv.balanceOf(alice), net);
    }

    function test_Commit_SlippageCheckedAgainstDeliveredNotReported() public {
        uint256 assets = 10e6;
        (, uint256 net) = router.previewCommit(assets);
        (HostileVault hv, CommitRouter r) = _hostile(HostileVault.Mode.UnderReport, assets);
        // reported = net/2 would satisfy neither; delivered = net satisfies minShares = net
        // minShares = net + 1 fails with the delivered figure
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CommitRouter.SlippageExceeded.selector, net, net + 1));
        r.commit(address(hv), assets, net + 1);
        // minShares = net (> reported net/2, <= delivered) passes
        vm.prank(alice);
        uint256 shares = r.commit(address(hv), assets, net);
        assertEq(shares, net);
    }

    function test_Commit_SharesMeasuredFromBalanceDeltaNotAbsolute() public {
        // user already holds shares; only the increase counts
        _fund(alice, 20e6, address(router));
        vm.prank(alice);
        uint256 first = router.commit(address(vaultA), 10e6, 0);
        vm.prank(alice);
        uint256 second = router.commit(address(vaultA), 10e6, first);
        assertEq(vaultA.balanceOf(alice), first + second);
        assertEq(second, first);
    }

    function test_Commit_RevertsWhenVaultReturnsFewerShares() public {
        HostileVault hv = new HostileVault(address(usdc), HostileVault.Mode.FewShares);
        CommitRouter r = _newRouter(address(hv));
        uint256 assets = 10e6;
        (, uint256 net) = r.previewCommit(assets);
        _fund(alice, assets, address(r));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CommitRouter.SlippageExceeded.selector, net / 2, net));
        r.commit(address(hv), assets, net);
        // minShares at what the vault actually returns succeeds
        vm.prank(alice);
        uint256 shares = r.commit(address(hv), assets, net / 2);
        assertEq(shares, net / 2);
        assertEq(hv.balanceOf(alice), net / 2);
    }

    function test_Commit_ReentrancyBlocked() public {
        HostileVault hv = new HostileVault(address(usdc), HostileVault.Mode.Reenter);
        CommitRouter r = _newRouter(address(hv));
        hv.setRouter(r);
        _fund(alice, 10e6, address(r));
        vm.prank(alice);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        r.commit(address(hv), 10e6, 0);
        assertEq(usdc.balanceOf(alice), 10e6);
        assertEq(usdc.balanceOf(recipient), 0);
    }

    // ---------------------------------------------------------------- fuzz

    function testFuzz_Commit_FeeNetConservation(uint256 assets, bool useB, uint256 donation) public {
        assets = bound(assets, 1, 1e12);
        donation = bound(donation, 0, 1e12);
        MockVault v = useB ? vaultB : vaultA;
        usdc.mint(address(router), donation);
        _snap();
        _fund(alice, assets, address(router));
        (uint256 fee, uint256 net) = router.previewCommit(assets);
        assertEq(fee + net, assets);
        assertEq(fee, assets * 23 / 10_000);

        uint256 recipBefore = usdc.balanceOf(recipient);
        uint256 vaultBefore = usdc.balanceOf(address(v));
        vm.prank(alice);
        uint256 shares = router.commit(address(v), assets, 0);

        assertEq(usdc.balanceOf(recipient) - recipBefore, fee);
        assertEq(usdc.balanceOf(address(v)) - vaultBefore, net);
        assertEq(usdc.balanceOf(alice), 0);
        assertEq(v.balanceOf(alice), shares);
        assertEq(usdc.balanceOf(address(router)), donation, "router balance unchanged");
        assertEq(v.balanceOf(address(router)), 0);
        assertEq(usdc.allowance(address(router), address(v)), 0);
    }
}

contract CommitRouterHandler is Test {
    CommitRouter public router;
    MockERC20 public usdc;
    MockVault[2] public vaults;
    address public recipient;
    address[3] public actors;
    uint256 public ghostFees;
    uint256 public commits;
    uint256 public ghostDonated;
    bool public balanceDecreased;

    constructor(CommitRouter router_, MockERC20 usdc_, MockVault a, MockVault b, address recipient_) {
        router = router_;
        usdc = usdc_;
        vaults[0] = a;
        vaults[1] = b;
        recipient = recipient_;
        actors[0] = makeAddr("hActor0");
        actors[1] = makeAddr("hActor1");
        actors[2] = makeAddr("hActor2");
    }

    function commit(uint256 actorSeed, uint256 vaultSeed, uint256 assets, uint256 minSharesSeed) external {
        address actor = actors[actorSeed % 3];
        MockVault v = vaults[vaultSeed % 2];
        assets = bound(assets, 1, 1e12);
        usdc.mint(actor, assets);
        vm.startPrank(actor);
        usdc.approve(address(router), assets);
        // minShares 0 or an achievable bound (never exceeds expected)
        (, uint256 net) = router.previewCommit(assets);
        uint256 minShares = minSharesSeed % 2 == 0 ? 0 : v.previewDeposit(net);
        uint256 routerBefore = usdc.balanceOf(address(router));
        router.commit(address(v), assets, minShares);
        vm.stopPrank();
        if (usdc.balanceOf(address(router)) < routerBefore) balanceDecreased = true;
        ghostFees += assets * router.feeBps() / router.BPS_DENOMINATOR();
        commits++;
    }

    /// @dev Anyone may donate USDC directly to the router.
    function donate(uint256 amount) external {
        amount = bound(amount, 0, 1e9);
        usdc.mint(address(router), amount);
        ghostDonated += amount;
    }
}

contract CommitRouterInvariantTest is CommitRouterTestBase {
    CommitRouterHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new CommitRouterHandler(router, usdc, vaultA, vaultB, recipient);
        targetContract(address(handler));
    }

    /// @dev Router USDC balance never decreases: it always equals exactly what was donated.
    function invariant_RouterUsdcNeverDecreases() public view {
        assertFalse(handler.balanceDecreased());
        assertGe(usdc.balanceOf(address(router)), handler.ghostDonated());
        assertEq(usdc.balanceOf(address(router)), handler.ghostDonated());
    }

    function invariant_VaultAllowancesAlwaysZero() public view {
        assertEq(usdc.allowance(address(router), address(vaultA)), 0);
        assertEq(usdc.allowance(address(router), address(vaultB)), 0);
    }

    function invariant_RouterNeverHoldsShares() public view {
        assertEq(vaultA.balanceOf(address(router)), 0);
        assertEq(vaultB.balanceOf(address(router)), 0);
    }

    function invariant_RecipientBalanceEqualsSumOfFees() public view {
        assertEq(usdc.balanceOf(recipient), handler.ghostFees());
    }

    function invariant_VaultsHoldNetDeposits() public view {
        // all USDC minted by the handler is at the recipient, in a vault, or is donated sitting in the router
        assertEq(
            usdc.balanceOf(recipient) + usdc.balanceOf(address(vaultA)) + usdc.balanceOf(address(vaultB))
                + usdc.balanceOf(address(router)),
            usdc.totalSupply()
        );
    }
}
