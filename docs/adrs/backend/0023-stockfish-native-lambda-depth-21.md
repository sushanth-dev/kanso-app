# 0023. Analyse with native Stockfish processes per Lambda, to a minimum depth of 21

* Status: accepted
* Date: 2026-08-10
* Builds on: [ADR-0014](0014-aws-hosting-layout.md), [ADR-0020](0020-node-24-lts-runtime.md)
* Supersedes: [ADR-0012](0012-pg-boss-stockfish-analysis.md) in full. ADR-0014 had
  already replaced its queue; this record replaces its remaining half, the choice
  of a WebAssembly engine.
* Related: [ADR-0016](0016-sse-analysis-result-delivery.md), [ADR-0019](0019-vitest-testing-setup.md)

## Context

ST-007 is the first story to run an engine. ADR-0014 already says where analysis
runs: SQS holds one message per game, Lambda polls it, and each invocation walks
a whole game. What no record settles is which Stockfish that invocation runs, how
much thinking each position gets, and how long a player waits for a game.

ADR-0014 predicted "roughly 120 seconds for a 60-move game, well under the
15-minute ceiling", and that number was written before any engine existed in this
repository. The prototype cannot settle it either: its timings come from native
Stockfish with sixteen threads, and its own code comments estimate rather than
measure. `docs/prototype-carryover.md` says to re-measure before any of it
reaches a pricing decision, which ST-008 is.

So this record is written after measurements rather than before them, the same
way ST-006 checked that RDS offers PostgreSQL 18 before building on the claim.

### What was measured

On 10 August 2026, Stockfish 18 driven over UCI from Node 24, `Hash 128`,
analysing every position of a real 107-ply tournament game, on an eight-core
Apple Silicon machine with six performance cores. Both engines are the same
Stockfish 18: the `stockfish` npm package at 18.0.8 for the WebAssembly build,
and the official `sf_18` release binary for the native one.

**Native is 1.78 times faster than WebAssembly, and searches identically.**

| Engine | Depth 21, whole game |
|---|---|
| WebAssembly, single-threaded | 274s |
| Native, single-threaded | 154s |

The two produced the same node count at every position, to the digit: mean
1,669,489 nodes, maximum 12,167,980. A fixed-depth search is deterministic, so
this is what it looks like when two builds of one engine agree. Only the speed
differs. That fact is what makes it safe to run different builds in different
places, which this record does below.

**Splitting one game across several engines scales; adding threads to one engine
does not.** Two ways to use more cores, at 400,000 nodes per position:

| Engines, one position each | Wall clock, whole game | Depth reached |
|---|---|---|
| 1 | 77.4s | 18.1 |
| 2 | 41.9s | 18.1 |
| 4 | 23.4s | 18.1 |
| 6 | 20.2s | 18.1 |

| One engine, N threads | Per position | Depth reached |
|---|---|---|
| 1 thread | 0.73s | 18.1 |
| 4 threads | 0.17s | 14.4 |
| 6 threads | 0.12s | 14.2 |

The threaded build looks four times faster and is not. At a fixed budget, extra
threads spend nodes on duplicated work, so the same nodes buy a shallower search
and depth falls from 18.1 to 14.4. That is a quality cut wearing a speedup's
clothes. Splitting positions across independent engines costs nothing in depth,
because the positions of a game are independent problems.

**A minimum depth is not a fixed node count.** At depth 21, native, per position:
mean 1.44s, median 1.17s, p90 2.64s, maximum 6.5s; mean 1.67M nodes, maximum
12.2M. The spread between the median position and the worst one is a factor of
five, which is why the budget below is expressed as a depth with a ceiling rather
than as a node count.

**Engine boot is 0.4s**, not the two seconds the prototype's comments feared. A
fresh engine per game costs nothing worth engineering around.

## Decision

**The engine is native Stockfish 18, pinned to the `sf_18` release tag, shipped
inside a Lambda container image built for arm64.** Not from a branch: the
prototype's Dockerfile cloned Stockfish's default branch unpinned, so two builds
a month apart could evaluate the same position differently, and a player
comparing this month with last must be comparing like with like. arm64 because
Graviton is about 20% cheaper per GB-second, and the prototype's
`x86-64-modern` target does not carry over.

The binary is **compiled from that tag inside the image build**, which is not
what this record first said. It said Stockfish publishes ARM builds, and for
Linux that is wrong: the `sf_18` release publishes `stockfish-ubuntu-x86-64` in
several instruction-set flavours, Windows, macOS, and Android, and no Linux
arm64 asset at all. Checked against the release API on 10 August 2026 rather
than assumed, which is the only reason it was caught before a Dockerfile was
written.

So the choice was between compiling for arm64 and taking the published x86-64
binary at about 25% more per game. Compiling wins, because the pin is what
matters and a tag builds the same source every time: `git checkout sf_18` then
`make profile-build ARCH=armv8-dotprod`, in a builder stage whose output is one
binary copied into the runtime image. Graviton2 is a Neoverse N1 and has the
dot-product instructions that target wants. The build takes minutes and happens
when the image is built, not when a game is analysed.

