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

    /// @notice Release funds to recipients after successful inference.
    /// Uses live contract balance so native CryptoTransfers (x402) are covered
    /// even when receive() was not invoked.
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
        
        uint256 bal = address(this).balance;
        require(bal >= sum, "insufficient escrow");

        // Prefer depleting per-request lock first, then pool, then remainder of balance
        uint256 fromLocked = locked[requestId];
        if (fromLocked > sum) {
            fromLocked = sum;
        }
        if (fromLocked > 0) {
            locked[requestId] -= fromLocked;
        }
        uint256 remaining = sum - fromLocked;
        if (remaining > 0) {
            if (poolBalance >= remaining) {
                poolBalance -= remaining;
            } else {
                poolBalance = 0;
            }
        }
        
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
