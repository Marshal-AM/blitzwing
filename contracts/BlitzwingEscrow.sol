// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Blitzwing inference escrow on Hedera EVM.
 * x402 settles HBAR to this contract; operator releases to contributors after valid inference.
 */
contract BlitzwingEscrow {
    address public operator;
    mapping(bytes32 => uint256) public locked;

    event Deposited(bytes32 indexed requestId, address indexed payer, uint256 amount);
    event Released(bytes32 indexed requestId, uint256 total);
    event Refunded(bytes32 indexed requestId, address indexed payer, uint256 amount);

    constructor(address _operator) {
        require(_operator != address(0), "operator required");
        operator = _operator;
    }

    receive() external payable {}

    function deposit(bytes32 requestId) external payable {
        require(msg.value > 0, "amount required");
        locked[requestId] += msg.value;
        emit Deposited(requestId, msg.sender, msg.value);
    }

    function release(
        bytes32 requestId,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external {
        require(msg.sender == operator, "only operator");
        require(recipients.length == amounts.length, "length mismatch");
        uint256 total = locked[requestId];
        require(total > 0, "no escrow");
        uint256 sum;
        for (uint256 i = 0; i < amounts.length; i++) {
            sum += amounts[i];
            (bool ok, ) = recipients[i].call{value: amounts[i]}("");
            require(ok, "transfer failed");
        }
        require(sum <= total, "over-release");
        locked[requestId] = total - sum;
        emit Released(requestId, sum);
    }

    function refund(bytes32 requestId, address payable payer) external {
        require(msg.sender == operator, "only operator");
        uint256 amount = locked[requestId];
        require(amount > 0, "no escrow");
        locked[requestId] = 0;
        (bool ok, ) = payer.call{value: amount}("");
        require(ok, "refund failed");
        emit Refunded(requestId, payer, amount);
    }
}
