// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

interface INftOperatorApproval {
    function setApprovalForAll(address operator, bool approved) external;
    function isApprovedForAll(address owner, address operator) external view returns (bool);
}

/**
 * @notice Incident-bound execution code for an EIP-7702 delegated source EOA.
 * @dev The source authorizes this deployed code address through an EIP-7702
 * authorization. Every executable field is committed by PLAN_HASH and the
 * immutable destination is the only caller allowed to execute the plan.
 */
contract SafeExit7702RescueDelegate {
    using SafeERC20 for IERC20;

    enum ActionKind {
        TRANSFER_NATIVE,
        TRANSFER_ERC20,
        TRANSFER_ERC721,
        TRANSFER_ERC1155,
        REVOKE_ERC20_APPROVAL,
        REVOKE_NFT_OPERATOR
    }

    struct RescueAction {
        ActionKind kind;
        address asset;
        address counterparty;
        uint256 tokenId;
        uint256 amount;
    }

    struct RescueState {
        uint256 executedBitmap;
        bool entered;
    }

    uint256 public constant MAX_ACTIONS = 256;
    uint256 public constant FULL_BALANCE = type(uint256).max;

    uint256 public immutable CHAIN_ID;
    address public immutable SOURCE;
    address public immutable DESTINATION;
    uint256 public immutable DEADLINE;
    bytes32 public immutable PLAN_HASH;
    bytes32 public immutable RESCUE_NONCE;
    bytes32 public immutable STATE_SLOT;

    error WrongExecutionContext(address actual, address expected);
    error CallerMustBeDestination(address caller, address destination);
    error WrongChain(uint256 actual, uint256 expected);
    error RescueExpired(uint256 deadline);
    error InvalidConfiguration();
    error InvalidPlanHash(bytes32 actual, bytes32 expected);
    error InvalidPlanLength(uint256 length);
    error EmptyExecutionSelection();
    error ActionIndexOutOfBounds(uint256 index, uint256 length);
    error ActionIndexesNotStrictlyIncreasing(uint256 previous, uint256 current);
    error ActionAlreadyExecuted(uint256 index);
    error ReentrantExecution();
    error InvalidActionParameters(uint256 index);
    error ContractRequired(address target);
    error ZeroAvailableBalance(uint256 index);
    error InsufficientAvailableBalance(uint256 index, uint256 available, uint256 requested);
    error NativeTransferFailed(address destination, uint256 amount);
    error UnexpectedSourceBalance(uint256 expected, uint256 actual);
    error UnexpectedDestinationBalance(uint256 expected, uint256 actual);
    error UnexpectedNftOwner(address expected, address actual);
    error ResidualAllowance(address token, address spender, uint256 allowance);
    error ResidualOperatorApproval(address collection, address operator);

    event RescueActionExecuted(
        bytes32 indexed rescueNonce,
        uint256 indexed index,
        ActionKind indexed kind,
        address asset,
        address counterparty,
        uint256 tokenId,
        uint256 amount
    );
    event RescueBatchExecuted(
        bytes32 indexed rescueNonce,
        address indexed source,
        address indexed destination,
        uint256 executedBitmap
    );

    constructor(
        uint256 expectedChainId,
        address source,
        address destination,
        uint256 deadline,
        bytes32 planHash,
        bytes32 rescueNonce
    ) {
        if (
            expectedChainId == 0 ||
            expectedChainId != block.chainid ||
            source == address(0) ||
            destination == address(0) ||
            source == destination ||
            deadline <= block.timestamp ||
            planHash == bytes32(0) ||
            rescueNonce == bytes32(0)
        ) {
            revert InvalidConfiguration();
        }

        CHAIN_ID = expectedChainId;
        SOURCE = source;
        DESTINATION = destination;
        DEADLINE = deadline;
        PLAN_HASH = planHash;
        RESCUE_NONCE = rescueNonce;
        STATE_SLOT = keccak256(
            abi.encode(
                "safeexit.eip7702.rescue-state.v1",
                expectedChainId,
                source,
                destination,
                planHash,
                rescueNonce
            )
        );
    }

    receive() external payable {}

    modifier onlyDelegatedSource() {
        if (address(this) != SOURCE) {
            revert WrongExecutionContext(address(this), SOURCE);
        }
        _;
    }

    modifier onlyDestination() {
        if (msg.sender != DESTINATION) {
            revert CallerMustBeDestination(msg.sender, DESTINATION);
        }
        _;
    }

    /**
     * @notice Executes a strictly ordered subset of a committed rescue plan.
     * @dev Calling one index at a time lets a failed or already-stolen asset
     * remain isolated instead of blocking recovery of every other asset.
     */
    function execute(
        RescueAction[] calldata plan,
        uint256[] calldata indexes
    ) external onlyDelegatedSource onlyDestination {
        if (block.chainid != CHAIN_ID) revert WrongChain(block.chainid, CHAIN_ID);
        if (block.timestamp > DEADLINE) revert RescueExpired(DEADLINE);

        uint256 planLength = plan.length;
        if (planLength == 0 || planLength > MAX_ACTIONS) {
            revert InvalidPlanLength(planLength);
        }
        bytes32 actualPlanHash = hashPlan(plan);
        if (actualPlanHash != PLAN_HASH) {
            revert InvalidPlanHash(actualPlanHash, PLAN_HASH);
        }

        uint256 selectionLength = indexes.length;
        if (selectionLength == 0) revert EmptyExecutionSelection();

        RescueState storage state = _rescueState();
        if (state.entered) revert ReentrantExecution();
        state.entered = true;

        uint256 previous;
        for (uint256 position; position < selectionLength; ++position) {
            uint256 index = indexes[position];
            if (index >= planLength) revert ActionIndexOutOfBounds(index, planLength);
            if (position != 0 && index <= previous) {
                revert ActionIndexesNotStrictlyIncreasing(previous, index);
            }
            previous = index;

            uint256 bit = uint256(1) << index;
            if (state.executedBitmap & bit != 0) revert ActionAlreadyExecuted(index);
            state.executedBitmap |= bit;

            _executeAction(plan[index], index);
        }

        state.entered = false;
        emit RescueBatchExecuted(RESCUE_NONCE, SOURCE, DESTINATION, state.executedBitmap);
    }

    function hashPlan(RescueAction[] calldata plan) public pure returns (bytes32) {
        return keccak256(abi.encode(plan));
    }

    function executionBitmap() external view onlyDelegatedSource returns (uint256) {
        return _rescueState().executedBitmap;
    }

    function isActionExecuted(uint256 index) external view onlyDelegatedSource returns (bool) {
        if (index >= MAX_ACTIONS) revert ActionIndexOutOfBounds(index, MAX_ACTIONS);
        return _rescueState().executedBitmap & (uint256(1) << index) != 0;
    }

    function _rescueState() private view returns (RescueState storage state) {
        bytes32 slot = STATE_SLOT;
        assembly ("memory-safe") {
            state.slot := slot
        }
    }

    function _executeAction(RescueAction calldata action, uint256 index) private {
        if (action.kind == ActionKind.TRANSFER_NATIVE) {
            _transferNative(action, index);
        } else if (action.kind == ActionKind.TRANSFER_ERC20) {
            _transferERC20(action, index);
        } else if (action.kind == ActionKind.TRANSFER_ERC721) {
            _transferERC721(action, index);
        } else if (action.kind == ActionKind.TRANSFER_ERC1155) {
            _transferERC1155(action, index);
        } else if (action.kind == ActionKind.REVOKE_ERC20_APPROVAL) {
            _revokeERC20Approval(action, index);
        } else if (action.kind == ActionKind.REVOKE_NFT_OPERATOR) {
            _revokeNftOperator(action, index);
        } else {
            revert InvalidActionParameters(index);
        }
    }

    function _transferNative(RescueAction calldata action, uint256 index) private {
        if (
            action.asset != address(0) ||
            action.counterparty != DESTINATION ||
            action.tokenId != 0
        ) {
            revert InvalidActionParameters(index);
        }

        uint256 sourceBefore = address(this).balance;
        uint256 amount = _resolveAmount(action.amount, sourceBefore, index);
        uint256 destinationBefore = DESTINATION.balance;
        (bool success,) = payable(DESTINATION).call{value: amount}("");
        if (!success) revert NativeTransferFailed(DESTINATION, amount);

        uint256 sourceAfter = address(this).balance;
        uint256 destinationAfter = DESTINATION.balance;
        if (sourceAfter != sourceBefore - amount) {
            revert UnexpectedSourceBalance(sourceBefore - amount, sourceAfter);
        }
        if (destinationAfter != destinationBefore + amount) {
            revert UnexpectedDestinationBalance(destinationBefore + amount, destinationAfter);
        }

        emit RescueActionExecuted(
            RESCUE_NONCE,
            index,
            action.kind,
            address(0),
            DESTINATION,
            0,
            amount
        );
    }

    function _transferERC20(RescueAction calldata action, uint256 index) private {
        _requireTransferAsset(action, index);
        if (action.tokenId != 0) revert InvalidActionParameters(index);

        IERC20 token = IERC20(action.asset);
        uint256 sourceBefore = token.balanceOf(SOURCE);
        uint256 amount = _resolveAmount(action.amount, sourceBefore, index);
        uint256 destinationBefore = token.balanceOf(DESTINATION);
        token.safeTransfer(DESTINATION, amount);

        uint256 sourceAfter = token.balanceOf(SOURCE);
        uint256 destinationAfter = token.balanceOf(DESTINATION);
        if (sourceAfter != sourceBefore - amount) {
            revert UnexpectedSourceBalance(sourceBefore - amount, sourceAfter);
        }
        if (destinationAfter != destinationBefore + amount) {
            revert UnexpectedDestinationBalance(destinationBefore + amount, destinationAfter);
        }

        emit RescueActionExecuted(
            RESCUE_NONCE,
            index,
            action.kind,
            action.asset,
            DESTINATION,
            0,
            amount
        );
    }

    function _transferERC721(RescueAction calldata action, uint256 index) private {
        _requireTransferAsset(action, index);
        if (action.amount != 1) revert InvalidActionParameters(index);

        IERC721 collection = IERC721(action.asset);
        address ownerBefore = collection.ownerOf(action.tokenId);
        if (ownerBefore != SOURCE) revert UnexpectedNftOwner(SOURCE, ownerBefore);
        collection.safeTransferFrom(SOURCE, DESTINATION, action.tokenId);
        address ownerAfter = collection.ownerOf(action.tokenId);
        if (ownerAfter != DESTINATION) {
            revert UnexpectedNftOwner(DESTINATION, ownerAfter);
        }

        emit RescueActionExecuted(
            RESCUE_NONCE,
            index,
            action.kind,
            action.asset,
            DESTINATION,
            action.tokenId,
            1
        );
    }

    function _transferERC1155(RescueAction calldata action, uint256 index) private {
        _requireTransferAsset(action, index);

        IERC1155 collection = IERC1155(action.asset);
        uint256 sourceBefore = collection.balanceOf(SOURCE, action.tokenId);
        uint256 amount = _resolveAmount(action.amount, sourceBefore, index);
        uint256 destinationBefore = collection.balanceOf(DESTINATION, action.tokenId);
        collection.safeTransferFrom(SOURCE, DESTINATION, action.tokenId, amount, "");

        uint256 sourceAfter = collection.balanceOf(SOURCE, action.tokenId);
        uint256 destinationAfter = collection.balanceOf(DESTINATION, action.tokenId);
        if (sourceAfter != sourceBefore - amount) {
            revert UnexpectedSourceBalance(sourceBefore - amount, sourceAfter);
        }
        if (destinationAfter != destinationBefore + amount) {
            revert UnexpectedDestinationBalance(destinationBefore + amount, destinationAfter);
        }

        emit RescueActionExecuted(
            RESCUE_NONCE,
            index,
            action.kind,
            action.asset,
            DESTINATION,
            action.tokenId,
            amount
        );
    }

    function _revokeERC20Approval(RescueAction calldata action, uint256 index) private {
        _requireApprovalAction(action, index);

        IERC20 token = IERC20(action.asset);
        token.forceApprove(action.counterparty, 0);
        uint256 remaining = token.allowance(SOURCE, action.counterparty);
        if (remaining != 0) {
            revert ResidualAllowance(action.asset, action.counterparty, remaining);
        }

        emit RescueActionExecuted(
            RESCUE_NONCE,
            index,
            action.kind,
            action.asset,
            action.counterparty,
            0,
            0
        );
    }

    function _revokeNftOperator(RescueAction calldata action, uint256 index) private {
        _requireApprovalAction(action, index);

        INftOperatorApproval collection = INftOperatorApproval(action.asset);
        collection.setApprovalForAll(action.counterparty, false);
        if (collection.isApprovedForAll(SOURCE, action.counterparty)) {
            revert ResidualOperatorApproval(action.asset, action.counterparty);
        }

        emit RescueActionExecuted(
            RESCUE_NONCE,
            index,
            action.kind,
            action.asset,
            action.counterparty,
            0,
            0
        );
    }

    function _requireTransferAsset(RescueAction calldata action, uint256 index) private view {
        if (
            action.asset == address(0) ||
            action.asset == SOURCE ||
            action.counterparty != DESTINATION ||
            action.asset.code.length == 0
        ) {
            revert InvalidActionParameters(index);
        }
    }

    function _requireApprovalAction(RescueAction calldata action, uint256 index) private view {
        if (
            action.asset == address(0) ||
            action.asset == SOURCE ||
            action.counterparty == address(0) ||
            action.tokenId != 0 ||
            action.amount != 0
        ) {
            revert InvalidActionParameters(index);
        }
        if (action.asset.code.length == 0) revert ContractRequired(action.asset);
    }

    function _resolveAmount(
        uint256 requested,
        uint256 available,
        uint256 index
    ) private pure returns (uint256 amount) {
        amount = requested == FULL_BALANCE ? available : requested;
        if (amount == 0) revert ZeroAvailableBalance(index);
        if (amount > available) {
            revert InsufficientAvailableBalance(index, available, amount);
        }
    }
}
