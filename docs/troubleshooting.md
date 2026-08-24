# Troubleshooting

Two read-only commands cover most of it: `grounder status` shows what's wired,
`grounder doctor` says what's broken and how to fix it. See
[Status vs doctor](cli-reference.md#status-vs-doctor).

| Symptom                                                                                | Try                                                                                                                                                  |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Not sure if this folder is linked                                                      | `grounder status` — check Project `Linked:` and paths                                                                                                |
| Notes / handoffs / plans fail or slash commands missing                                | `grounder doctor` — follow fix hints                                                                                                                 |
| Machine setup only (no project yet)                                                    | `grounder doctor --global`                                                                                                                           |
| Home config / vault missing                                                            | `grounder setup <path>`                                                                                                                              |
| No `.grounder.json` / notes / logs / plans dirs                                        | `grounder link`                                                                                                                                      |
| Agent slash commands drifted (`doctor` warns)                                          | Follow the hint: plain `grounder migrate` when files would auto-update; `grounder migrate --force` when locally modified (also typical once when upgrading from before 0.3) |
| Session-start teaser missing (optional)                                                | `grounder migrate --hooks` — `doctor` warns when absent                                                                                              |
| Shared runtime stale after upgrade (bare npx install)                                  | `grounder migrate` — `doctor` warns when `hook-runtime` is stale                                                                                     |
| Migrate skips all commands as locally modified (first run after upgrade)                | `grounder migrate --force` once, then plain `migrate` on later upgrades                                                                              |
| Node binary gone / not executable (`doctor` fails on hook or command interpreter path) | `grounder migrate` (add `--force` if command files were edited or you're still on a pre-0.3 install)                                                  |

See also: [CLI reference](cli-reference.md) · [Configuration](configuration.md) ·
[Upgrading](upgrading.md) · [Session-start hooks](session-hooks.md)
