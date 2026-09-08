// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Blitzwing inference escrow on Hedera EVM.
 * x402 settles HBAR to this contract; operator releases to contributors after valid inference.
 * 
 * Pool-based model: x402 payments arrive without requestId, so we track total pool balance.
 * Operator calls release() after successful inference to pay contributors atomically.
 */
contract BlitzwingEscrow {
    address public operator;
    
    // Total HBAR held for distribution (separate from locked per-request)
    uint256 public poolBalance;
    
    // Per-request tracking for refunds (optional deposit mode)
    mapping(bytes32 => uint256) public locked;

    event Deposited(bytes32 indexed requestId, address indexed payer, uint256 amount);
    event PoolDeposit(address indexed payer, uint256 amount);
    event Released(bytes32 indexed requestId, uint256 total, address[] recipients);
    event Refunded(bytes32 indexed requestId, address indexed payer, uint256 amount);

    constructor(address _operator) {
        require(_operator != address(0), "operator required");
        operator = _operator;
    }

    /// @notice Accept plain HBAR transfers from x402 (adds to pool)
    receive() external payable {
        poolBalance += msg.value;
        emit PoolDeposit(msg.sender, msg.value);
    }

    /// @notice Explicit deposit with requestId (for refund tracking)
    function deposit(bytes32 requestId) external payable {
        require(msg.value > 0, "amount required");
        locked[requestId] += msg.value;
        emit Deposited(requestId, msg.sender, msg.value);
    }

    /// @notice Release funds to recipients after successful inference
    /// @dev Takes from pool first, then from locked[requestId] if available
    function release(
        bytes32 requestId,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external {
        require(msg.sender == operator, "only operator");
        require(recipients.length == amounts.length, "length mismatch");
        
        uint256 sum;
        for (uint256 i = 0; i < amounts.length; i++) {
            sum += amounts[i];
        }
        
        // Take from pool first
        uint256 fromPool = sum <= poolBalance ? sum : poolBalance;
        uint256 fromLocked = sum - fromPool;
        
        if (fromPool > 0) {
            poolBalance -= fromPool;
        }
        if (fromLocked > 0) {
            require(locked[requestId] >= fromLocked, "insufficient escrow");
            locked[requestId] -= fromLocked;
        }
        
        // Transfer to all recipients
        for (uint256 i = 0; i < recipients.length; i++) {
            (bool ok, ) = recipients[i].call{value: amounts[i]}("");
            require(ok, "transfer failed");
        }
        
        emit Released(requestId, sum, recipients);
    }

    /// @notice Refund locked funds for a specific request
    function refund(bytes32 requestId, address payable payer) external {
        require(msg.sender == operator, "only operator");
        uint256 amount = locked[requestId];
        require(amount > 0, "no escrow");
        locked[requestId] = 0;
        (bool ok, ) = payer.call{value: amount}("");
        require(ok, "refund failed");
        emit Refunded(requestId, payer, amount);
    }
    
    /// @notice Get total available balance (pool + all locked)
    function totalBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
