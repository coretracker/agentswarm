# Human-Gated Taskwise Delivery Flow

This flow is the required delivery path for agent-driven implementation work in this repository.

```mermaid
flowchart TD
  A[Read Requirements] --> B[Understand Requirements]
  B --> C[Initial Repository Research]
  C --> D[Re-evaluate Requirements]
  D --> E{Any uncertainties?}
  E -- Yes --> F[Ask User Clarifying Questions]
  F --> G[Human Review Phase]
  G --> D
  E -- No --> H[Create Implementation Plan]
  H --> I[Break Into Tasks with Acceptance Criteria]
  I --> J[Confirm Repo Conventions]
  J --> K[Human Review Phase]
  K --> L[Ask User to Start Implementation]
  L --> M{User approves?}
  M -- No --> D
  M -- Yes --> N[Run Baseline Checks]
  N --> O[Start Implementation]
  O --> P[Show Visible Task List]
  P --> Q[Pick Next Open Task]
  Q --> R[Implement Task]
  R --> S[Run Relevant Tests]
  S --> T{Tests passed?}
  T -- No --> R
  T -- Yes --> U[Run Lint]
  U --> V{Lint passed?}
  V -- No --> R
  V -- Yes --> W[Run Build]
  W --> X{Build passed?}
  X -- No --> R
  X -- Yes --> Y[Self Review]
  Y --> Z{Self review passed?}
  Z -- No --> R
  Z -- Yes --> AA[Code Review]
  AA --> AB{Review passed?}
  AB -- No --> R
  AB -- Yes --> AC[Update Task Status]
  AC --> AD{More open tasks?}
  AD -- Yes --> P
  AD -- No --> AE[Final Verification Against Requirements]
  AE --> AF[Security / Privacy Review]
  AF --> AG[Update Docs / Changelog if Needed]
  AG --> AH[Summarize Changes, Risks, Open Items]
  AH --> AI[Implementation Complete]
```

## Required Evidence In Execution Plans
Complex tasks must record this evidence in the execution plan:
- `Requirements Read`
- `Requirements Understood`
- `Repository Research Complete`
- `Uncertainties Logged`
- `Human Review Completed`
- `User Approval To Start`
- `Baseline Checks Run`
- `Visible Task List Updated`
- `Task-Level Tests/Lint/Build`
- `Self Review Complete`
- `Code Review Complete`
- `Final Verification Complete`
- `Security/Privacy Review Complete`
- `Docs/Changelog Updated`

Use `docs/exec-plans/template.md` and keep the evidence checklist current while implementing.
