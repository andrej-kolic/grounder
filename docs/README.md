# Grounder docs

Start at the [README](../README.md) for what Grounder is and how to get running. These
pages are the reference material behind it.

## Using Grounder

- [CLI reference](cli-reference.md) — every command and flag, plus `status` vs `doctor`
- [Configuration](configuration.md) — machine config, `.grounder.json`, env vars, agent adapters
- [Upgrading](upgrading.md) — `grounder migrate` and the shared runtime
- [Session-start hooks](session-hooks.md) — the opt-in saved-session reminder
- [Troubleshooting](troubleshooting.md) — symptom → fix

## Design notes (contributors)

Not user how-tos — these explain why the internals look the way they do.

- [Schema versioning and install migration](architecture/schema-versioning.md) — `state.json`, hash drift, `grounder migrate`, forward-compat
- [Runtime invocation](architecture/runtime-invocation.md) — baked Node + `~/.grounder/runtime`, doctor dangling-interpreter check
- [Vault search](architecture/vault-search.md) — how `grounder search` scans and ranks
