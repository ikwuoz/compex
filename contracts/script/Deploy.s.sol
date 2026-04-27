// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import "../src/CompexOracle.sol";
import "../src/OfframpArbiter.sol";

contract Deploy is Script {
    function run() external {
        vm.startBroadcast();

        // Oracle contract owns the arbiter — rotate signers here without redeploying arbiter
        CompexOracle oracle = new CompexOracle(msg.sender);
        OfframpArbiter arbiter = new OfframpArbiter(address(oracle));

        vm.stopBroadcast();

        console.log("Oracle:  ", address(oracle));
        console.log("Arbiter: ", address(arbiter));
    }
}
