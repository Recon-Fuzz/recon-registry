# registry/ — your behavioral integration mock

This folder was scaffolded by `npx recon-registry init`. It packages a **behavioral integration
mock** — one self-contained contract — for the [recon-registry](https://github.com/Recon-Fuzz/recon-registry),
deployable by name from the Recon operator and pluggable into any operator suite.

A piece makes a third-party integration (lending/AMM/CDP/vault/oracle) **behave naturally** as
actors use it, so the project being fuzzed (X) meets realistic, evolving conditions. It is **not** a
full deploy of the real protocol and **not** for testing the integration's own invariants:

- Model **only the surface X touches**; mock/stub/omit the rest.
- Be **faithful on the dynamics that affect X** (rates, price impact, rounding, liquidation, accrual).
- Provide **actor handlers** for the natural churn that perturbs X.
- **Register your entry points by label** so X's suite resolves them via `rvm.getAddr("...")`.

Files:
- `Harness.sol` — your piece (rename it): inlined `asActor`/`asAdmin`, constructor deploys the touched
  surface + `rvm.register`s by label + funds actors, plus actor handlers. See the TODOs.
- `Rvm.sol` — the `rvm` cheatcode interface (`getActors`, `register`, `prank`, …).
- `IERC20.sol` — minimal ERC20 (funding/approvals without forge-std).
- `../recon-registry.toml` — the entry manifest (name, description, tags, the labels you register, solc).

Deps are **`Rvm` + `IERC20` only**. No `BaseTargets`/`Asserts`/ghosts/properties — X's invariants live
in X's suite.

## Flow
```
# edit Harness.sol + recon-registry.toml
npx recon-registry pack       # forge build + extract entry → recon-registry-out/<name>.json
npx recon-registry publish    # open a PR to the registry  →  merge = live for everyone
```
