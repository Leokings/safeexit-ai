# Security Policy

SAFEEXIT is a best-effort defensive wallet incident-response system. Never send
it seed phrases, private keys, wallet keystores, raw credentials, or source
wallet signatures.

## Dependency advisory record

As of 2026-07-13, `npm audit` reports GHSA-qx2v-qp2m-jg93 through Next.js's
exact nested dependency on PostCSS 8.4.31. The current stable Next.js release is
16.2.10 and still pins that version; npm's automated fix incorrectly proposes a
breaking downgrade to Next.js 9.3.3.

The advisory concerns stringifying attacker-controlled CSS containing a closing
style tag. SAFEEXIT does not accept, generate, or stringify user-provided CSS;
PostCSS is used during the trusted application build and is not an API input.
The deployment also applies a restrictive content security policy.

Do not run `npm audit fix --force` for this finding. Upgrade Next.js as soon as a
stable release depends on PostCSS 8.5.10 or newer, then remove this temporary
risk acceptance after CI and browser verification.

Report suspected vulnerabilities privately to the repository owner. Do not
test rescue execution against wallets or assets you do not control.
