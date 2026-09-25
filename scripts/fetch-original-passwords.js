const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

async function main() {
  const statePath = path.join(os.homedir(), ".expo", "state.json");
  if (!fs.existsSync(statePath)) {
    console.error("Expo state.json not found at " + statePath);
    process.exit(1);
  }
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const sessionSecret = state.auth?.sessionSecret;
  if (!sessionSecret) {
    console.error("No active session found in ~/.expo/state.json. Please run eas login first.");
    process.exit(1);
  }

  const { createGraphqlClient } = require("/usr/local/lib/node_modules/eas-cli/build/commandUtils/context/contextUtils/createGraphqlClient");
  const { withErrorHandlingAsync } = require("/usr/local/lib/node_modules/eas-cli/build/graphql/client");
  const gql = require("/usr/local/lib/node_modules/eas-cli/node_modules/graphql-tag");

  const client = createGraphqlClient({ sessionSecret });

  try {
    const res = await withErrorHandlingAsync(client.query(gql`
      query {
        app {
          byId(appId: "5bbb3050-c514-4ce8-88f4-655a9cec68ba") {
            androidAppCredentials {
              applicationIdentifier
              androidAppBuildCredentialsList {
                androidKeystore {
                  keyAlias
                  keystorePassword
                  keyPassword
                }
              }
            }
          }
        }
      }
    `).toPromise());

    let ownerFound = false;
    let managerFound = false;

    for (const ac of res.app.byId.androidAppCredentials) {
      for (const bc of ac.androidAppBuildCredentialsList) {
        const ks = bc.androidKeystore;
        if (ac.applicationIdentifier === "com.riajulshakib.rongdhonu.owner") {
          const ownerCreds = {
            android: {
              keystore: {
                keystorePath: "credentials/android/owner_keystore.jks",
                keystorePassword: ks.keystorePassword,
                keyAlias: ks.keyAlias,
                keyPassword: ks.keyPassword || ks.keystorePassword
              }
            }
          };
          fs.writeFileSync(path.resolve(__dirname, "../credentials/android/credentials.owner.json"), JSON.stringify(ownerCreds, null, 2), "utf8");
          ownerFound = true;
        }
        if (ac.applicationIdentifier === "com.riajulshakib.rongdhonu.manager") {
          const managerCreds = {
            android: {
              keystore: {
                keystorePath: "credentials/android/manager_keystore.jks",
                keystorePassword: ks.keystorePassword,
                keyAlias: ks.keyAlias,
                keyPassword: ks.keyPassword || ks.keystorePassword
              }
            }
          };
          fs.writeFileSync(path.resolve(__dirname, "../credentials/android/credentials.manager.json"), JSON.stringify(managerCreds, null, 2), "utf8");
          managerFound = true;
        }
      }
    }

    if (ownerFound && managerFound) {
      console.log("[SUCCESS] Successfully configured credentials.owner.json and credentials.manager.json!");
    } else {
      console.warn("Partial credentials found: Owner=" + ownerFound + ", Manager=" + managerFound);
    }
  } catch (err) {
    console.error("Error fetching credentials from EAS project 5bbb3050-c514-4ce8-88f4-655a9cec68ba:", err.message);
  }
}

main();
