import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { RegisterVerifierId, DscVerifierId, PASSPORT_ATTESTATION_ID, ID_CARD_ATTESTATION_ID } from "../../common/src/constants/constants";

dotenv.config();

// Define AttestationId using the values from constants.ts
const AttestationId = {
    E_PASSPORT: `0x${new ethers.AbiCoder().encode(['uint256'], [PASSPORT_ATTESTATION_ID]).substring(2).padStart(64, '0')}`,
    EU_ID_CARD: `0x${new ethers.AbiCoder().encode(['uint256'], [ID_CARD_ATTESTATION_ID]).substring(2).padStart(64, '0')}`
} as const;

// Debug logs for paths and files
console.log("Current directory:", __dirname);
console.log("Deployed addresses path:", path.join(__dirname, "../ignition/deployments/chain-42220/deployed_addresses.json"));

// Debug logs for environment variables (redacted for security)
console.log("CELO_RPC_URL configured:", !!process.env.CELO_RPC_URL);
console.log("CELO_KEY configured:", !!process.env.CELO_KEY);
console.log("Using AttestationId values:");
console.log("E_PASSPORT:", AttestationId.E_PASSPORT);
console.log("EU_ID_CARD:", AttestationId.EU_ID_CARD);

// Get command line arguments
const args = process.argv.slice(2);
const version = args[0] || "v1"; // Default to v1 if not specified
console.log(`Using version: ${version}`);

