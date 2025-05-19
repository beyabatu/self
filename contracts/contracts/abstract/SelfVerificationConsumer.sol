// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SelfVerificationRoot} from "./SelfVerificationRoot.sol";
import {CircuitConstants} from "../constants/CircuitConstants.sol";
import {IVcAndDiscloseCircuitVerifier} from "../interfaces/IVcAndDiscloseCircuitVerifier.sol";

/**
 * @title SelfVerificationConsumer
 * @notice Abstract consumer contract for self verification that developers can inherit
 * @dev Extends SelfVerificationRoot and implements additional verification logic including nullifier tracking
 */
abstract contract SelfVerificationConsumer is SelfVerificationRoot {
    // ====================================================
    // Storage Variables
    // ====================================================

    /// @notice Mapping to track used nullifiers
    mapping(uint256 nullifier => bool used) internal _nullifiers;

    // ====================================================
    // Events
    // ====================================================

    /// @notice Event emitted when a verification is successful
    event VerificationSuccess(uint256 nullifier);

    // ====================================================
    // Errors
    // ====================================================

    /// @notice Error thrown when a nullifier has already been used
    error RegisteredNullifier();

    /// @notice Error thrown when a nullifier check fails
    error NullifierCheckFailed();

    /**
     * @notice Initializes the SelfVerificationConsumer contract
     * @param identityVerificationHub The address of the Identity Verification Hub
     * @param scope The expected proof scope for user registration
     * @param attestationId The expected attestation identifier required in proofs
     * @param olderThanEnabled Flag indicating if 'olderThan' verification is enabled
     * @param olderThan Value for 'olderThan' verification
     * @param forbiddenCountriesEnabled Flag indicating if forbidden countries verification is enabled
     * @param forbiddenCountriesListPacked Packed list of forbidden countries
     * @param ofacEnabled Array of flags indicating which OFAC checks are enabled
     */
    constructor(
        address identityVerificationHub,
        uint256 scope,
        uint256 attestationId,
        bool olderThanEnabled,
        uint256 olderThan,
        bool forbiddenCountriesEnabled,
        uint256[4] memory forbiddenCountriesListPacked,
        bool[3] memory ofacEnabled
    ) SelfVerificationRoot(
        identityVerificationHub,
        scope,
        attestationId,
        olderThanEnabled,
        olderThan,
        forbiddenCountriesEnabled,
        forbiddenCountriesListPacked,
        ofacEnabled
    ) {}

    /**
     * @notice Verifies a self-proof and processes the result
     * @dev Checks nullifier using validateNullifier and updateNullifier, then calls parent verification and invokes onVerificationSuccess hook
     * @param proof The proof data for verification and disclosure
     */
    function verifySelfProof(
        IVcAndDiscloseCircuitVerifier.VcAndDiscloseProof memory proof
    )
        public
        override
    { 
        uint256 nullifier = proof.pubSignals[CircuitConstants.VC_AND_DISCLOSE_NULLIFIER_INDEX];
        
        // Nullifier validation - can be customized by overriding validateNullifier
        if (!validateNullifier(nullifier, proof)) {
            revert NullifierCheckFailed();
        }
        
        // Scope and attestation ID validation handled in parent
        super.verifySelfProof(proof);

        // Update nullifier state - can be customized by overriding updateNullifier
        updateNullifier(nullifier, proof);
        
        // Call hook and emit event
        onVerificationSuccess(proof);
        emit VerificationSuccess(nullifier);
    }

    /**
     * @notice Validates if a nullifier can be used
     * @dev Virtual function that can be overridden to implement custom nullifier validation logic
     * @param nullifier The nullifier to validate
     * @param proof The complete proof data (can be used for context-specific validation)
     * @return valid True if the nullifier is valid to use, false otherwise
     */
    function validateNullifier(
        uint256 nullifier, 
        IVcAndDiscloseCircuitVerifier.VcAndDiscloseProof memory proof
    ) 
        internal 
        virtual 
        returns (bool) 
    {
        // Default implementation: strict one-time-use policy
        return !_nullifiers[nullifier];
    }

    /**
     * @notice Updates the state for a nullifier after successful verification
     * @dev Virtual function that can be overridden to implement custom nullifier state updates
     * @param nullifier The nullifier to update
     * @param proof The complete proof data (can be used for context-specific updates)
     */
    function updateNullifier(
        uint256 nullifier, 
        IVcAndDiscloseCircuitVerifier.VcAndDiscloseProof memory proof
    ) 
        internal 
        virtual 
    {
        // Default implementation: mark nullifier as used (one-time-use)
        _nullifiers[nullifier] = true;
    }

    /**
     * @notice Hook called after successful verification
     * @dev Virtual function to be overridden by derived contracts for custom business logic
     * @param proof The proof data that was verified
     */
    function onVerificationSuccess(IVcAndDiscloseCircuitVerifier.VcAndDiscloseProof memory proof) internal virtual;
}
