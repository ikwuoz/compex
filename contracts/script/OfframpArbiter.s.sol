// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script} from "forge-std/Script.sol";
import {OfframpArbiter} from "../src/OfframpArbiter.sol";

contract OfframpArbiterScript is Script {
    OfframpArbiter public arbiter;
    address internal constant COMPACT = 0x00000000000000171ede64904551eeDF3C6C9788;

    function setUp() public {}

    function run() public {
        vm.startBroadcast();

        arbiter = new OfframpArbiter(msg.sender, COMPACT);

        vm.stopBroadcast();
    }
}
