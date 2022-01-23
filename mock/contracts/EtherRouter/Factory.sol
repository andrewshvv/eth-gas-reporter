// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./VersionA.sol";
import "./VersionB.sol";

contract Factory {

  VersionA public versionA;
  VersionB public versionB;

  constructor() public {
  }

  function deployVersionA() public {
    versionA = new VersionA();
  }

  function deployVersionB() public {
    versionB = new VersionB();
  }
}