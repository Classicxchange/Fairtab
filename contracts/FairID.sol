// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title FairID
/// @notice First-come-first-served registry linking a unique lowercase name to a wallet.
/// @dev Names are 3–20 ASCII bytes, each of which must be a-z, 0-9 or _.
///      Leading, trailing, and consecutive underscores are allowed.
///      Released names are reserved for their previous owner for 30 days.
///      This contract has no administrator or payable entry points.
///      Claim fees go directly from the claimer to the immutable recipient, without registry custody.
///      Fairtab resolves names here and sends USDC directly between wallets separately.
///      Accepted transfers immediately change resolution; releases immediately remove resolution.
contract FairID is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Maximum claim fee in USDC base units (100 USDC at 6 decimals).
    uint256 public constant MAX_CLAIM_FEE = 100e6;

    /// @notice Immutable USDC token used to pay claim fees.
    IERC20 public immutable usdc;

    /// @notice Immutable wallet receiving claim fees directly from claimers.
    /// @dev WARNING: If the USDC issuer blacklists this recipient, fee-bearing claims
    ///      revert forever while it remains blacklisted: the recipient cannot be changed.
    ///      Choose a wallet its owner expects to stay usable.
    address public immutable feeRecipient;

    /// @notice Immutable nonzero fee per successful claim in USDC base units.
    uint256 public immutable claimFee;

    /// @notice Minimum permitted name length in bytes.
    uint256 public constant MIN_NAME_LENGTH = 3;

    /// @notice Maximum permitted name length in bytes.
    uint256 public constant MAX_NAME_LENGTH = 20;

    /// @notice Exclusive reclaim window for the wallet that released a name.
    uint256 public constant RESERVATION_PERIOD = 30 days;

    /// @notice Current owner of a name hash, or address(0) when unclaimed.
    /// @dev Keys are keccak256(bytes(name)).
    mapping(bytes32 nameHash => address owner) public ownerOf;

    /// @notice Previous owner of a released name, or address(0) if its release record was cleared.
    /// @dev A successful claim clears the release record, including after reservation expiry.
    mapping(bytes32 nameHash => address owner) public previousOwner;

    /// @notice Release timestamp for a name hash, or zero if its release record was cleared.
    /// @dev Records may remain after expiry until the name is claimed again.
    mapping(bytes32 nameHash => uint256 timestamp) public releasedAt;

    /// @dev A wallet's current name; empty means it holds no name.
    mapping(address wallet => string name) private _names;

    /// @dev A holder's proposed recipient and the hash of the name being offered.
    struct PendingTransfer {
        address to;
        bytes32 nameHash;
    }

    /// @dev One pending proposal per holder; a zero recipient means no proposal exists.
    mapping(address from => PendingTransfer proposal) private _pendingTransfers;

    /// @notice The supplied name does not satisfy the name rules.
    error InvalidName();

    /// @notice The supplied name already has an owner.
    /// @param nameHash Hash of the name that is already owned.
    error NameTaken(bytes32 nameHash);

    /// @notice The caller already holds a name.
    error AlreadyHasName();

    /// @notice The caller holds no name.
    error NoName();

    /// @notice The name is still reserved for a different previous owner.
    /// @param nameHash Hash of the reserved name.
    /// @param previousOwner Wallet retaining the exclusive reclaim right.
    error NameReserved(bytes32 nameHash, address previousOwner);

    /// @notice The supplied token or recipient is the zero address.
    error ZeroAddress();

    /// @notice The fee recipient is the USDC token or this registry.
    error InvalidFeeRecipient();

    /// @notice The configured claim fee must be nonzero.
    error FeeRequired();

    /// @notice The configured claim fee exceeds the permitted maximum.
    /// @param fee Supplied fee in USDC base units.
    /// @param max Maximum permitted fee in USDC base units.
    error FeeTooHigh(uint256 fee, uint256 max);

    /// @notice The recipient is the caller.
    error SameAddress();

    /// @notice The recipient already holds a name.
    /// @param recipient Wallet that already holds a name.
    error RecipientHasName(address recipient);

    /// @notice No proposal exists to cancel, or no valid proposal to the caller exists to accept.
    error NoPendingTransfer();

    /// @notice Emitted when a wallet claims a name.
    /// @param owner Wallet that now owns the name.
    /// @param nameHash keccak256(bytes(name)).
    /// @param name Claimed name.
    event NameClaimed(address indexed owner, bytes32 indexed nameHash, string name);

    /// @notice Emitted when the mandatory claim fee is paid directly to feeRecipient.
    /// @param payer Wallet paying the claim fee.
    /// @param amount Fee paid in USDC base units.
    event FeePaid(address indexed payer, uint256 amount);

    /// @notice Emitted when a wallet releases its name and begins its reservation window.
    /// @param owner Wallet releasing the name and retaining the exclusive reclaim right.
    /// @param nameHash keccak256(bytes(name)).
    /// @param name Released name.
    event NameReleased(address indexed owner, bytes32 indexed nameHash, string name);

    /// @notice Emitted when a name moves directly between wallets without a reservation.
    /// @param from Previous holder.
    /// @param to New holder.
    /// @param nameHash keccak256(bytes(name)).
    /// @param name Transferred name.
    event NameTransferred(address indexed from, address indexed to, bytes32 indexed nameHash, string name);

    /// @notice Emitted when a holder proposes a transfer, replacing any earlier proposal.
    /// @param from Current holder offering the name.
    /// @param to Wallet permitted to accept the transfer.
    /// @param nameHash keccak256(bytes(name)).
    /// @param name Name offered for transfer.
    event TransferProposed(address indexed from, address indexed to, bytes32 indexed nameHash, string name);

    /// @notice Emitted when a holder explicitly cancels a pending proposal.
    /// @param from Holder cancelling the proposal.
    /// @param to Previously proposed recipient.
    /// @param nameHash Hash of the name whose proposal was cancelled.
    event TransferCancelled(address indexed from, address indexed to, bytes32 indexed nameHash);

    /// @notice Configure the token, fee recipient, and per-claim fee permanently.
    /// @dev Rejects zero token/recipient addresses, token/self recipients, zero fees, and fees above MAX_CLAIM_FEE.
    ///      There is no administrator or mechanism to update these values after deployment.
    /// @param usdc_ USDC token with 6 decimals.
    /// @param feeRecipient_ Wallet its owner expects to stay usable. If blacklisted by
    ///      the USDC issuer, fee-bearing claims revert forever while blacklisted because
    ///      the recipient is immutable and cannot be replaced.
    /// @param claimFee_ Nonzero fee in USDC base units, at most MAX_CLAIM_FEE.
    constructor(IERC20 usdc_, address feeRecipient_, uint256 claimFee_) {
        if (address(usdc_) == address(0) || feeRecipient_ == address(0)) revert ZeroAddress();
        if (feeRecipient_ == address(usdc_) || feeRecipient_ == address(this)) revert InvalidFeeRecipient();
        if (claimFee_ == 0) revert FeeRequired();
        if (claimFee_ > MAX_CLAIM_FEE) revert FeeTooHigh(claimFee_, MAX_CLAIM_FEE);

        usdc = usdc_;
        feeRecipient = feeRecipient_;
        claimFee = claimFee_;
    }

    /// @notice Claim a valid, unclaimed name for the caller, paying claimFee.
    /// @dev The caller must hold no name. During a reservation only the previous owner
    ///      may claim; at exactly releasedAt + RESERVATION_PERIOD anyone may claim.
    ///      Successful claims clear all release metadata for the name.
    ///      Every successful claim, including reserved reclaims, incurs the same fee.
    ///      Approve this registry to spend claimFee before claiming.
    ///      Fees move directly to feeRecipient after state updates; payment failure reverts
    ///      the entire claim. No refunds are provided. Release and transfer operations remain free.
    /// @param name Exact lowercase ASCII name to claim; no normalization is performed.
    function claim(string calldata name) external nonReentrant {
        if (!isValidName(name)) revert InvalidName();
        bytes32 nameHash = keccak256(bytes(name));
        if (ownerOf[nameHash] != address(0)) revert NameTaken(nameHash);
        if (bytes(_names[msg.sender]).length != 0) revert AlreadyHasName();
        if (_isReserved(nameHash) && previousOwner[nameHash] != msg.sender) {
            revert NameReserved(nameHash, previousOwner[nameHash]);
        }

        ownerOf[nameHash] = msg.sender;
        _names[msg.sender] = name;
        delete previousOwner[nameHash];
        delete releasedAt[nameHash];

        emit NameClaimed(msg.sender, nameHash, name);

        usdc.safeTransferFrom(msg.sender, feeRecipient, claimFee);
        emit FeePaid(msg.sender, claimFee);
    }

    /// @notice Release the caller's name and reserve it for the caller for 30 days.
    /// @dev Resolution returns address(0) immediately. Reclaiming still requires holding
    ///      no other name. Reverts with NoName if the caller holds none.
    ///      Any pending transfer proposed by the caller is cleared.
    function release() external {
        string memory name = _names[msg.sender];
        if (bytes(name).length == 0) revert NoName();
        bytes32 nameHash = keccak256(bytes(name));

        delete ownerOf[nameHash];
        delete _names[msg.sender];
        delete _pendingTransfers[msg.sender];
        previousOwner[nameHash] = msg.sender;
        releasedAt[nameHash] = block.timestamp;

        emit NameReleased(msg.sender, nameHash, name);
    }

    /// @notice Propose transferring the caller's name to another wallet.
    /// @dev Reverts with NoName, ZeroAddress, or SameAddress for invalid proposals.
    ///      Replaces any earlier proposal without changing ownership or resolution.
    ///      The recipient may already hold a name, but must hold none when accepting.
    /// @param to Nonzero recipient wallet, distinct from the caller.
    function proposeTransfer(address to) external {
        string memory name = _names[msg.sender];
        if (bytes(name).length == 0) revert NoName();
        if (to == address(0)) revert ZeroAddress();
        if (to == msg.sender) revert SameAddress();
        bytes32 nameHash = keccak256(bytes(name));

        _pendingTransfers[msg.sender] = PendingTransfer({to: to, nameHash: nameHash});

        emit TransferProposed(msg.sender, to, nameHash, name);
    }

    /// @notice Cancel the caller's pending transfer proposal.
    /// @dev Reverts with NoPendingTransfer if no proposal exists; ownership is unchanged.
    function cancelTransfer() external {
        PendingTransfer memory proposal = _pendingTransfers[msg.sender];
        if (proposal.to == address(0)) revert NoPendingTransfer();

        delete _pendingTransfers[msg.sender];

        emit TransferCancelled(msg.sender, proposal.to, proposal.nameHash);
    }

    /// @notice Accept a transfer of the specified holder's name to the caller.
    /// @dev Reverts with NoPendingTransfer unless the proposal targets the caller and
    ///      matches the holder's current name. Reverts with RecipientHasName if the
    ///      caller already holds a name. Acceptance immediately changes resolution,
    ///      clears the proposal and release metadata, and leaves the sender nameless.
    ///      No reservation is created and no funds are moved.
    /// @param from Holder whose pending proposal the caller accepts.
    function acceptTransfer(address from) external {
        PendingTransfer memory proposal = _pendingTransfers[from];
        if (proposal.to != msg.sender) revert NoPendingTransfer();
        string memory name = _names[from];
        bytes32 nameHash = keccak256(bytes(name));
        if (bytes(name).length == 0 || proposal.nameHash != nameHash) revert NoPendingTransfer();
        if (bytes(_names[msg.sender]).length != 0) revert RecipientHasName(msg.sender);

        delete _names[from];
        _names[msg.sender] = name;
        ownerOf[nameHash] = msg.sender;
        delete previousOwner[nameHash];
        delete releasedAt[nameHash];
        delete _pendingTransfers[from];

        emit NameTransferred(from, msg.sender, nameHash, name);
    }

    /// @notice Look up a holder's pending transfer proposal.
    /// @param from Holder whose proposal is queried.
    /// @return to Proposed recipient, or address(0) if no proposal exists.
    /// @return nameHash Hash of the offered name, or bytes32(0) if no proposal exists.
    function pendingTransferOf(address from) external view returns (address to, bytes32 nameHash) {
        PendingTransfer storage proposal = _pendingTransfers[from];
        return (proposal.to, proposal.nameHash);
    }

    /// @notice Resolve a valid name to its current wallet.
    /// @param name Exact name to resolve, without normalization.
    /// @return wallet Current owner, or address(0) if the name is invalid or unclaimed.
    function resolve(string calldata name) external view returns (address wallet) {
        if (!isValidName(name)) return address(0);
        return ownerOf[keccak256(bytes(name))];
    }

    /// @notice Look up a wallet's current name.
    /// @param wallet Wallet to query.
    /// @return name Current name, or an empty string if the wallet holds none.
    function nameOf(address wallet) external view returns (string memory name) {
        return _names[wallet];
    }

    /// @notice Whether a name is valid, unclaimed, and not reserved for anyone.
    /// @dev Independent of msg.sender and whether any prospective caller already holds a name.
    /// @param name Exact name to query.
    /// @return available True if the name is publicly available to claim.
    function isAvailable(string calldata name) external view returns (bool available) {
        if (!isValidName(name)) return false;
        bytes32 nameHash = keccak256(bytes(name));
        return ownerOf[nameHash] == address(0) && !_isReserved(nameHash);
    }

    /// @notice Whether a valid, unclaimed name is unreserved or reserved for a given wallet.
    /// @dev Checks name availability only, not whether who already holds another name.
    ///      A true result does not waive claim's one-name-per-wallet requirement.
    /// @param name Exact name to query.
    /// @param who Prospective claimant whose reservation rights should be considered.
    /// @return available True if no owner or reservation prevents who from claiming the name.
    function isAvailableFor(string calldata name, address who) external view returns (bool available) {
        if (!isValidName(name)) return false;
        bytes32 nameHash = keccak256(bytes(name));
        return ownerOf[nameHash] == address(0)
            && (!_isReserved(nameHash) || previousOwner[nameHash] == who);
    }

    /// @notice Check all onchain name rules without normalizing the input.
    /// @dev Validation loops over at most MAX_NAME_LENGTH bytes; non-ASCII bytes fail.
    /// @param name Name to validate.
    /// @return valid True exactly when the name satisfies every rule.
    function isValidName(string calldata name) public pure returns (bool valid) {
        bytes calldata characters = bytes(name);
        uint256 length = characters.length;
        if (length < MIN_NAME_LENGTH || length > MAX_NAME_LENGTH) return false;

        for (uint256 i = 0; i < length;) {
            bytes1 character = characters[i];
            if (
                !(character >= 0x61 && character <= 0x7a)
                    && !(character >= 0x30 && character <= 0x39)
                    && character != 0x5f
            ) return false;
            unchecked {
                ++i;
            }
        }
        return true;
    }

    /// @dev Checks reservation activity using previousOwner as the record-existence marker.
    /// @param nameHash Hash of the name whose reservation is queried.
    /// @return reserved True before the exclusive reclaim window expires.
    function _isReserved(bytes32 nameHash) private view returns (bool reserved) {
        return previousOwner[nameHash] != address(0)
            && block.timestamp < releasedAt[nameHash] + RESERVATION_PERIOD;
    }
}
