// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice PROTOCOL RISK: This contract holds USDC for all active bills in a single custody address.
/// If the USDC issuer (Circle) blocklists this contract address, all in-flight transfers (pay, claimPayout,
/// claimRefund) will revert and funds will be frozen until the blocklist is lifted or a migration is executed.
/// This is a known architectural tradeoff of the single-contract factory design.

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Push-first payout model: on settlement the contract immediately pushes funds to the payee.
/// @notice If the push transfer fails (reverted payee, blocklist), the amount is stored for manual pull via claimPayout().
/// @notice An unclaimed settled payout may be redirected only through participant quorum voting via votePayoutRedirect().
contract HouseholdBillSplitter is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum BillStatus {
        Active,
        Settled,
        Cancelled
    }

    struct Share {
        address participant;
        uint256 amount;
        uint256 contributed;
    }

    struct Bill {
        address creator;
        bytes32 label;
        address payee;
        uint256 totalAmount;
        uint256 amountPaid;
        BillStatus status;
        uint256 deadline;
        uint256 settledAt;
        bool recurring;
        uint256 recurInterval;
        uint8 cancelThreshold;
        uint8 cancelVotes;
        Share[] shares;
    }

    error BillNotActive(uint256 billId);
    error NotParticipant(uint256 billId, address caller);
    error ZeroPayment(uint256 billId);
    error ExceedsRemaining(uint256 billId, uint256 payAmount, uint256 remaining);
    error DeadlineExpired(uint256 billId);
    error AlreadyVotedCancel(uint256 billId, address voter);
    error NotAuthorizedToCancel(uint256 billId, address caller);
    error NoRefundAvailable(uint256 billId, address caller);
    error InvalidBillParams(string reason);
    error ZeroAddress();
    error NotPayee(uint256 billId, address caller);
    error NoPayoutAvailable(uint256 billId);
    error DeadlineNotExpired(uint256 billId);
    error NoExpiredRefund(uint256 billId, address caller);
    error BillNotSettled(uint256 billId);
    error PayoutRedirectNotReady(uint256 billId);
    error PayoutRedirectNoCandidate(uint256 billId);
    error AlreadyVotedRedirect(uint256 billId, address voter);
    error PayoutReclaimNotReady(uint256 billId);
    error NoReclaimAvailable(uint256 billId, address caller);

    event BillCreated(
        uint256 indexed billId,
        bytes32 indexed label,
        address indexed creator,
        address payee,
        uint256 totalAmount,
        uint256 deadline,
        bool recurring,
        uint256 recurInterval,
        uint8 cancelThreshold
    );
    event SharePaid(uint256 indexed billId, address indexed participant, uint256 amount);
    event ShareContributed(
        uint256 indexed billId,
        address indexed participant,
        uint256 payAmount,
        uint256 contributed,
        uint256 shareAmount
    );
    event BillSettled(uint256 indexed billId, address indexed payee, uint256 totalAmount);
    event CancelVote(uint256 indexed billId, address indexed voter);
    event BillCancelled(uint256 indexed billId);
    event RefundClaimed(uint256 indexed billId, address indexed participant, uint256 amount);
    event PayoutPushed(uint256 indexed billId, address indexed payee, uint256 amount);
    event PayoutClaimed(uint256 indexed billId, address indexed payee, uint256 amount);
    event PayeeRedirected(uint256 indexed billId, address indexed oldPayee, address indexed newPayee);
    event PayoutRedirectVote(uint256 indexed billId, address indexed voter, address indexed candidate, uint8 votes);
    event PayoutReclaimed(uint256 indexed billId, address indexed participant, uint256 amount);
    event TokenRecovered(address indexed token, address indexed to, uint256 amount);

    uint256 public billCount;
    mapping(uint256 => Bill) private _bills;
    mapping(uint256 => mapping(address => bool)) public cancelVoted;
    mapping(uint256 => mapping(address => uint256)) public refundable;
    mapping(uint256 => mapping(address => bool)) public expiredRefundClaimed;
    mapping(uint256 => uint256) public payoutClaimable;
    mapping(uint256 => uint256) public payoutReclaimBase;
    mapping(uint256 => mapping(address => uint8)) public payoutRedirectCandidateVotes;
    mapping(uint256 => mapping(address => bool)) public payoutReclaimClaimed;
    mapping(uint256 => uint8) public payoutReclaimCount;
    mapping(uint256 => mapping(address => bool)) private _hasVotedRedirect;
    mapping(uint256 => mapping(address => address)) private _redirectVoteChoice;
    mapping(uint256 => uint8) public payoutRedirectVotes;
    address public immutable usdc;
    uint8 public constant MAX_PARTICIPANTS = 20;
    /// @notice Default deadline applied when creator passes deadline == 0.
    /// Guarantees every bill has a finite expiry so claimExpiredRefund is always reachable.
    uint256 public constant MAX_BILL_DURATION = 90 days;
    /// @notice Grace period after settlement before participants may vote to redirect an unclaimed payout.
    uint256 public constant PAYOUT_REDIRECT_GRACE = 7 days;
    /// @notice Timeout after settlement before contributors can reclaim a proportional share of unclaimed stuck payout.
    uint256 public constant PAYOUT_RECLAIM_TIMEOUT = 91 days;
    uint256 private _totalReserved;

    /// @dev The deploying address becomes the initial owner. Transfer ownership to a
    ///      multisig or timelock before mainnet production use.
    constructor(address usdc_) Ownable(msg.sender) {
        if (usdc_ == address(0)) revert ZeroAddress();
        if (usdc_.code.length == 0) revert InvalidBillParams("usdc_ must be a contract");
        usdc = usdc_;
    }

    /// @notice Creates a bill with up to MAX_PARTICIPANTS participants.
    function createBill(
        uint256 totalAmount,
        bytes32 label,
        address payee,
        address[] calldata participants,
        uint256[] calldata amounts,
        bool usePercentages,
        uint256 deadline,
        bool recurring,
        uint256 recurInterval,
        uint8 cancelThreshold
    ) external returns (uint256 billId) {
        return
            _createBill(
                msg.sender,
                totalAmount,
                label,
                payee,
                participants,
                amounts,
                usePercentages,
                deadline,
                recurring,
                recurInterval,
                cancelThreshold
            );
    }

    /// @notice Pay any portion of your share. Can be called multiple times until share is fully covered.
    /// @param billId The bill to pay into.
    /// @param payAmount The USDC amount to contribute this call. Must be > 0 and <= remaining share balance.
    function pay(uint256 billId, uint256 payAmount) external nonReentrant {
        Bill storage bill = _activeBill(billId);

        // Block payments after deadline — post-expiry path is claimExpiredRefund only
        if (bill.deadline != 0 && block.timestamp > bill.deadline) revert DeadlineExpired(billId);

        (bool found, uint256 shareIndex) = _findShareIndex(bill, msg.sender);
        if (!found) revert NotParticipant(billId, msg.sender);

        Share storage share = bill.shares[shareIndex];
        if (payAmount == 0) revert ZeroPayment(billId);

        uint256 remaining = share.amount - share.contributed;
        if (payAmount > remaining) revert ExceedsRemaining(billId, payAmount, remaining);

        IERC20(usdc).safeTransferFrom(msg.sender, address(this), payAmount);
        _totalReserved += payAmount;

        share.contributed += payAmount;
        bill.amountPaid += payAmount;

        emit ShareContributed(billId, msg.sender, payAmount, share.contributed, share.amount);

        if (share.contributed == share.amount) {
            emit SharePaid(billId, msg.sender, share.amount);
        }

        if (bill.amountPaid == bill.totalAmount) {
            bill.status = BillStatus.Settled;
            bill.settledAt = block.timestamp;

            emit BillSettled(billId, bill.payee, bill.totalAmount);

            // Raw transfer (not SafeERC20) is intentional: safeTransfer reverts on failure,
            // which would prevent the bill status from being updated to Settled.
            // We catch failures here and store payoutClaimable for manual pull via claimPayout().
            uint256 payout = bill.totalAmount;
            address payee = bill.payee;
            try IERC20(usdc).transfer(payee, payout) returns (bool ok) {
                if (ok) {
                    _totalReserved -= payout;
                    emit PayoutPushed(billId, payee, payout);
                } else {
                    // transfer returned false — store for pull fallback
                    payoutClaimable[billId] = payout;
                }
            } catch {
                // transfer reverted — store for pull fallback
                payoutClaimable[billId] = payout;
            }

            if (bill.recurring) {
                _spawnRecurringBill(billId);
            }
        }
    }

    function voteCancel(uint256 billId) external {
        Bill storage bill = _activeBill(billId);

        bool isCreator = msg.sender == bill.creator;
        bool isParticipant_ = _isParticipant(bill, msg.sender);
        if (!isCreator && !isParticipant_) revert NotAuthorizedToCancel(billId, msg.sender);

        if (cancelVoted[billId][msg.sender]) revert AlreadyVotedCancel(billId, msg.sender);

        cancelVoted[billId][msg.sender] = true;

        // Only count toward quorum if voter is a participant with amount > 0
        bool eligible = false;
        for (uint256 i = 0; i < bill.shares.length; i++) {
            if (bill.shares[i].participant == msg.sender && bill.shares[i].amount > 0) {
                eligible = true;
                break;
            }
        }
        if (eligible) bill.cancelVotes += 1;

        emit CancelVote(billId, msg.sender);

        if (bill.cancelVotes >= bill.cancelThreshold) {
            bill.status = BillStatus.Cancelled;

            uint256 shareCount = bill.shares.length;
            for (uint256 i = 0; i < shareCount; i++) {
                Share storage share = bill.shares[i];
                if (share.contributed > 0) {
                    refundable[billId][share.participant] = share.contributed;
                }
            }

            emit BillCancelled(billId);
        }
    }

    function claimRefund(uint256 billId) external nonReentrant {
        uint256 amount = refundable[billId][msg.sender];
        if (amount == 0) revert NoRefundAvailable(billId, msg.sender);

        refundable[billId][msg.sender] = 0;
        _totalReserved -= amount;
        IERC20(usdc).safeTransfer(msg.sender, amount);

        emit RefundClaimed(billId, msg.sender, amount);
    }

    function claimExpiredRefund(uint256 billId) external nonReentrant {
        Bill storage bill = _activeBill(billId);
        if (bill.deadline == 0 || block.timestamp <= bill.deadline) revert DeadlineNotExpired(billId);

        (bool found, uint256 shareIndex) = _findShareIndex(bill, msg.sender);
        if (!found) revert NoExpiredRefund(billId, msg.sender);

        Share storage share = bill.shares[shareIndex];
        if (share.contributed == 0 || expiredRefundClaimed[billId][msg.sender]) revert NoExpiredRefund(billId, msg.sender);

        if (bill.amountPaid < bill.totalAmount) {
            bill.status = BillStatus.Cancelled;

            uint256 shareCount = bill.shares.length;
            for (uint256 i = 0; i < shareCount; i++) {
                Share storage s = bill.shares[i];
                if (s.contributed > 0) {
                    refundable[billId][s.participant] = s.contributed;
                }
            }

            emit BillCancelled(billId);
        }

        uint256 amount = refundable[billId][msg.sender];
        if (amount == 0) revert NoExpiredRefund(billId, msg.sender);

        expiredRefundClaimed[billId][msg.sender] = true;
        refundable[billId][msg.sender] = 0;
        _totalReserved -= amount;
        IERC20(usdc).safeTransfer(msg.sender, amount);

        emit RefundClaimed(billId, msg.sender, amount);
    }

    /// @notice Fallback payout claim: only needed when the automatic push on settlement failed.
    /// @notice Unclaimed payout redirection is participant-governed through votePayoutRedirect().
    function claimPayout(uint256 billId) external nonReentrant {
        Bill storage bill = _bills[billId];
        if (msg.sender != bill.payee) revert NotPayee(billId, msg.sender);

        uint256 amount = payoutClaimable[billId];
        if (amount == 0) revert NoPayoutAvailable(billId);
        if (payoutReclaimBase[billId] > 0) revert InvalidBillParams("reclaim mode active: use reclaimStuckPayout");

        payoutClaimable[billId] = 0;
        _totalReserved -= amount;
        IERC20(usdc).safeTransfer(bill.payee, amount);

        emit PayoutClaimed(billId, bill.payee, amount);
    }

    /// @notice After PAYOUT_REDIRECT_GRACE has elapsed since settlement and payout is still unclaimed,
    /// any participant who contributed to the bill may vote to redirect the payout to a candidate address.
    /// When votes reach cancelThreshold, the payee is updated to candidate and payout becomes claimable by them.
    /// @dev This is the non-creator recovery path for an unresponsive creator.
    function votePayoutRedirect(uint256 billId, address candidate) external {
        Bill storage bill = _bills[billId];
        if (bill.status != BillStatus.Settled) revert BillNotSettled(billId);

        if (payoutClaimable[billId] == 0) revert NoPayoutAvailable(billId);
        if (payoutReclaimBase[billId] > 0) revert InvalidBillParams("reclaim mode active");

        if (block.timestamp < bill.settledAt + PAYOUT_REDIRECT_GRACE) revert PayoutRedirectNotReady(billId);

        bool isParticipant = false;
        for (uint256 i = 0; i < bill.shares.length; i++) {
            if (bill.shares[i].participant == msg.sender && bill.shares[i].amount > 0) {
                isParticipant = true;
                break;
            }
        }
        if (!isParticipant) revert NotParticipant(billId, msg.sender);

        _validatePayeeAddress(candidate);

        address previousChoice = _redirectVoteChoice[billId][msg.sender];
        bool isNewVoter = !_hasVotedRedirect[billId][msg.sender];

        // If changing vote to same candidate, no-op
        if (!isNewVoter && previousChoice == candidate) revert AlreadyVotedRedirect(billId, msg.sender);

        // Decrement old candidate tally if changing vote
        if (!isNewVoter && previousChoice != candidate) {
            if (payoutRedirectCandidateVotes[billId][previousChoice] > 0) {
                payoutRedirectCandidateVotes[billId][previousChoice]--;
            }
            // Note: payoutRedirectVotes total does NOT change on a vote-change (same voter, just switching)
        } else if (isNewVoter) {
            _hasVotedRedirect[billId][msg.sender] = true;
            payoutRedirectVotes[billId]++;
        }

        // Record new choice
        _redirectVoteChoice[billId][msg.sender] = candidate;
        payoutRedirectCandidateVotes[billId][candidate]++;

        emit PayoutRedirectVote(billId, msg.sender, candidate, payoutRedirectVotes[billId]);

        // Check quorum for this specific candidate
        if (payoutRedirectCandidateVotes[billId][candidate] >= bill.cancelThreshold) {
            emit PayeeRedirected(billId, bill.payee, candidate);
            bill.payee = candidate;
        }
    }

    /// @notice Emergency reclaim: if a settled bill's payout remains unclaimed for 91 days,
    ///         contributors can reclaim their proportional share of the stuck payout.
    /// @dev Only callable when payoutClaimable > 0 (push failed, no redirect succeeded).
    function reclaimStuckPayout(uint256 billId) external nonReentrant {
        Bill storage bill = _bills[billId];
        if (bill.status != BillStatus.Settled) revert BillNotSettled(billId);
        if (payoutClaimable[billId] == 0) revert NoPayoutAvailable(billId);
        if (payoutReclaimBase[billId] == 0) payoutReclaimBase[billId] = payoutClaimable[billId];
        if (block.timestamp < bill.settledAt + PAYOUT_RECLAIM_TIMEOUT) revert PayoutReclaimNotReady(billId);
        if (payoutReclaimClaimed[billId][msg.sender]) revert NoReclaimAvailable(billId, msg.sender);
        (bool found, uint256 shareIndex) = _findShareIndex(bill, msg.sender);
        if (!found) revert NotParticipant(billId, msg.sender);
        uint256 contributed = bill.shares[shareIndex].contributed;
        if (contributed == 0) revert NoReclaimAvailable(billId, msg.sender);
        uint256 reclaimable = (contributed * payoutReclaimBase[billId]) / bill.totalAmount;
        if (reclaimable == 0) revert NoReclaimAvailable(billId, msg.sender);
        // Count eligible reclaimers (contributed > 0)
        uint8 eligibleReclaimers = 0;
        for (uint256 i = 0; i < bill.shares.length; i++) {
            if (bill.shares[i].contributed > 0) eligibleReclaimers++;
        }
        payoutReclaimClaimed[billId][msg.sender] = true;
        payoutReclaimCount[billId]++;
        bool isLastClaimant = payoutReclaimCount[billId] == eligibleReclaimers;
        uint256 remaining = payoutClaimable[billId];
        uint256 actual = isLastClaimant ? remaining : (reclaimable > remaining ? remaining : reclaimable);
        payoutClaimable[billId] -= actual;
        _totalReserved -= actual;
        IERC20(usdc).safeTransfer(msg.sender, actual);
        emit PayoutReclaimed(billId, msg.sender, actual);
    }

    function getBill(
        uint256 billId
    )
        external
        view
        returns (
            address creator,
            address payee,
            uint256 totalAmount,
            uint256 amountPaid,
            BillStatus status,
            uint256 deadline,
            bool recurring,
            uint256 recurInterval,
            uint8 cancelThreshold,
            uint8 cancelVotes
        )
    {
        if (billId >= billCount) revert InvalidBillParams("bill does not exist");

        Bill storage bill = _bills[billId];
        return (
            bill.creator,
            bill.payee,
            bill.totalAmount,
            bill.amountPaid,
            bill.status,
            bill.deadline,
            bill.recurring,
            bill.recurInterval,
            bill.cancelThreshold,
            bill.cancelVotes
        );
    }

    function getBillMeta(uint256 billId) external view returns (bytes32 label, uint8 payoutRedirectVoteCount) {
        if (billId >= billCount) revert InvalidBillParams("bill does not exist");
        return (_bills[billId].label, payoutRedirectVotes[billId]);
    }

    function getShares(uint256 billId) external view returns (Share[] memory) {
        if (billId >= billCount) revert InvalidBillParams("bill does not exist");
        return _bills[billId].shares;
    }

    /// @notice Returns how much a participant has contributed and how much remains on their share.
    function getShareProgress(
        uint256 billId,
        address participant
    ) external view returns (uint256 contributed, uint256 total, uint256 remaining) {
        if (billId >= billCount) return (0, 0, 0);

        Bill storage bill = _bills[billId];
        (bool found, uint256 shareIndex) = _findShareIndex(bill, participant);
        if (!found) return (0, 0, 0);

        Share storage share = bill.shares[shareIndex];
        contributed = share.contributed;
        total = share.amount;
        remaining = share.amount - share.contributed;
    }

    function isLate(uint256 billId, address participant) external view returns (bool) {
        if (billId >= billCount) return false;

        Bill storage bill = _bills[billId];
        if (bill.status != BillStatus.Active) return false;
        if (bill.deadline == 0 || block.timestamp <= bill.deadline) return false;

        (bool found, uint256 shareIndex) = _findShareIndex(bill, participant);
        if (!found) return false;

        return bill.shares[shareIndex].contributed < bill.shares[shareIndex].amount;
    }

    /// @notice Returns true always — exists to make the documented protocol risk discoverable on-chain.
    function protocolRiskAcknowledged() external pure returns (bool) {
        return true;
    }

    /// @notice Recover tokens accidentally sent to this contract.
    /// @dev Only sweeps the surplus above what active bill accounting tracks.
    ///      Cannot withdraw amounts reserved for refunds or unclaimed payouts.
    /// @param token  The ERC-20 token to recover (use address(usdc) for USDC).
    /// @param to     Recipient address.
    function recoverToken(address token, address to) external onlyOwner {
        _validatePayeeAddress(to);
        uint256 contractBalance = IERC20(token).balanceOf(address(this));
        uint256 reserved = _totalReserved;
        if (token != address(usdc)) {
            // For non-USDC tokens, the entire balance is unaccounted — sweep it all
            reserved = 0;
        }
        uint256 surplus = contractBalance > reserved ? contractBalance - reserved : 0;
        if (surplus == 0) revert InvalidBillParams("nothing to recover");
        IERC20(token).safeTransfer(to, surplus);
        emit TokenRecovered(token, to, surplus);
    }

    /// @dev Reverts if `addr` is the zero address or a known EVM precompile (0x1–0x9).
    function _validatePayeeAddress(address addr) private pure {
        if (addr == address(0)) revert ZeroAddress();
        // Reject known EVM precompiles: address(1) through address(9)
        if (uint160(addr) >= 1 && uint160(addr) <= 9) revert InvalidBillParams("invalid payee: precompile");
    }

    function _createBill(
        address creator,
        uint256 totalAmount,
        bytes32 label,
        address payee,
        address[] memory participants,
        uint256[] memory amounts,
        bool usePercentages,
        uint256 deadline,
        bool recurring,
        uint256 recurInterval,
        uint8 cancelThreshold
    ) internal returns (uint256 billId) {
        if (totalAmount == 0) revert InvalidBillParams("totalAmount must be > 0");
        _validatePayeeAddress(payee);

        uint256 participantCount = participants.length;
        if (participantCount == 0) revert InvalidBillParams("participants length must be > 0");
        if (participantCount > MAX_PARTICIPANTS) revert InvalidBillParams("too many participants");
        if (participantCount != amounts.length) revert InvalidBillParams("participants/amounts length mismatch");
        if (recurring && recurInterval == 0) {
            revert InvalidBillParams("recurInterval must be > 0 for recurring bills");
        }

        for (uint256 i = 0; i < participantCount; i++) {
            address participant = participants[i];
            if (participant == address(0)) revert ZeroAddress();

            for (uint256 j = i + 1; j < participantCount; j++) {
                if (participant == participants[j]) {
                    revert InvalidBillParams("duplicate participant");
                }
            }
        }

        uint256[] memory resolvedAmounts = _computeShares(amounts, totalAmount, usePercentages);

        billId = billCount;
        billCount = billCount + 1;

        Bill storage bill = _bills[billId];
        bill.creator = creator;
        bill.label = label;
        bill.payee = payee;
        bill.totalAmount = totalAmount;
        bill.amountPaid = 0;
        bill.status = BillStatus.Active;
        // If no deadline given, default to 90 days — ensures claimExpiredRefund is always reachable.
        bill.deadline = deadline == 0 ? block.timestamp + MAX_BILL_DURATION : deadline;
        bill.recurring = recurring;
        bill.recurInterval = recurInterval;
        bill.cancelThreshold = cancelThreshold;
        bill.cancelVotes = 0;

        for (uint256 i = 0; i < participantCount; i++) {
            bill.shares.push(Share({participant: participants[i], amount: resolvedAmounts[i], contributed: 0}));
        }

        // Count participants eligible to vote payout redirect (amount > 0)
        uint256 eligibleVoters = 0;
        for (uint256 i = 0; i < bill.shares.length; i++) {
            if (bill.shares[i].amount > 0) eligibleVoters++;
        }
        if (cancelThreshold == 0 || cancelThreshold > eligibleVoters) revert InvalidBillParams("bad threshold");

        _emitBillCreated(billId, bill);
    }

    /// @dev Extracts BillCreated emit into a separate call to reduce stack depth in _createBill.
    function _emitBillCreated(uint256 billId, Bill storage bill) private {
        emit BillCreated(
            billId,
            bill.label,
            bill.creator,
            bill.payee,
            bill.totalAmount,
            bill.deadline,
            bill.recurring,
            bill.recurInterval,
            bill.cancelThreshold
        );
    }

    function _computeShares(
        uint256[] memory amounts,
        uint256 totalAmount,
        bool usePercentages
    ) private pure returns (uint256[] memory computed) {
        uint256 count = amounts.length;
        computed = new uint256[](count);

        uint256 summed = 0;
        for (uint256 i = 0; i < count; i++) {
            uint256 amount = amounts[i];
            if (usePercentages && amount > 10_000) {
                revert InvalidBillParams("percentage out of range");
            }
            summed += amount;
            computed[i] = amount;
        }

        if (!usePercentages) {
            if (summed != totalAmount) revert InvalidBillParams("sum(amounts) must equal totalAmount");
            return computed;
        }

        if (summed != 10_000) revert InvalidBillParams("sum(percentages) must equal 10000");

        uint256 resolvedSum = 0;
        for (uint256 i = 0; i < count; i++) {
            uint256 shareAmount = (amounts[i] * totalAmount) / 10_000;
            computed[i] = shareAmount;
            resolvedSum += shareAmount;
        }

        if (resolvedSum < totalAmount) {
            computed[count - 1] += (totalAmount - resolvedSum);
        }
    }

    function _spawnRecurringBill(uint256 parentBillId) private {
        Bill storage parent = _bills[parentBillId];

        uint256 participantCount = parent.shares.length;
        address[] memory participants = new address[](participantCount);
        uint256[] memory amounts = new uint256[](participantCount);

        for (uint256 i = 0; i < participantCount; i++) {
            Share storage s = parent.shares[i];
            participants[i] = s.participant;
            amounts[i] = s.amount;
        }

        _createBill(
            parent.creator,
            parent.totalAmount,
            parent.label,
            parent.payee,
            participants,
            amounts,
            false,
            block.timestamp + parent.recurInterval,
            true,
            parent.recurInterval,
            parent.cancelThreshold
        );
    }

    function _activeBill(uint256 billId) internal view returns (Bill storage bill) {
        if (billId >= billCount || _bills[billId].status != BillStatus.Active) {
            revert BillNotActive(billId);
        }

        bill = _bills[billId];
    }

    function _isParticipant(Bill storage bill, address account) internal view returns (bool) {
        uint256 shareCount = bill.shares.length;
        for (uint256 i = 0; i < shareCount; i++) {
            if (bill.shares[i].participant == account) {
                return true;
            }
        }

        return false;
    }

    function _findShareIndex(Bill storage bill, address participant) internal view returns (bool found, uint256 index) {
        uint256 shareCount = bill.shares.length;
        for (uint256 i = 0; i < shareCount; i++) {
            if (bill.shares[i].participant == participant) {
                return (true, i);
            }
        }

        return (false, 0);
    }
}
