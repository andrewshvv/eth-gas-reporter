// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./ConvertLib.sol";

contract Undeployed {
    event Amount(uint val);

    function f() public {
      uint a = ConvertLib.convert(5,5);
      emit Amount(a);
    }
}