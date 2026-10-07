# Examples

Runnable scripts for each scenario. They import the SDK from source, so they
always match the code in this repo.

```bash
export COMINTY_API_KEY="<your API key>"
export COMINTY_USER_ID="user_..."
export COMINTY_AGENT_ID="__cominty_agents::agent.chat"   # optional

node examples/01-stream-events.ts
```

The examples need **Node 24+**: Node runs the TypeScript files directly, and
they use `await using` to close the client, which older versions cannot parse.
(The SDK itself supports Node 20+.) On an older Node, run them with
`npx tsx examples/01-stream-events.ts`.

To keep the variables in a file, copy [`.env.example`](../.env.example) to `.env`
and run `node --env-file=.env examples/01-stream-events.ts`.

| Script | Shows |
| --- | --- |
| `01-stream-events.ts` | Stream progress events live |
| `02-await-result.ts` | Fire and await the final answer |
| `03-follow-up.ts` | Continue in the same thread |
| `04-answer-questions.ts` | Read and answer agent questions |
| `05-list-threads.ts` | List and search threads |
| `06-manage-thread.ts` | Get, rename/star, archive |
| `07-max-steps.ts` | Cap tool rounds for one message, then continue past the cap |
| `08-memory-files.ts` | Create, list, update and delete memory files; start a thread in their namespace |

**These hit the real API and cost real credits.**
