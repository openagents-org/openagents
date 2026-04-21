const { execFileSync } = require("child_process");
const path = require("path");

// Custom sign function for electron-builder using Azure Trusted Signing.
// Called automatically by electron-builder during the Windows build process.
//
// Required environment variables:
//   AZURE_TENANT_ID       - Azure AD tenant ID
//   AZURE_CLIENT_ID       - Azure AD app registration client ID
//   AZURE_CLIENT_SECRET   - Azure AD app registration client secret
//   AZURE_ENDPOINT        - Trusted Signing endpoint (e.g. https://wus.codesigning.azure.net)
//   AZURE_CODE_SIGNING_ACCOUNT - Trusted Signing account name (e.g. "openagents")
//   AZURE_CERT_PROFILE    - Certificate profile name

exports.default = async function azureSign(configuration) {
  const filePath = configuration.path;

  // Skip if not an executable/signable file
  if (!/\.(exe|dll|msi|msix|appx)$/i.test(filePath)) {
    return;
  }

  const endpoint = process.env.AZURE_ENDPOINT;
  const account = process.env.AZURE_CODE_SIGNING_ACCOUNT;
  const certProfile = process.env.AZURE_CERT_PROFILE;

  if (!endpoint || !account || !certProfile) {
    console.warn("Azure Trusted Signing env vars not set, skipping signing.");
    return;
  }

  let parsedEndpoint;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch (_err) {
    throw new Error("Invalid AZURE_ENDPOINT format.");
  }

  if (parsedEndpoint.protocol !== "https:") {
    throw new Error("AZURE_ENDPOINT must use https.");
  }

  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/.test(account)) {
    throw new Error("Invalid AZURE_CODE_SIGNING_ACCOUNT format.");
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(certProfile)) {
    throw new Error("Invalid AZURE_CERT_PROFILE format.");
  }

  if (typeof filePath !== "string" || filePath.includes("\0")) {
    throw new Error("Invalid file path for signing.");
  }

  const signTarget = path.resolve(filePath);

  console.log(`Signing: ${path.basename(filePath)}`);

  const args = [
    "trusted-signing",
    "-e", endpoint,
    "-a", account,
    "-c", certProfile,
    "-r", "http://timestamp.acs.microsoft.com",
    "-d", "sha256",
    signTarget,
  ];

  try {
    execFileSync("sign", ["code", ...args], {
      stdio: "inherit",
      timeout: 120000,
    });
  } catch (err) {
    console.error(`Failed to sign ${path.basename(filePath)}: ${err.message}`);
    throw err;
  }
};