try {
    const deployedAddresses = JSON.parse(fs.readFileSync(path.join(__dirname, "../ignition/deployments/chain-42220/deployed_addresses.json"), "utf-8"));
    console.log("Deployed addresses loaded:", deployedAddresses);

    // Load the appropriate ABI based on version
    let identityVerificationHubAbi: any;
    if (version.toLowerCase() === "v1") {
        const identityVerificationHubAbiFile = fs.readFileSync(path.join(__dirname, "../ignition/deployments/prod/artifacts/DeployHub#IdentityVerificationHubImplV1.json"), "utf-8");
        identityVerificationHubAbi = JSON.parse(identityVerificationHubAbiFile).abi;
    } else if (version.toLowerCase() === "v2") {
        const identityVerificationHubAbiFile = fs.readFileSync(path.join(__dirname, "../ignition/deployments/prod/artifacts/DeployV2#IdentityVerificationHubImplV2.json"), "utf-8");
        identityVerificationHubAbi = JSON.parse(identityVerificationHubAbiFile).abi;
    } else {
        throw new Error(`Unsupported version: ${version}`);
    }
    console.log("ABI loaded and parsed");

    function getContractAddressByPartialName(partialName: string): string | undefined {
        for (const [key, value] of Object.entries(deployedAddresses)) {
            if (key.includes(partialName)) {
                return value as string;
            }
        }
        return undefined;
    }

    async function main() {
        const provider = new ethers.JsonRpcProvider(process.env.CELO_RPC_URL as string);
        console.log("Provider created");

        const wallet = new ethers.Wallet(process.env.CELO_KEY as string, provider);
        console.log("Wallet created");

        // Determine hub address based on version
        let hubAddress: string | undefined;
        if (version.toLowerCase() === "v1") {
            hubAddress = deployedAddresses["DeployHub#IdentityVerificationHub"];
        } else {
            hubAddress = deployedAddresses["DeployV2#IdentityVerificationHub"];
        }

        // If not found in deployed_addresses.json, use hardcoded address
        if (!hubAddress) {
            hubAddress = "0x77117D60eaB7C044e785D68edB6C7E0e134970Ea"; // Default if not found
            console.log("Hub address not found in deployed_addresses.json, using hardcoded address");
        }
        console.log("Hub address:", hubAddress);

        const identityVerificationHub = new ethers.Contract(
            hubAddress,
            identityVerificationHubAbi,
            wallet
        );
        console.log("Contract instance created");

        // Handle V2-specific setup if needed
        if (version.toLowerCase() === "v2") {
            await setupV2Registries(identityVerificationHub);
        }

        // Debug verifier addresses before updating
        const registerVerifierKeys = Object.keys(RegisterVerifierId).filter(key => isNaN(Number(key)));
        for (const key of registerVerifierKeys) {
            const verifierName = `Verifier_${key}`;
            const verifierAddress = getContractAddressByPartialName(verifierName);
            console.log(`${verifierName} address:`, verifierAddress);
        }

        // Update register circuit verifiers
        for (const key of registerVerifierKeys) {
            const verifierName = `Verifier_${key}`;
            const verifierAddress = getContractAddressByPartialName(verifierName);
            if (!verifierAddress) {
                console.log(`Skipping ${verifierName} because no deployed address was found.`);
                continue;
            }
            console.log(`Updating for ${verifierName}`);
            const verifierId = RegisterVerifierId[key as keyof typeof RegisterVerifierId];

            try {
                // For V2, we need to specify the attestation ID for some functions
                if (version.toLowerCase() === "v2") {
                    await updateV2RegisterVerifier(identityVerificationHub, verifierId, verifierAddress);
                } else {
                    const tx = await identityVerificationHub.updateRegisterCircuitVerifier(
                        verifierId,
                        verifierAddress
                    );
                    const receipt = await tx.wait();
                    console.log(`${verifierName} is updated with tx: ${receipt.hash}`);
                }
            } catch (error) {
                console.error(`Error updating ${verifierName}:`, error);
            }
        }

        // Update DSC verifiers
        const dscKeys = Object.keys(DscVerifierId).filter(key => isNaN(Number(key)));
        for (const key of dscKeys) {
            const verifierName = `Verifier_${key}`;
            const verifierAddress = getContractAddressByPartialName(verifierName);
            if (!verifierAddress) {
                console.log(`Skipping ${verifierName} because no deployed address was found.`);
                continue;
            }
            const verifierId = DscVerifierId[key as keyof typeof DscVerifierId];

            try {
                if (version.toLowerCase() === "v2") {
                    await updateV2DscVerifier(identityVerificationHub, verifierId, verifierAddress);
                } else {
                    const tx = await identityVerificationHub.updateDscVerifier(
                        verifierId,
                        verifierAddress
                    );
                    const receipt = await tx.wait();
                    console.log(`${verifierName} is updated with tx: ${receipt.hash}`);
                }
            } catch (error) {
                console.error(`Error updating ${verifierName}:`, error);
            }
        }
    }

    async function setupV2Registries(contract: ethers.Contract) {
        console.log("Setting up V2 registries and verifiers");

        // Get registry and verifier addresses for each attestation type
        const ePassportRegistry = getContractAddressByPartialName("IdentityRegistry");
        const euIdCardRegistry = getContractAddressByPartialName("IdCardRegistry"); // Assuming this naming convention

        const vcAndDiscloseVerifierEPassport = getContractAddressByPartialName("Verifier_vc_and_disclose");
        const vcAndDiscloseVerifierEuIdCard = getContractAddressByPartialName("Verifier_vc_and_disclose_idcard"); // Assuming this naming convention

        // Update registries for different attestation types
        if (ePassportRegistry) {
            console.log(`Setting E_PASSPORT registry to ${ePassportRegistry}`);
            try {
                const tx = await contract.updateRegistry(
                    AttestationId.E_PASSPORT,
                    ePassportRegistry
                );
                const receipt = await tx.wait();
                console.log(`E_PASSPORT registry updated with tx: ${receipt.hash}`);
            } catch (error) {
                console.error("Error updating E_PASSPORT registry:", error);
            }
        }

        if (euIdCardRegistry) {
            console.log(`Setting EU_ID_CARD registry to ${euIdCardRegistry}`);
            try {
                const tx = await contract.updateRegistry(
                    AttestationId.EU_ID_CARD,
                    euIdCardRegistry
                );
                const receipt = await tx.wait();
                console.log(`EU_ID_CARD registry updated with tx: ${receipt.hash}`);
            } catch (error) {
                console.error("Error updating EU_ID_CARD registry:", error);
            }
        }

        // Update VC and Disclose verifiers for different attestation types
        if (vcAndDiscloseVerifierEPassport) {
            console.log(`Setting E_PASSPORT VC and Disclose verifier to ${vcAndDiscloseVerifierEPassport}`);
            try {
                const tx = await contract.updateVcAndDiscloseCircuit(
                    AttestationId.E_PASSPORT,
                    vcAndDiscloseVerifierEPassport
                );
                const receipt = await tx.wait();
                console.log(`E_PASSPORT VC and Disclose verifier updated with tx: ${receipt.hash}`);
            } catch (error) {
                console.error("Error updating E_PASSPORT VC and Disclose verifier:", error);
            }
        }

        if (vcAndDiscloseVerifierEuIdCard) {
            console.log(`Setting EU_ID_CARD VC and Disclose verifier to ${vcAndDiscloseVerifierEuIdCard}`);
            try {
                const tx = await contract.updateVcAndDiscloseCircuit(
                    AttestationId.EU_ID_CARD,
                    vcAndDiscloseVerifierEuIdCard
                );
                const receipt = await tx.wait();
                console.log(`EU_ID_CARD VC and Disclose verifier updated with tx: ${receipt.hash}`);
            } catch (error) {
                console.error("Error updating EU_ID_CARD VC and Disclose verifier:", error);
            }
        }
    }

    async function updateV2RegisterVerifier(contract: ethers.Contract, verifierId: number, verifierAddress: string) {
        // Same method as V1, as the function signature remained the same
        const tx = await contract.updateRegisterCircuitVerifier(
            verifierId,
            verifierAddress
        );
        const receipt = await tx.wait();
        console.log(`Register circuit verifier ${verifierId} updated with tx: ${receipt.hash}`);
        return receipt;
    }

    async function updateV2DscVerifier(contract: ethers.Contract, verifierId: number, verifierAddress: string) {
        // Same method as V1, as the function signature remained the same
        const tx = await contract.updateDscVerifier(
            verifierId,
            verifierAddress
        );
        const receipt = await tx.wait();
        console.log(`DSC verifier ${verifierId} updated with tx: ${receipt.hash}`);
        return receipt;
    }

    main().catch((error) => {
        console.error("Execution error:", error);
        process.exitCode = 1;
    });

} catch (error) {
    console.error("Initial setup error:", error);
    process.exitCode = 1;
}
