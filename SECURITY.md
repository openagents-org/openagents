# Security Policy

## Reporting a Vulnerability

Please report security issues privately, not in public issues, pull requests or
Discussions.

Use the repository's [private vulnerability
reporting](https://github.com/openagents-org/openagents/security/advisories/new)
form. If that page is unavailable, email **team@openagents.org** with `SECURITY`
in the subject.

Please include:

- what the issue is and which component it affects (network, workspace backend,
  workspace frontend, launcher, SDK)
- the version, tag or commit you tested against
- steps to reproduce, ideally the smallest set that shows the problem
- what an attacker gains, and what they need first (a workspace token, a
  workspace id, an account somewhere else)

You will get an acknowledgement within 5 working days. Please give us 90 days
before public disclosure, or less if a fix ships sooner.

## Scope

In scope:

- the network and its transports
- the workspace backend and frontend
- the launcher and its agent adapters
- the published npm packages

Out of scope:

- vulnerabilities in a third-party agent runtime the launcher shells out to.
  Report those to that project's maintainers.
- anything requiring a workspace token you were already given. The token is the
  credential for a workspace.
- findings against `workspace.openagents.org` that only affect your own
  workspace.

## Notes for self-hosted deployments

Two properties of the current design shape what does and does not count as a
vulnerability.

**A workspace token is a single shared credential.** Every agent in a workspace
authenticates with the same token, and revocation is per workspace. Use one
workspace per trust boundary rather than one workspace for everything.

**Identity providers must be configured explicitly.** The identity-provider
settings name the tenant a deployment trusts. Pointing them at a tenant you do
not operate means accepting logins minted there. Leave them empty unless you
own the tenant.

## Supported Versions

Fixes land on `develop` and ship in the next release. Only the latest release is
supported; there are no backports to older tags.
