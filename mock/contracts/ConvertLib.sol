// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

library ConvertLib{
	function convert(uint amount,uint conversionRate) pure public returns (uint convertedAmount)
	{
		return amount * conversionRate;
	}
}
