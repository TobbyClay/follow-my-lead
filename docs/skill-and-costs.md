# Skills, autonomy, and costs

The initial implementation uses a skill for AI interpretation and a local Chrome extension for capture and repeat execution. No API key is required by the extension.

| Route | Where the AI runs | How it is paid for | Current status |
| --- | --- | --- | --- |
| Local recording and saved-workflow replay | No model is invoked | No AI API charge | Implemented |
| Learn or adapt through the project skill in Codex | The model in the Codex host | ChatGPT subscription access when signed in with ChatGPT, subject to plan limits | Skill implemented; adaptive browser execution needs a connected browser |
| Same workflow as a distributable ChatGPT skill | The model in the receiving host | That host's plan and available tools | Skill export implemented; plugin packaging and a remote/local browser bridge are not implemented |
| Standalone service with continuous AI decisions | An API or a separately hosted model | API usage or model hosting/computing costs | Future option |

Official OpenAI documentation describes skills as reusable instructions, resources, and optional scripts. Standalone skills and plugin-distributed skills have different supported surfaces. This prototype provides a repository skill discoverable by Codex; it does not install a plugin into ChatGPT web or connect web ChatGPT to a user's Chrome. [Build skills](https://learn.chatgpt.com/docs/build-skills)

Codex supports ChatGPT subscription authentication and API-key authentication. The latter uses API billing. The skill does not convert a subscription into credentials for a standalone model API. [Authentication](https://learn.chatgpt.com/docs/auth)

## What "learn" means here

The extension collects evidence: the task goal, page context, target labels, actions, values, and a user-marked success result. Its local draft builder only organizes events. When invoked, the skill guides the host model to interpret the evidence, separate parameters from fixed values, identify assumptions and decision rules, and produce a validated workflow.

The stored workflow is reusable procedural memory; this process does not retrain model weights. One demonstration can establish a normal path but cannot prove what should happen in every unseen case. The skill records gaps explicitly rather than inventing a business rule.

## What runs by itself

After review, the extension can perform the saved steps with new inputs and check the result while Chrome remains open. It needs no AI call for each step. It stops when targets or results do not match.

If the user asks the skill to run the task through connected browser tools, the host model can inspect the live page and adapt within the request. This uses the host's model allowance. The current extension cannot silently call that model or launch new Codex tasks; automatic handoff, unattended adaptive runs, scheduling, and standalone API execution would be additional work.

The Chrome recorder and host browser connection are distinct components. The former collects demonstrations; the latter gives an invoked agent browser tools.