**Two engine processes per invocation, one per vCPU, at 3,008 MB of Lambda
memory.** Each is single-threaded and owns one position at a time; the game's
plies are dealt across them. The engines are child processes speaking UCI over
stdio, not in-process modules, for a reason found by measurement: the
`stockfish` npm package can only be initialised once per process, and it fails
inside `worker_threads` because its pthread detection misfires there.

The four-engine design this record first chose does not deploy on this account:
the account's Lambda memory quota caps at 3,008 MB (the default; raising it
needs an AWS Support case under "Account and billing"), and four engines need
7,077 MB for four vCPUs. Two engines fit the cap and stay on the same depth
contract, at about 1.7x the per-game cost of four (two engines measured 2.1x
faster than one at no cost in depth). Revisit four when the quota is raised.

**Every position is searched to a minimum depth of 21**, with a ceiling of
15,000,000 nodes as the bound that keeps a pathological position from running
away. Depth is the contract because it is what determines whether an evaluation
can be trusted; the node ceiling is the safety rail, sized just above the 12.2M
worst case measured. A position that hits the ceiling before depth 21 is recorded
rather than retried.

**Positions with one legal move are not searched.** A forced move has no
alternative to be worse than, so its evaluation carries over from the previous
position. This is exact rather than approximate, and it is worth stating that its
saving is small: one position in the 107-ply game measured. It costs three lines
and never costs accuracy.

