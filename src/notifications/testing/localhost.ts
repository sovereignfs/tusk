/**
 * A throwaway certificate and key for `127.0.0.1` and `localhost`, made for the tests' stand-in push service alone (`openssl req -x509 -newkey ec -days 36500`): the library
 * that sends Web Push only speaks https, and a test that runs a push service of its own has to be one. It protects nothing and is trusted by nothing but the agent the
 * test builds with it.
 */
export const LOCALHOST_KEY = `-----BEGIN PRIVATE KEY-----
MIIBeQIBADCCAQMGByqGSM49AgEwgfcCAQEwLAYHKoZIzj0BAQIhAP////8AAAAB
AAAAAAAAAAAAAAAA////////////////MFsEIP////8AAAABAAAAAAAAAAAAAAAA
///////////////8BCBaxjXYqjqT57PrvVV2mIa8ZR0GsMxTsPY7zjw+J9JgSwMV
AMSdNgiG5wSTamZ44ROdJreBn36QBEEEaxfR8uEsQkf4vOblY6RA8ncDfYEt6zOg
9KE5RdiYwpZP40Li/hp/m47n60p8D54WK84zV2sxXs7LtkBoN79R9QIhAP////8A
AAAA//////////+85vqtpxeehPO5ysL8YyVRAgEBBG0wawIBAQQgKu4D2RNvMkcO
s3x3+6RytQ2dxKp5ChBu71XPqet/uHShRANCAATpmitx4v05Fe4rFx4E9FQL7Enw
QducmTbHgD7ac1DbreqCbQi1eCFy2GxV5qfGHh3d5HhaZS9ggNjzKbDCnkIP
-----END PRIVATE KEY-----
`;
export const LOCALHOST_CERT = `-----BEGIN CERTIFICATE-----
MIICMjCCAdmgAwIBAgIJAN6G/b/ubd71MAoGCCqGSM49BAMCMBQxEjAQBgNVBAMM
CTEyNy4wLjAuMTAgFw0yNjExMDgwMzE0MjBaGA8yMTI2MTAxNTAzMTQyMFowFDES
MBAGA1UEAwwJMTI3LjAuMC4xMIIBSzCCAQMGByqGSM49AgEwgfcCAQEwLAYHKoZI
zj0BAQIhAP////8AAAABAAAAAAAAAAAAAAAA////////////////MFsEIP////8A
AAABAAAAAAAAAAAAAAAA///////////////8BCBaxjXYqjqT57PrvVV2mIa8ZR0G
sMxTsPY7zjw+J9JgSwMVAMSdNgiG5wSTamZ44ROdJreBn36QBEEEaxfR8uEsQkf4
vOblY6RA8ncDfYEt6zOg9KE5RdiYwpZP40Li/hp/m47n60p8D54WK84zV2sxXs7L
tkBoN79R9QIhAP////8AAAAA//////////+85vqtpxeehPO5ysL8YyVRAgEBA0IA
BOmaK3Hi/TkV7isXHgT0VAvsSfBB25yZNseAPtpzUNut6oJtCLV4IXLYbFXmp8Ye
Hd3keFplL2CA2PMpsMKeQg+jHjAcMBoGA1UdEQQTMBGHBH8AAAGCCWxvY2FsaG9z
dDAKBggqhkjOPQQDAgNHADBEAiA7CmHAXmbNlJ4DOmhPPGsSgDhKPCYFbknx00f6
hTIycwIgGy/BMGDY0pfxpvdkwc9kwRXDv01DUpSZDw3mCn2SCkE=
-----END CERTIFICATE-----
`;
