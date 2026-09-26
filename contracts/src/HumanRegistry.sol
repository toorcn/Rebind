// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title HumanRegistry — wallet → World subject, written only after a server check
/// @notice The registrar is the Rebind server. It writes an entry only after it has
///         verified a World ID token from the sandbox issuer
///         (https://sandbox.auth.world.org) for the human behind this wallet.
///         The stored value is keccak256(issuer + "|" + pairwiseSubject), so the
///         raw subject never touches the chain.
///
///         Two wallets with the same entry are the same human. That single fact is
///         what TwoHumansHook enforces on.
contract HumanRegistry {
    /// @notice The only address allowed to write. The server that checked the token.
    address public registrar;

    /// @notice keccak256(issuer + "|" + subject) per wallet. Zero means unproven.
    mapping(address => bytes32) public subjectOf;

    event Registered(address indexed account, bytes32 indexed subject);
    event Unregistered(address indexed account, bytes32 indexed previousSubject);
    event RegistrarChanged(address indexed previous, address indexed next);

    error OnlyRegistrar();
    error ZeroAddress();
    error ZeroSubject();

    constructor(address _registrar) {
        if (_registrar == address(0)) revert ZeroAddress();
        registrar = _registrar;
        emit RegistrarChanged(address(0), _registrar);
    }

    modifier onlyRegistrar() {
        if (msg.sender != registrar) revert OnlyRegistrar();
        _;
    }

    /// @notice Attach a verified subject to a wallet. Overwrites on re-proof.
    function register(address account, bytes32 subject) external onlyRegistrar {
        if (account == address(0)) revert ZeroAddress();
        if (subject == bytes32(0)) revert ZeroSubject();
        subjectOf[account] = subject;
        emit Registered(account, subject);
    }

    /// @notice Remove a wallet's proof (key revoked, human asked to be forgotten).
    function unregister(address account) external onlyRegistrar {
        bytes32 previous = subjectOf[account];
        delete subjectOf[account];
        emit Unregistered(account, previous);
    }

    function handover(address next) external onlyRegistrar {
        if (next == address(0)) revert ZeroAddress();
        emit RegistrarChanged(registrar, next);
        registrar = next;
    }
}
