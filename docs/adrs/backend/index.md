# Backend records

The backend records cover the API service: its framework, validation,
data access, chess handling, authentication, and engine analysis. The
format and rules are in
[ADR-0000](../frontend/0000-record-architecture-decisions.md), and the
number sequence is shared with the frontend records.

## Records

* [0007. Use Hono as the HTTP framework](0007-hono-http-framework.md)
* [0008. Validate with Zod](0008-zod-validation.md)
* [0009. Access PostgreSQL through Drizzle](0009-drizzle-orm.md)
* [0010. Chess logic and storage: chess.js, PGN for games, FEN for positions](0010-chess-js-pgn-game-logic.md)
* [0011. Use better-auth for session management](0011-better-auth-session-management.md)
* [0012. Run Stockfish as WASM, queued through pg-boss](0012-pg-boss-stockfish-analysis.md) (superseded by 0014 and 0023)
* [0013. Define the API as REST with an OpenAPI contract](0013-rest-openapi-api-contract.md)
* [0014. Host on AWS: API on a small always-on service, analysis on SQS and Lambda](0014-aws-hosting-layout.md)
* [0015. Define AWS infrastructure with SST](0015-sst-infrastructure-as-code.md)
* [0016. Deliver analysis results over server-sent events](0016-sse-analysis-result-delivery.md)
* [0018. Use Gemini Flash for coaching prose, over engine-verified facts only](0018-ai-explanation-layer.md)
* [0019. Test with Vitest, one runner for the whole workspace](0019-vitest-testing-setup.md)
* [0020. Run on Node.js 24 LTS](0020-node-24-lts-runtime.md)
* [0021. Connect to PostgreSQL with postgres.js](0021-postgres-js-driver.md)
* [0022. Run PostgreSQL 18](0022-postgresql-18.md)
* [0023. Analyse with four native Stockfish processes per Lambda, to a minimum depth of 21](0023-stockfish-native-lambda-depth-21.md)
* [0029. Use ChessOps for attack and threat detection](0029-chessops-attack-detection.md)
* [0030. Record COPPA consent through guardian email-plus](0030-coppa-guardian-consent.md)

Still open, to be recorded when the work starts: frontend routing and data
fetching (once the app shell exists), and observability (once there is
something running to observe).
