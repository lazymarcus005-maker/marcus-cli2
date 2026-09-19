# Macus Code

Macus Code is a local coding agent that inspects a repository, makes authorized changes, runs checks, and preserves session state so work can be reviewed or resumed.

## Language

**Verification Assessment**:
A conclusion about whether the latest repository work has sufficient fresh, trusted test evidence. It reflects test results, repository identity, workspace state, and evidence linked to completed tasks.

**Tool Outcome**:
The observed result of an agent action, including whether it succeeded, failed, was cancelled, or left its effect or verification uncertain.

**Provider Runtime**:
The model provider and model selected for a coding run, with the transport and credentials required to use them.

**Durable Continuity**:
The session knowledge needed to continue coding work after interruption, compaction, or restart, including its decisions, tasks, evidence, and recovery state.

**CLI Application**:
The user's command-line interaction with Macus Code to start and guide coding runs, inspect their state, and resume prior work.

**Task Evidence**:
Fresh passing verification evidence linked to a completed task. A passing check that is not linked to the task does not verify that task.
