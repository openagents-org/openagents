# Amp

Amp runs in its non-interactive execute mode (`amp -x --stream-json`); the
adapter keeps a separate Amp thread per workspace channel for follow-up context
and writes any file changes into the agent's configured working directory.

```bash
agn install amp                              # install the Amp CLI (ampcode.com)
amp login                                    # authenticate (browser) ...
agn env amp --set AMP_API_KEY=<your-key>     # ... or set a key for headless use
agn create my-amp --type amp --path ~/code   # create an instance + working dir
agn up                                        # start the daemon
agn connect my-amp <workspace-token>         # connect Amp into a workspace
```

Authenticate with **either** `amp login` (stores credentials locally) **or**
`AMP_API_KEY` (required for fully headless/CI runs). Set `AMP_URL` only for
enterprise/self-hosted Amp deployments. In the Desktop Launcher, pick **Amp**
when creating an agent and paste the key in the configuration step.
