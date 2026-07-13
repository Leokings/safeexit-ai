// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @notice Developer-created NFT used only by the local SAFEEXIT demo.
contract DemoNFT is ERC721, EIP712, Ownable {
    bytes4 private constant _INTERFACE_ID_ERC4494 = 0x5604e225;
    bytes32 private constant _PERMIT_TYPEHASH = keccak256(
        "Permit(address spender,uint256 tokenId,uint256 nonce,uint256 deadline)"
    );

    uint256 private _nextTokenId = 1;
    mapping(uint256 tokenId => uint256 nonce) private _nonces;

    error PermitExpired();
    error InvalidPermitSigner();

    constructor(address initialOwner)
        ERC721("SAFEEXIT Demo NFT", "SDNFT")
        EIP712("SAFEEXIT Demo NFT", "1")
        Ownable(initialOwner)
    { }

    function mint(address recipient) external onlyOwner returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _safeMint(recipient, tokenId);
    }

    function permit(address spender, uint256 tokenId, uint256 deadline, bytes calldata signature)
        external
    {
        if (block.timestamp > deadline) revert PermitExpired();
        address owner = ownerOf(tokenId);
        bytes32 structHash = keccak256(
            abi.encode(_PERMIT_TYPEHASH, spender, tokenId, _nonces[tokenId], deadline)
        );
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        if (signer == address(0) || signer != owner) revert InvalidPermitSigner();
        _approve(spender, tokenId, owner);
    }

    function nonces(uint256 tokenId) external view returns (uint256) {
        return _nonces[tokenId];
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == _INTERFACE_ID_ERC4494 || super.supportsInterface(interfaceId);
    }

    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address previousOwner)
    {
        previousOwner = super._update(to, tokenId, auth);
        if (previousOwner != address(0)) {
            _nonces[tokenId] += 1;
        }
    }
}
