// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {SafeExit7702RescueDelegate} from "./SafeExit7702RescueDelegate.sol";

/**
 * @notice Permissionless deterministic deployment for incident-bound delegates.
 * @dev No owner, upgrade path, fee receiver, or custody role exists.
 */
contract SafeExit7702RescueDelegateFactory {
    error DeploymentAddressMismatch(address actual, address expected);

    event RescueDelegateDeployed(
        address indexed delegate,
        address indexed source,
        address indexed destination,
        bytes32 planHash,
        bytes32 rescueNonce,
        uint256 deadline,
        uint256 chainId
    );

    function deployDelegate(
        address source,
        address destination,
        uint256 deadline,
        bytes32 planHash,
        bytes32 rescueNonce
    ) external returns (address delegate) {
        address expected = predictDelegate(
            source,
            destination,
            deadline,
            planHash,
            rescueNonce
        );
        if (expected.code.length != 0) return expected;

        delegate = address(
            new SafeExit7702RescueDelegate{salt: _salt(
                source,
                destination,
                deadline,
                planHash,
                rescueNonce
            )}(
                block.chainid,
                source,
                destination,
                deadline,
                planHash,
                rescueNonce
            )
        );
        if (delegate != expected) revert DeploymentAddressMismatch(delegate, expected);

        emit RescueDelegateDeployed(
            delegate,
            source,
            destination,
            planHash,
            rescueNonce,
            deadline,
            block.chainid
        );
    }

    function predictDelegate(
        address source,
        address destination,
        uint256 deadline,
        bytes32 planHash,
        bytes32 rescueNonce
    ) public view returns (address) {
        return Create2.computeAddress(
            _salt(source, destination, deadline, planHash, rescueNonce),
            keccak256(
                abi.encodePacked(
                    type(SafeExit7702RescueDelegate).creationCode,
                    abi.encode(
                        block.chainid,
                        source,
                        destination,
                        deadline,
                        planHash,
                        rescueNonce
                    )
                )
            ),
            address(this)
        );
    }

    function _salt(
        address source,
        address destination,
        uint256 deadline,
        bytes32 planHash,
        bytes32 rescueNonce
    ) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                "safeexit.eip7702.delegate.v1",
                block.chainid,
                source,
                destination,
                deadline,
                planHash,
                rescueNonce
            )
        );
    }
}
