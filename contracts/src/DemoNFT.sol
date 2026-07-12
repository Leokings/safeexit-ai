// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Developer-created NFT used only by the local SAFEEXIT demo.
contract DemoNFT is ERC721, Ownable {
    uint256 private _nextTokenId = 1;

    constructor(address initialOwner) ERC721("SAFEEXIT Demo NFT", "SDNFT") Ownable(initialOwner) { }

    function mint(address recipient) external onlyOwner returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _safeMint(recipient, tokenId);
    }
}
