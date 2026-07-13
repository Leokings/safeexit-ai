// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @notice Developer-created DAI-style permit token used only by SAFEEXIT tests.
contract DaiStyleRescueToken is ERC20, EIP712, Ownable {
    bytes32 public constant PERMIT_TYPEHASH = keccak256(
        "Permit(address holder,address spender,uint256 nonce,uint256 expiry,bool allowed)"
    );

    mapping(address holder => uint256 nonce) public nonces;

    error PermitExpired();
    error InvalidPermitNonce();
    error InvalidPermitSigner();

    constructor(address initialOwner)
        ERC20("SAFEEXIT DAI-style Token", "SDAI")
        EIP712("SAFEEXIT DAI-style Token", "1")
        Ownable(initialOwner)
    { }

    function mint(address recipient, uint256 amount) external onlyOwner {
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
        if (expiry != 0 && block.timestamp > expiry) revert PermitExpired();
        if (nonce != nonces[holder]) revert InvalidPermitNonce();
        bytes32 structHash = keccak256(
            abi.encode(PERMIT_TYPEHASH, holder, spender, nonce, expiry, allowed)
        );
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), v, r, s);
        if (signer == address(0) || signer != holder) revert InvalidPermitSigner();
        nonces[holder] = nonce + 1;
        _approve(holder, spender, allowed ? type(uint256).max : 0);
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
