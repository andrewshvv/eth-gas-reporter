// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./VariableCosts.sol";

contract VariableConstructor is VariableCosts {
  string name;
  constructor(string memory _name) public {
    name = _name;
  }
}