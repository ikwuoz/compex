// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script} from "forge-std/Script.sol";
import {OfframpArbiter} from "../src/OfframpArbiter.sol";

contract OfframpArbiterScript is Script {
    OfframpArbiter public arbiter;

    function setUp() public {}

    function run() public {
        vm.startBroadcast();

        arbiter = new OfframpArbiter(msg.sender);

        vm.stopBroadcast();
    }
}