*Amended 2026-09-19: the direction of the carry was wrong. The paragraph above is
superseded by [Amendment 2026-09-19](#amendment-2026-09-19) at the end of this
record.*

**Book plies are searched like any other.** Skipping the opening would be a
larger saving, and it is rejected: players make real mistakes inside known
openings, and the openings a player leaks in are the entire product.

**Each game records the settings it was analysed under**, in
`game.analysis_nodes` and `game.analysis_duration_ms`, which already exist in the
schema. Analysis produced at different depths is not the same measurement, and
the row has to say which it is.

**Analysis stays where ADR-0014 put it**: SQS to Lambda, one message per game,
results keyed by game so a retried invocation is idempotent. This record
confirms the hosting decision against measurements and changes only what runs
inside the invocation.

### Tests run the WebAssembly build; production runs the native one

The definition of done requires integration tests against real engine output
rather than a stub, and that has to work on a laptop and in CI without either
installing a binary or pulling the container image. So the test path loads the
`stockfish` npm package, whose tarball carries the `.wasm` and whose
`postinstall` only makes a symlink, meaning `npm ci --ignore-scripts` is enough
and `package-lock.json` pins the version.

Two different builds in two places is normally the exact drift ADR-0022 argues
against for PostgreSQL. It is acceptable here, and only here, because the two
were measured to search identically: same node count at every position at a
fixed depth. They are one engine compiled twice, and a fixed-depth search makes
that checkable rather than assumed. The check is kept honest by pinning both to
Stockfish 18 and by an integration test asserting a known position's evaluation
at a fixed depth, which fails if the two builds ever stop agreeing.

### What we are not doing, and why

**Not a Fargate worker.** Native was the reason to want one, and the container
image gives us native without it. A second Fargate service would need
queue-depth auto scaling or about $71 a month for an idle task, an SQS VPC
endpoint at about $7 a month per availability zone because ST-006's VPC has no
NAT, and a second compute model to deploy and log. Lambda scales to zero by
construction and reuses the deploy path ST-006 built.

**Not pg-boss, or any queue inside the API container.** It is the smallest
possible diff and it puts the engine on the API's CPU, which is the failure
ADR-0014 exists to prevent. ST-006 made the consequence concrete: the load
balancer health check added in that story asks the database on every check, and a
task with its CPU pinned by an analysis burst fails it and is pulled out of
service. An upload burst would take the API down.

**Not the multi-threaded engine build.** Measured above: shallower search for the
same work, plus an initialisation path that proved fragile in Node.

**Not the two-pass scan or a shared evaluation cache, yet.** Both are real, and
both are measured: a depth-14 first pass over this game costs 9s and flags every
position the depth-21 pass judged a mistake, so re-searching only flagged
positions cut the game from 173s to 61s with no mistake missed. That is one game.
Recall like that has to hold across many games before analysis is allowed to skip
positions, and the story that adopts it owns that evidence. It is on the product
backlog with the method attached rather than smuggled into the story whose job is
to make analysis exist at all.

## Consequences

**A game takes about 210 seconds and costs about 1.9 US cents.** Two engines
finish the measured game in about 77 seconds here (two measured 2.1x faster
than one); Lambda vCPU is roughly two to two and a half times slower than this
machine, which puts it near 210 seconds, or about 630 GB-seconds at 3,008 MB,
or about $0.019 in `ap-south-2` on arm64. A nine-round tournament is roughly
17 cents. Every one of those numbers is an estimate scaled off this machine by
an assumed ratio, and replacing them with measurements taken on the deployed
function is exactly what ST-008 is for. The four-engine numbers this record
first carried (about 105 seconds, about 1.1 cents) return when the Lambda
memory quota is raised.

**The 15-minute ceiling stops being a design constraint.** At about 105 seconds
for 107 plies, a game would have to run past 800 plies to reach it. The function
timeout is set to 10 minutes so a pathological game lands in the dead-letter
queue rather than being retried until it is billed three times.

**Depth 21 costs roughly four times what the first sketch of this record
assumed.** An earlier draft chose 400,000 nodes per position, which reaches about
depth 18 and would cost about a third of a cent a game. Depth 21 is the quality
bar this project chose deliberately, and the price of that choice is recorded
here rather than discovered in a bill.

**The image build compiles an engine, so it is slow and it is a supply chain.**
Minutes rather than seconds, cached between builds, and it pulls two things over
the network: the source at tag `sf_18`, and the neural network file the Makefile
fetches, whose hash is fixed in that source. Both are pinned by the tag. A build
that cannot reach either fails rather than substituting something newer.

**Two things are now pinned that must move deliberately.** The engine release,
because evaluations shift between Stockfish versions. And the depth floor,
because it changes the evaluations DEBT-001's inaccuracy thresholds are tuned
against, and those thresholds are pinned by golden tests. Changing either is a
story that re-pins its golden tests in the same change, never a constant edited
in passing.

**A native subprocess consumes data that began as an untrusted upload.** Moves
reach it as UCI tokens written to a pipe, and the process is spawned with an
argument array rather than through a shell, so a move string cannot become a
command. The per-position node ceiling and the function timeout bound what a
crafted game can consume, and ST-007's security assessment carries the detail.

**Concurrency is capped rather than left to scale freely.** Each invocation opens
its own connection to a `db.t4g.micro`, and ADR-0014 already names connection
exhaustion as the burst risk. The cap is the event source mapping's
`maximumConcurrency` of 2, which is the only trigger. A reserved-concurrency
hard cap was dropped during ST-008's deploy: the account's total Lambda
concurrency is the default 10, and raising it needs a manual AWS approval for
no extra control, because the event source mapping already limits concurrent
invocations. ST-008 is where the cap is tested: it runs analysis on the deployed
function, and the cap holds or the database runs out of connections in front of
us rather than in front of a player. The function timeout and the per-game cost
estimate above are tested by the same story, and all three are expected to move
when it reports. The recorded exit for connection exhaustion is RDS Proxy, about
$15 a month, added without changing the flow.

## Amendment 2026-09-19

A position with one legal move took the evaluation of the position *before* it,
which is backwards. The value of a position is the value of the position the
player's move reaches, and a forced move reaches a position whose evaluation is
the one the forced move's ply is measured against. Carrying the earlier number
instead made `evalBefore` and `evalAfter` equal for the ply that forced the
reply, so the drop read as zero and the worst move of a game could produce no
`mistake` row at all. It also let a forced ply inherit the opponent's previous
number, which could invent a mistake as easily as it deleted one, and the deeper
pass skipped forced indices outright, so the move that decided a game was never
re-searched.

The rule is now: a position with exactly one legal move takes the evaluation of
the position *after* it, a run of such positions takes the value at the end of
the run, and the last position of a walk is always searched because it has no
successor to take a value from. The rule lives in
`apps/api/src/analysis/evaluation-sources.ts` as a pure function, and
`evaluateWalk` resolves both passes through it. The paragraph above claimed the
carry was exact and free; it was neither. The saving is still real and still
small, and it is now one search fewer per forced position rather than a borrowed
number, which also means a forced position never has a value written under its
own cache key.

A game where the player's move gave the opponent exactly one reply used to report
nothing. It now reports the blunder. `analyse-game.integration.test.ts` pins it
with a White `1. Qb8+??` that Black must answer with `Kxb8`.

Unchanged: the depth contract, the node ceiling, the cache keyed by depth, the
swing epsilon, the classifier thresholds, the motif rules, and the delete-then-
insert write. Recorded games are not re-analysed; a game keeps the analysis it
was given until someone runs it again.

## Amendment 2026-09-20

Two bounds on the driver's reads, added by ST-172. Every UCI read now carries a
wall-clock deadline: 30 seconds for a handshake (`uci`, and the `isready` before
a search) and 180 seconds for one search. Until now a read settled only when its
line arrived or the process died, so an engine that stopped writing without
exiting left the promise pending for as long as the process lived, and took the
game's whole walk with it until the invocation hit its timeout.

The search bound is derived from numbers this record already fixes. A search is
bounded in nodes before it is bounded in time, at 15,000,000, and the worst
position measured here was 12,167,980 nodes inside a game of about 210 seconds.
Three minutes is therefore a detector for a wedged engine, not a limit a healthy
search approaches. It also sits under the analysis function's 600-second timeout
in `infra/analysis.ts`, which is the property that makes it useful: a bound
longer than the timeout would never fire, because the invocation would end
first.

A search that hits its deadline kills that engine's process before the error
propagates, and a handshake that times out or dies kills the process it started,
so neither converts a hang into an orphan. The engine pool is also started
inside the block whose `finally` stops it, so a start that fails stops the
engines beside it, which the previous ordering did not. The commands sent to the
engine and their order are unchanged; only the waiting is bounded.
