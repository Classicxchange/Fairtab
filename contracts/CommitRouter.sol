// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

/// @title CommitRouter
/// @notice Non-custodial USDC deposit router for permanently allowlisted ERC-4626 vaults,
///         including compatible Morpho Vault V2 vaults on Arc.
/// @dev The fixed basis-point fee is charged only on commit, never on withdrawal.
///      Users own their shares immediately and withdraw directly from the vault; the router
///      never holds shares. USDC is held only transiently during a successful commit.
///      Approving the router lets it pull exactly the amount the user commits, split between
///      the fee recipient and the vault deposit; no third party can commit another user's funds.
///      There is no admin, owner, setter, upgrade path, payable function, or rescue function.
///      Stray tokens sent to the router are not recoverable and do not block commits.
///      Every successful commit preserves the router's pre-existing USDC balance.
///      WARNING: If the USDC issuer blocklists feeRecipient, every fee-bearing commit reverts
///      for as long as the blocklist persists, potentially forever, because the recipient is
///      immutable. Commits whose fee rounds down to zero skip that transfer and are an exception.
///      Allowlisting checks the vault's asset only at construction; it does not guarantee vault
///      safety, availability, share value, or immutable vault implementation and configuration.
contract CommitRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Maximum fee in basis points: 100 equals 1%.
    uint16 public constant MAX_FEE_BPS = 100;

    /// @notice Maximum number of permanently allowlisted vaults.
    uint256 public constant MAX_VAULTS = 10;

    /// @notice Basis-point denominator used to calculate fees.
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Immutable USDC token used for fees and deposits.
    IERC20 public immutable usdc;

    /// @notice Immutable recipient receiving fees directly from each committing user.
    address public immutable feeRecipient;

    /// @notice Immutable nonzero fee rate in basis points.
    uint16 public immutable feeBps;

    /// @notice Whether a vault belongs to the permanently configured allowlist.
    mapping(address => bool) public isAllowedVault;

    /// @dev Constructor-only list, retained in its supplied order.
    address[] private _vaults;

    /// @notice The token, fee recipient, or a vault is the zero address.
    error ZeroAddress();

    /// @notice The fee recipient is the token, this router, or an allowlisted vault.
    error InvalidFeeRecipient();

    /// @notice The supplied fee is zero or exceeds the maximum.
    /// @param feeBps Supplied fee rate in basis points.
    /// @param max Maximum permitted fee rate in basis points.
    error FeeOutOfRange(uint16 feeBps, uint16 max);

    /// @notice The vault list is empty or exceeds MAX_VAULTS.
    error NoVaults();

    /// @notice A vault occurs more than once in the constructor list.
    /// @param vault Duplicated vault address.
    error DuplicateVault(address vault);

    /// @notice A vault's reported asset is not the configured USDC token.
    /// @param vault Vault with a mismatched asset.
    error VaultAssetMismatch(address vault);

    /// @notice The requested vault is not allowlisted.
    /// @param vault Requested vault address.
    error VaultNotAllowed(address vault);

    /// @notice The committed asset amount is zero.
    error ZeroAmount();

    /// @notice The caller received zero shares or fewer shares than the vault reported.
    /// @param reported Shares reported by the vault's deposit.
    /// @param delivered Actual increase in the caller's vault share balance.
    error ShareDeliveryMismatch(uint256 reported, uint256 delivered);

    /// @notice The deposit delivered fewer shares than the user required.
    /// @param shares Shares actually delivered to the caller.
    /// @param minShares Minimum acceptable shares.
    error SlippageExceeded(uint256 shares, uint256 minShares);

    /// @notice The router's USDC balance after the deposit differs from its starting balance.
    error LeftoverFunds();

    /// @notice Emitted after a successful deposit, fee payment, and balance-preservation check.
    /// @param user User paying assets and receiving vault shares directly.
    /// @param vault Allowlisted vault receiving the net deposit.
    /// @param assets Total committed USDC in base units, including the fee.
    /// @param fee USDC sent directly to feeRecipient, rounded down.
    /// @param net USDC deposited into the vault.
    /// @param shares Vault shares actually delivered to the user.
    event Committed(
        address indexed user,
        address indexed vault,
        uint256 assets,
        uint256 fee,
        uint256 net,
        uint256 shares
    );

    /// @notice Permanently configure USDC, the fee, its recipient, and the vault allowlist.
    /// @dev Rejects zero addresses, invalid recipients, zero or excessive fees, invalid list
    ///      lengths, duplicate vaults, and vaults reporting an asset other than USDC.
    ///      Configuration cannot be changed after deployment.
    /// @param usdc_ USDC token used for deposits and fees.
    /// @param feeRecipient_ Nonzero recipient distinct from USDC, this router, and every vault.
    /// @param feeBps_ Fee rate from 1 through MAX_FEE_BPS inclusive.
    /// @param vaults_ One through MAX_VAULTS distinct ERC-4626 vault addresses.
    constructor(IERC20 usdc_, address feeRecipient_, uint16 feeBps_, address[] memory vaults_) {
        if (address(usdc_) == address(0) || feeRecipient_ == address(0)) revert ZeroAddress();
        if (feeRecipient_ == address(usdc_) || feeRecipient_ == address(this)) revert InvalidFeeRecipient();
        if (feeBps_ == 0 || feeBps_ > MAX_FEE_BPS) revert FeeOutOfRange(feeBps_, MAX_FEE_BPS);

        uint256 length = vaults_.length;
        if (length == 0 || length > MAX_VAULTS) revert NoVaults();

        usdc = usdc_;
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;

        for (uint256 i = 0; i < length; ++i) {
            address vault = vaults_[i];
            if (vault == address(0)) revert ZeroAddress();
            if (vault == feeRecipient_) revert InvalidFeeRecipient();
            if (isAllowedVault[vault]) revert DuplicateVault(vault);
            if (IERC4626(vault).asset() != address(usdc_)) revert VaultAssetMismatch(vault);

            isAllowedVault[vault] = true;
            _vaults.push(vault);
        }
    }

    /// @notice Deposit the caller's USDC into an allowlisted vault, paying the fixed fee rate.
    /// @dev The caller must approve this router for assets. Exactly assets is pulled in total:
    ///      the rounded-down fee goes straight to feeRecipient, and the net goes through this
    ///      router into the vault. Zero fees skip the fee transfer. Shares go directly to the caller.
    ///      The vault allowance is limited to net and reset to zero after deposit; pre-existing
    ///      USDC is preserved and cannot be spent. Nonzero assets always leave at least one base
    ///      unit for the deposit because feeBps is at most 100. All checks possible before external
    ///      interactions are performed first; nonReentrant protects the transfer/deposit sequence.
    ///      The caller must receive nonzero shares and at least the number reported by the vault.
    ///      Slippage is checked against the actual increase in the caller's share balance.
    ///      Share-delivery, slippage, or balance-preservation failures revert the entire transaction,
    ///      including fee payment. No fee is charged when withdrawing directly from the vault.
    ///      Arithmetic overflow reverts for unrepresentably large fee products.
    /// @param vault Permanently allowlisted ERC-4626 vault to receive the net deposit.
    /// @param assets Total USDC base units to commit, including the fee.
    /// @param minShares Minimum acceptable delivered shares; zero still requires nonzero delivery.
    /// @return shares Shares actually delivered to msg.sender.
    function commit(address vault, uint256 assets, uint256 minShares)
        external
        nonReentrant
        returns (uint256 shares)
    {
        if (!isAllowedVault[vault]) revert VaultNotAllowed(vault);
        if (assets == 0) revert ZeroAmount();

        uint256 usdcBefore = usdc.balanceOf(address(this));
        uint256 fee = assets * feeBps / BPS_DENOMINATOR;
        uint256 net = assets - fee;

        if (fee != 0) usdc.safeTransferFrom(msg.sender, feeRecipient, fee);
        usdc.safeTransferFrom(msg.sender, address(this), net);
        usdc.forceApprove(vault, net);
        uint256 sharesBefore = IERC20(vault).balanceOf(msg.sender);
        shares = IERC4626(vault).deposit(net, msg.sender);
        uint256 delivered = IERC20(vault).balanceOf(msg.sender) - sharesBefore;
        usdc.forceApprove(vault, 0);

        if (delivered == 0 || delivered < shares) revert ShareDeliveryMismatch(shares, delivered);
        if (delivered < minShares) revert SlippageExceeded(delivered, minShares);
        if (usdc.balanceOf(address(this)) != usdcBefore) revert LeftoverFunds();

        emit Committed(msg.sender, vault, assets, fee, net, delivered);
        return delivered;
    }

    /// @notice Calculate the rounded-down fee and net deposit for an asset amount.
    /// @dev Does not quote vault shares or validate whether a commit would succeed.
    ///      Zero assets returns zero fee and net; fee-product arithmetic overflow reverts.
    /// @param assets Total USDC base units, including the fee.
    /// @return fee USDC base units payable directly to feeRecipient.
    /// @return net USDC base units remaining for the vault deposit.
    function previewCommit(uint256 assets) external view returns (uint256 fee, uint256 net) {
        fee = assets * feeBps / BPS_DENOMINATOR;
        net = assets - fee;
    }

    /// @notice Return every permanently allowlisted vault in constructor order.
    /// @return allowedVaults Copy of the configured vault list.
    function vaults() external view returns (address[] memory allowedVaults) {
        return _vaults;
    }
}
