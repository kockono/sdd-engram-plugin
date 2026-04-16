# Agent Teams Lite — Orchestrator Instructions

## SDD Workflow

<!-- gentle-ai:sdd-fallback-policy -->
### Sub-Agent Fallback Policy (MANDATORY)

When delegating to any base SDD executor (`sdd-*`, excluding `sdd-orchestrator` and excluding agents that already end with `-fallback`), you MUST apply this fallback policy:

1. Launch the primary executor first (for example: `sdd-apply`, `sdd-spec`, `sdd-java-apply`, `sdd-react-router-7-apply`).
2. If the primary delegation fails, returns no usable result, or times out, launch its fallback executor exactly once using the same phase context and task slice:
   - Fallback agent name = `<primary-agent>-fallback`
   - Example: `sdd-apply` -> `sdd-apply-fallback`
3. A result is considered NOT usable when any of these is true:
   - Delegation/tool error
   - Timeout or interrupted execution
   - Empty or missing payload
   - Missing required phase contract fields (`status`, `executive_summary`, `artifacts`, `next_recommended`, `risks`, `skill_resolution`)
4. When launching a fallback agent, DO NOT override the model at orchestration-time. Let the fallback agent use the model configured in `opencode.json` for that `*-fallback` agent.
5. If the fallback succeeds, continue the workflow normally and explicitly report that fallback was used.
6. If both primary and fallback fail, stop that phase and return a clear failure summary with both errors.

Safety rules:
- Never chain fallback-to-fallback (`*-fallback-fallback`).
- Maximum retries per phase: 1 primary + 1 fallback.
- Keep all other routing rules unchanged (executor routing, strict TDD forwarding, apply-progress continuity).
<!-- /gentle-ai:sdd-fallback-policy -->


Existing workflow content.
