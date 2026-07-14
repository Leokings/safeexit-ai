// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @notice Public test fixtures for SafeExit route verification on X Layer mainnet.
 * @dev These assets are openly mintable, have no administrator, and have no monetary value.
 */

contract SafeExitTestERC2612 is ERC20, ERC20Permit {
    uint256 public constant MAX_FAUCET_AMOUNT = 1_000_000 ether;

    error FaucetAmountTooLarge(uint256 requested);

    constructor()
        ERC20("SafeExit ERC2612 TEST ONLY - NO VALUE", "SX2612")
        ERC20Permit("SafeExit ERC2612 TEST ONLY - NO VALUE")
    {}

    function faucet(address recipient, uint256 amount) external {
        if (amount > MAX_FAUCET_AMOUNT) revert FaucetAmountTooLarge(amount);
        _mint(recipient, amount);
    }
}

contract SafeExitTestERC3009 is ERC20, EIP712 {
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    uint256 public constant MAX_FAUCET_AMOUNT = 1_000_000 ether;

    mapping(address authorizer => mapping(bytes32 nonce => bool used)) private _authorizationStates;

    error AuthorizationAlreadyUsed(address authorizer, bytes32 nonce);
    error AuthorizationNotYetValid(uint256 validAfter);
    error AuthorizationExpired(uint256 validBefore);
    error CallerMustBePayee(address caller, address payee);
    error InvalidAuthorizationSigner(address signer, address authorizer);
    error FaucetAmountTooLarge(uint256 requested);

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    constructor()
        ERC20("SafeExit ERC3009 TEST ONLY - NO VALUE", "SX3009")
        EIP712("SafeExit ERC3009 TEST ONLY - NO VALUE", "1")
    {}

    function faucet(address recipient, uint256 amount) external {
        if (amount > MAX_FAUCET_AMOUNT) revert FaucetAmountTooLarge(amount);
        _mint(recipient, amount);
    }

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
        return _authorizationStates[authorizer][nonce];
    }

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (msg.sender != to) revert CallerMustBePayee(msg.sender, to);
        if (block.timestamp <= validAfter) revert AuthorizationNotYetValid(validAfter);
        if (block.timestamp >= validBefore) revert AuthorizationExpired(validBefore);
        if (_authorizationStates[from][nonce]) revert AuthorizationAlreadyUsed(from, nonce);

        bytes32 structHash = keccak256(
            abi.encode(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce)
        );
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), v, r, s);
        if (signer != from) revert InvalidAuthorizationSigner(signer, from);

        _authorizationStates[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);
        _transfer(from, to, value);
    }

    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}

contract SafeExitTestDaiPermit is ERC20, EIP712 {
    bytes32 public constant PERMIT_TYPEHASH =
        keccak256("Permit(address holder,address spender,uint256 nonce,uint256 expiry,bool allowed)");
    uint256 public constant MAX_FAUCET_AMOUNT = 1_000_000 ether;

    mapping(address holder => uint256 nonce) public nonces;

    error PermitExpired(uint256 expiry);
    error InvalidPermitNonce(uint256 provided, uint256 expected);
    error InvalidPermitSigner(address signer, address holder);
    error FaucetAmountTooLarge(uint256 requested);

    constructor()
        ERC20("SafeExit DAI Permit TEST ONLY - NO VALUE", "SXDAI")
        EIP712("SafeExit DAI Permit TEST ONLY - NO VALUE", "1")
    {}

    function faucet(address recipient, uint256 amount) external {
        if (amount > MAX_FAUCET_AMOUNT) revert FaucetAmountTooLarge(amount);
        _mint(recipient, amount);
    }

    function permit(
        address holder,
        address spender,
        uint256 nonce,
        uint256 expiry,
        bool allowed,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (expiry != 0 && block.timestamp > expiry) revert PermitExpired(expiry);

        uint256 expectedNonce = nonces[holder];
        if (nonce != expectedNonce) revert InvalidPermitNonce(nonce, expectedNonce);

        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, holder, spender, nonce, expiry, allowed));
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), v, r, s);
        if (signer != holder) revert InvalidPermitSigner(signer, holder);

        nonces[holder] = expectedNonce + 1;
        _approve(holder, spender, allowed ? type(uint256).max : 0);
    }

    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}

contract SafeExitTestERC4494 is ERC721, EIP712 {
    bytes4 private constant _INTERFACE_ID_ERC4494 = 0x5604e225;
    bytes32 public constant PERMIT_TYPEHASH =
        keccak256("Permit(address spender,uint256 tokenId,uint256 nonce,uint256 deadline)");

    mapping(uint256 tokenId => uint256 nonce) private _permitNonces;
    uint256 private _nextTokenId = 1;

    error PermitExpired(uint256 deadline);
    error InvalidPermitSigner(address signer, address owner);
    error InvalidPermitSignatureLength(uint256 length);

    constructor()
        ERC721("SafeExit ERC4494 TEST ONLY - NO VALUE", "SX4494")
        EIP712("SafeExit ERC4494 TEST ONLY - NO VALUE", "1")
    {}

    function faucet(address recipient) external returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _safeMint(recipient, tokenId);
    }

    function permit(address spender, uint256 tokenId, uint256 deadline, bytes calldata signature) external {
        if (block.timestamp > deadline) revert PermitExpired(deadline);

        address owner = ownerOf(tokenId);
        bytes32 structHash = keccak256(
            abi.encode(PERMIT_TYPEHASH, spender, tokenId, _permitNonces[tokenId], deadline)
        );
        address signer = _recoverPermitSigner(_hashTypedDataV4(structHash), signature);
        if (signer == address(0) || signer != owner) revert InvalidPermitSigner(signer, owner);

        _approve(spender, tokenId, owner);
    }

    function nonces(uint256 tokenId) external view returns (uint256) {
        ownerOf(tokenId);
        return _permitNonces[tokenId];
    }

    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == _INTERFACE_ID_ERC4494 || super.supportsInterface(interfaceId);
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address previousOwner) {
        previousOwner = super._update(to, tokenId, auth);
        if (previousOwner != address(0)) {
            unchecked {
                ++_permitNonces[tokenId];
            }
        }
    }

    function _recoverPermitSigner(bytes32 digest, bytes calldata signature) private pure returns (address) {
        if (signature.length == 65) {
            bytes32 r;
            bytes32 s;
            uint8 v;
            assembly ("memory-safe") {
                r := calldataload(signature.offset)
                s := calldataload(add(signature.offset, 0x20))
                v := byte(0, calldataload(add(signature.offset, 0x40)))
            }
            return ECDSA.recover(digest, v, r, s);
        }

        if (signature.length == 64) {
            bytes32 r;
            bytes32 vs;
            assembly ("memory-safe") {
                r := calldataload(signature.offset)
                vs := calldataload(add(signature.offset, 0x20))
            }
            return ECDSA.recover(digest, r, vs);
        }

        revert InvalidPermitSignatureLength(signature.length);
    }
}
