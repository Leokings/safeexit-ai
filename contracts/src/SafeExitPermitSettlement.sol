// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IDaiPermitToken is IERC20 {
    function nonces(address holder) external view returns (uint256);

    function permit(
        address holder,
        address spender,
        uint256 nonce,
        uint256 expiry,
        bool allowed,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

interface IERC4494Token is IERC721 {
    function nonces(uint256 tokenId) external view returns (uint256);

    function permit(address spender, uint256 tokenId, uint256 deadline, bytes calldata signature) external;
}

/**
 * @notice Stateless destination-paid settlement for verified permit routes.
 * @dev The source signs both the token permit and a SafeExit authorization that
 *      binds the final destination. The contract has no owner, custody, arbitrary
 *      call primitive, upgrade hook, or asset-withdrawal function.
 */
contract SafeExitPermitSettlement is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Signature {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    uint8 public constant PERMIT_KIND_ERC2612 = 1;
    uint8 public constant PERMIT_KIND_DAI = 2;

    bytes32 public constant ERC20_RESCUE_TYPEHASH = keccak256(
        "ERC20Rescue(address token,address owner,address destination,uint256 amount,uint256 permitNonce,uint256 deadline,bytes32 rescueNonce,uint8 permitKind)"
    );
    bytes32 public constant ERC721_RESCUE_TYPEHASH = keccak256(
        "ERC721Rescue(address collection,address owner,address destination,uint256 tokenId,uint256 permitNonce,uint256 deadline,bytes32 rescueNonce)"
    );

    mapping(address owner => mapping(bytes32 rescueNonce => bool used)) public rescueNonceUsed;

    error CallerMustBeDestination(address caller, address destination);
    error ContractRequired(address target);
    error DestinationCannotBeSource(address source);
    error InvalidPermitNonce(uint256 provided, uint256 expected);
    error InvalidRescueSigner(address signer, address owner);
    error RescueAuthorizationExpired(uint256 deadline);
    error RescueNonceAlreadyUsed(address owner, bytes32 rescueNonce);
    error ResidualAllowance(uint256 allowance);
    error UnexpectedDestinationBalance(uint256 expectedIncrease, uint256 actualIncrease);
    error UnexpectedNftOwner(address expected, address actual);
    error ZeroAddress();
    error ZeroAmount();

    event ERC20Rescued(
        address indexed token,
        address indexed owner,
        address indexed destination,
        uint256 amount,
        uint8 permitKind,
        bytes32 rescueNonce
    );
    event ERC721Rescued(
        address indexed collection,
        address indexed owner,
        address indexed destination,
        uint256 tokenId,
        bytes32 rescueNonce
    );

    constructor() EIP712("SafeExit Permit Settlement", "1") {}

    function settleERC2612(
        address token,
        address owner,
        address destination,
        uint256 amount,
        uint256 permitNonce,
        uint256 deadline,
        bytes32 rescueNonce,
        Signature calldata permitSignature,
        Signature calldata rescueSignature
    ) external nonReentrant {
        _validateERC20Request(token, owner, destination, amount);
        _consumeERC20Authorization(
            token,
            owner,
            destination,
            amount,
            permitNonce,
            deadline,
            rescueNonce,
            PERMIT_KIND_ERC2612,
            rescueSignature
        );

        IERC20Permit permitToken = IERC20Permit(token);
        uint256 currentNonce = permitToken.nonces(owner);
        if (currentNonce != permitNonce) revert InvalidPermitNonce(permitNonce, currentNonce);

        permitToken.permit(
            owner,
            address(this),
            amount,
            deadline,
            permitSignature.v,
            permitSignature.r,
            permitSignature.s
        );
        _transferExactERC20(IERC20(token), owner, destination, amount);
        _requireZeroAllowance(IERC20(token), owner);

        emit ERC20Rescued(token, owner, destination, amount, PERMIT_KIND_ERC2612, rescueNonce);
    }

    function settleDaiPermit(
        address token,
        address holder,
        address destination,
        uint256 amount,
        uint256 allowNonce,
        uint256 expiry,
        bytes32 rescueNonce,
        Signature calldata allowSignature,
        Signature calldata revokeSignature,
        Signature calldata rescueSignature
    ) external nonReentrant {
        _validateERC20Request(token, holder, destination, amount);
        _consumeERC20Authorization(
            token,
            holder,
            destination,
            amount,
            allowNonce,
            expiry,
            rescueNonce,
            PERMIT_KIND_DAI,
            rescueSignature
        );

        IDaiPermitToken permitToken = IDaiPermitToken(token);
        uint256 currentNonce = permitToken.nonces(holder);
        if (currentNonce != allowNonce) revert InvalidPermitNonce(allowNonce, currentNonce);

        permitToken.permit(
            holder,
            address(this),
            allowNonce,
            expiry,
            true,
            allowSignature.v,
            allowSignature.r,
            allowSignature.s
        );
        _transferExactERC20(IERC20(token), holder, destination, amount);
        permitToken.permit(
            holder,
            address(this),
            allowNonce + 1,
            expiry,
            false,
            revokeSignature.v,
            revokeSignature.r,
            revokeSignature.s
        );
        _requireZeroAllowance(IERC20(token), holder);

        emit ERC20Rescued(token, holder, destination, amount, PERMIT_KIND_DAI, rescueNonce);
    }

    function settleERC4494(
        address collection,
        address owner,
        address destination,
        uint256 tokenId,
        uint256 permitNonce,
        uint256 deadline,
        bytes32 rescueNonce,
        bytes calldata permitSignature,
        Signature calldata rescueSignature
    ) external nonReentrant {
        _validateCommon(collection, owner, destination);
        _consumeERC721Authorization(
            collection,
            owner,
            destination,
            tokenId,
            permitNonce,
            deadline,
            rescueNonce,
            rescueSignature
        );

        IERC4494Token permitToken = IERC4494Token(collection);
        uint256 currentNonce = permitToken.nonces(tokenId);
        if (currentNonce != permitNonce) revert InvalidPermitNonce(permitNonce, currentNonce);
        address currentOwner = permitToken.ownerOf(tokenId);
        if (currentOwner != owner) revert UnexpectedNftOwner(owner, currentOwner);

        permitToken.permit(address(this), tokenId, deadline, permitSignature);
        permitToken.safeTransferFrom(owner, destination, tokenId);
        address finalOwner = permitToken.ownerOf(tokenId);
        if (finalOwner != destination) revert UnexpectedNftOwner(destination, finalOwner);

        emit ERC721Rescued(collection, owner, destination, tokenId, rescueNonce);
    }

    function _consumeERC20Authorization(
        address token,
        address owner,
        address destination,
        uint256 amount,
        uint256 permitNonce,
        uint256 deadline,
        bytes32 rescueNonce,
        uint8 permitKind,
        Signature calldata signature
    ) private {
        _validateAuthorization(owner, deadline, rescueNonce);
        bytes32 structHash = keccak256(
            abi.encode(
                ERC20_RESCUE_TYPEHASH,
                token,
                owner,
                destination,
                amount,
                permitNonce,
                deadline,
                rescueNonce,
                permitKind
            )
        );
        _consumeAuthorization(owner, rescueNonce, structHash, signature);
    }

    function _consumeERC721Authorization(
        address collection,
        address owner,
        address destination,
        uint256 tokenId,
        uint256 permitNonce,
        uint256 deadline,
        bytes32 rescueNonce,
        Signature calldata signature
    ) private {
        _validateAuthorization(owner, deadline, rescueNonce);
        bytes32 structHash = keccak256(
            abi.encode(
                ERC721_RESCUE_TYPEHASH,
                collection,
                owner,
                destination,
                tokenId,
                permitNonce,
                deadline,
                rescueNonce
            )
        );
        _consumeAuthorization(owner, rescueNonce, structHash, signature);
    }

    function _consumeAuthorization(
        address owner,
        bytes32 rescueNonce,
        bytes32 structHash,
        Signature calldata signature
    ) private {
        if (rescueNonceUsed[owner][rescueNonce]) revert RescueNonceAlreadyUsed(owner, rescueNonce);
        address signer = ECDSA.recover(
            _hashTypedDataV4(structHash),
            signature.v,
            signature.r,
            signature.s
        );
        if (signer != owner) revert InvalidRescueSigner(signer, owner);
        rescueNonceUsed[owner][rescueNonce] = true;
    }

    function _validateAuthorization(address owner, uint256 deadline, bytes32 rescueNonce) private view {
        if (block.timestamp > deadline) revert RescueAuthorizationExpired(deadline);
        if (rescueNonceUsed[owner][rescueNonce]) revert RescueNonceAlreadyUsed(owner, rescueNonce);
    }

    function _validateERC20Request(
        address token,
        address owner,
        address destination,
        uint256 amount
    ) private view {
        _validateCommon(token, owner, destination);
        if (amount == 0) revert ZeroAmount();
    }

    function _validateCommon(address target, address owner, address destination) private view {
        if (target == address(0) || owner == address(0) || destination == address(0)) revert ZeroAddress();
        if (target.code.length == 0) revert ContractRequired(target);
        if (owner == destination) revert DestinationCannotBeSource(owner);
        if (msg.sender != destination) revert CallerMustBeDestination(msg.sender, destination);
    }

    function _transferExactERC20(
        IERC20 token,
        address owner,
        address destination,
        uint256 amount
    ) private {
        uint256 balanceBefore = token.balanceOf(destination);
        token.safeTransferFrom(owner, destination, amount);
        uint256 balanceAfter = token.balanceOf(destination);
        uint256 actualIncrease = balanceAfter >= balanceBefore ? balanceAfter - balanceBefore : 0;
        if (actualIncrease != amount) revert UnexpectedDestinationBalance(amount, actualIncrease);
    }

    function _requireZeroAllowance(IERC20 token, address owner) private view {
        uint256 remainingAllowance = token.allowance(owner, address(this));
        if (remainingAllowance != 0) revert ResidualAllowance(remainingAllowance);
    }
}
