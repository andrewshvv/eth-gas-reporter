// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract EncoderV2 {
  uint id;

  struct Asset {
    uint a;
    uint b;
    string c;
  }

  Asset a;

  function setAsset44(uint _id, Asset memory _a) public {
    id = _id;
    a = _a;
  }

  function getAsset() public view returns (Asset memory) {
    return a;
  }
}
